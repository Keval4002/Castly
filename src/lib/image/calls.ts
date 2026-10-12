import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { providerCalls } from "@/lib/db/schema";
import type { CallContext } from "./types";

export interface CallRecord {
  stage: "generate" | "judge" | "plan" | "classify" | "background" | "dispatch";
  provider: string;
  model?: string | null;
  ok: boolean;
  error?: string | null;
  latencyMs?: number;
  estCostMicros: number;
  actualCostMicros?: number | null;
  ctx?: CallContext;
}

/**
 * Record a paid call BEFORE making it (as "in flight", ok=false), so the spend counts toward budgets even if the
 * worker dies before the provider answers. Finish it with finishProviderCall. Returns null if bookkeeping failed.
 */
export async function startProviderCall(r: Omit<CallRecord, "ok" | "error" | "latencyMs" | "actualCostMicros">): Promise<string | null> {
  try {
    const [row] = await db()
      .insert(providerCalls)
      .values({
        userId: r.ctx?.userId,
        generationId: r.ctx?.generationId,
        imageId: r.ctx?.imageId,
        stage: r.stage,
        provider: r.provider,
        model: r.model ?? null,
        attempt: r.ctx?.attempt ?? 1,
        ok: false,
        error: "in flight",
        estCostMicros: r.estCostMicros,
      })
      .returning({ id: providerCalls.id });
    return row?.id ?? null;
  } catch (err) {
    console.warn("[calls] could not start provider call:", (err as Error).message);
    return null;
  }
}

export async function finishProviderCall(
  id: string | null,
  r: { ok: boolean; model?: string | null; error?: string | null; latencyMs: number; actualCostMicros?: number | null },
): Promise<void> {
  if (!id) return;
  try {
    await db()
      .update(providerCalls)
      .set({
        ok: r.ok,
        model: r.model ?? undefined,
        error: r.error ? r.error.slice(0, 500) : null,
        latencyMs: r.latencyMs,
        actualCostMicros: r.actualCostMicros ?? null,
      })
      .where(eq(providerCalls.id, id));
  } catch (err) {
    console.warn("[calls] could not finish provider call:", (err as Error).message);
  }
}

/**
 * Record one metered call (success or failure), so cost per generation, per accepted image and per provider
 * can be computed. Best-effort: bookkeeping must never fail a generation.
 */
export async function recordProviderCall(r: CallRecord): Promise<void> {
  try {
    await db()
      .insert(providerCalls)
      .values({
        userId: r.ctx?.userId,
        generationId: r.ctx?.generationId,
        imageId: r.ctx?.imageId,
        stage: r.stage,
        provider: r.provider,
        model: r.model ?? null,
        attempt: r.ctx?.attempt ?? 1,
        ok: r.ok,
        error: r.error ? r.error.slice(0, 500) : null,
        latencyMs: r.latencyMs ?? null,
        estCostMicros: r.estCostMicros,
        actualCostMicros: r.actualCostMicros ?? null,
      });
  } catch (err) {
    console.warn("[calls] could not record provider call:", (err as Error).message);
  }
}
