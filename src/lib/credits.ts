import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, type DB } from "@/lib/db";
import { creditLedger, profiles, type Profile } from "@/lib/db/schema";
import { SIGNUP_BONUS_CREDITS } from "@/lib/pricing";

export class InsufficientCreditsError extends Error {
  constructor(
    public readonly required: number,
    public readonly balance: number,
  ) {
    super(`Insufficient credits: need ${required}, have ${balance}`);
  }
}

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
type Executor = DB | Tx;

type Reason = (typeof creditLedger.$inferInsert)["reason"];

export interface CreditMovement {
  userId: string;
  delta: number;
  reason: Reason;
  idempotencyKey: string;
  ref?: string;
}

export function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i++) {
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Apply a credit movement exactly once (keyed by idempotencyKey).
 * Must run inside a transaction so the balance and ledger stay consistent.
 * Returns `applied: false` if this key was already applied.
 */
export async function applyCreditMovement(
  tx: Executor,
  m: CreditMovement,
): Promise<{ applied: boolean; balance: number }> {
  const existing = await tx
    .select({ id: creditLedger.id })
    .from(creditLedger)
    .where(eq(creditLedger.idempotencyKey, m.idempotencyKey))
    .limit(1);
  if (existing.length > 0) {
    const [p] = await tx.select({ credits: profiles.credits }).from(profiles).where(eq(profiles.id, m.userId));
    return { applied: false, balance: p?.credits ?? 0 };
  }

  const updated = await tx
    .update(profiles)
    .set({ credits: sql`${profiles.credits} + ${m.delta}`, updatedAt: new Date() })
    .where(and(eq(profiles.id, m.userId), sql`${profiles.credits} + ${m.delta} >= 0`))
    .returning({ credits: profiles.credits });

  if (updated.length === 0) {
    const [p] = await tx.select({ credits: profiles.credits }).from(profiles).where(eq(profiles.id, m.userId));
    if (!p) throw new Error(`Profile ${m.userId} not found`);
    throw new InsufficientCreditsError(-m.delta, p.credits);
  }

  await tx.insert(creditLedger).values({
    userId: m.userId,
    delta: m.delta,
    balanceAfter: updated[0].credits,
    reason: m.reason,
    idempotencyKey: m.idempotencyKey,
    ref: m.ref,
  });
  return { applied: true, balance: updated[0].credits };
}

/** Transactional wrapper that treats a concurrent duplicate as "already applied". */
export async function moveCredits(m: CreditMovement): Promise<{ applied: boolean; balance: number }> {
  try {
    return await db().transaction((tx) => applyCreditMovement(tx, m));
  } catch (err) {
    if (isUniqueViolation(err)) return { applied: false, balance: await getBalance(m.userId) };
    throw err;
  }
}

export async function getBalance(userId: string): Promise<number> {
  const [p] = await db().select({ credits: profiles.credits }).from(profiles).where(eq(profiles.id, userId));
  return p?.credits ?? 0;
}

/** Create the profile on first sight and grant the one-time signup bonus. */
export async function ensureProfile(user: { id: string; email: string; name?: string | null }): Promise<Profile> {
  const d = db();
  const [existing] = await d.select().from(profiles).where(eq(profiles.id, user.id));
  if (existing) return existing;

  await d
    .insert(profiles)
    .values({ id: user.id, email: user.email.toLowerCase(), name: user.name ?? null })
    .onConflictDoNothing();

  if (SIGNUP_BONUS_CREDITS > 0) {
    await moveCredits({
      userId: user.id,
      delta: SIGNUP_BONUS_CREDITS,
      reason: "signup_bonus",
      idempotencyKey: `signup_bonus:${user.id}`,
    });
  }
  const [created] = await d.select().from(profiles).where(eq(profiles.id, user.id));
  return created;
}

export async function listLedger(userId: string, limit = 50) {
  return db()
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.userId, userId))
    .orderBy(desc(creditLedger.createdAt))
    .limit(limit);
}
