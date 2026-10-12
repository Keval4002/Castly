import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { getOwnedAsset, saveAsset } from "@/lib/assets";
import { aspectRatio, type CategoryId } from "@/lib/catalog/options";
import { moveCredits } from "@/lib/credits";
import { db } from "@/lib/db";
import { assets, generationImages, generations, providerCalls, type Generation, type GenerationImage } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { raiseAlert } from "@/lib/alerts";
import { recordProviderCall } from "@/lib/image/calls";
import { SET_BUDGET_FACTOR, SHOT_BUDGET_MICROS, STAGE_COST_MICROS } from "@/lib/image/costs";
import { judgeFidelity } from "@/lib/image/fidelity";
import { finalizeOutput, llmPreview, type ProcessedImage } from "@/lib/image/process";
import { bestAttempt, passes, retryFeedback, toFidelity, type Fidelity, type Verdict } from "@/lib/image/quality";
import { productReference, shotReferenceFor } from "@/lib/image/reference";
import { BudgetStopError, generateWithFallback, type RouteOptions, type RoutedResult } from "@/lib/image/router";
import type { ImageRequest } from "@/lib/image/types";
import { TIERS, type TierId } from "@/lib/pricing";
import { buildPromptPlan } from "@/lib/prompt/builder";
import { sampleCastings, sampleDirections } from "@/lib/prompt/shared";
import { storage } from "@/lib/storage";
import type { MinProminence } from "@/lib/image/quality";
import type { ShotSpec } from "@/lib/shots/types";
import { planGeneration, plannerMode } from "./planning";
import { generationPause } from "@/lib/switches";

/**
 * Job execution. A generation is a *plan* step (one prompt LLM call writes every shot's prompt) followed by
 * one independent *shot* per image. On Vercel each shot runs in its own function invocation (see
 * /api/internal/shots/[imageId]) with its own time budget, so one slow or crashing shot never takes the
 * others down. Every shot has a lease; a shot whose worker died is re-queued by recoverGeneration() or the
 * cron sweep, and a failed shot gives its credits back on its own.
 *
 * This file must not import ./service (service imports this).
 */

/** Backstop: a generation that has not settled by then is failed and refunded. */
export const STALE_AFTER_MS = 25 * 60 * 1000;
/** An image the quality judge could not verify is held this long (re-checked with backoff), then refunded. */
export const HELD_MAX_MS = 30 * 60 * 1000;
const FIRST_RECHECK_MS = 30 * 1000;
const MAX_RECHECK_BACKOFF_MS = 10 * 60 * 1000;
/** A worker owns a shot this long; longer than the 300 s function limit, so an expired lease means it died. */
export const SHOT_LEASE_MS = 6 * 60 * 1000;
/** A shot is started at most this many times, so a poison shot can't crash-loop. */
export const MAX_SHOT_DISPATCHES = 3;
/** A pending shot nobody has claimed after this long is considered lost and re-dispatched. */
export const LOST_DISPATCH_MS = 90 * 1000;

// ---------- seeds ----------

/** Deterministic per-shot seed, so a result can be reproduced where the provider supports seeds. */
export function seedFor(generationId: string, idx: number, attempt = 0): number {
  return createHash("sha256").update(`${generationId}:${idx}:${attempt}`).digest().readUInt32BE(0) & 0x7fffffff;
}

// ---------- internal dispatch (signed, so only this app can start a shot) ----------

const SIGNATURE_TOLERANCE_S = 5 * 60;

function shotSignature(imageId: string, ts: number): string {
  return createHmac("sha256", env().SESSION_SECRET).update(`shot:${imageId}:${ts}`).digest("base64url");
}

export function signShotRequest(imageId: string, now = Math.floor(Date.now() / 1000)) {
  return { ts: String(now), sig: shotSignature(imageId, now) };
}

export function verifyShotRequest(imageId: string, ts: string | null, sig: string | null): boolean {
  const t = Number(ts);
  if (!sig || !Number.isFinite(t) || Math.abs(Math.floor(Date.now() / 1000) - t) > SIGNATURE_TOLERANCE_S) return false;
  const expected = Buffer.from(shotSignature(imageId, t));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export type ShotDispatcher = (imageIds: string[]) => Promise<void>;
let dispatcherOverride: ShotDispatcher | null = null;

/** Tests only: replace how shots are started. Pass null to restore the default. */
export function setShotDispatcher(d: ShotDispatcher | null) {
  dispatcherOverride = d;
}

function dispatchMode(): "http" | "inline" {
  return env().SHOT_DISPATCH ?? (env().NODE_ENV === "production" ? "http" : "inline");
}

async function postShot(imageId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const { ts, sig } = signShotRequest(imageId);
    const res = await fetch(`${env().APP_URL}/api/internal/shots/${imageId}`, {
      method: "POST",
      headers: { "x-shot-ts": ts, "x-shot-sig": sig },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 202) return { ok: true };
    return { ok: false, reason: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

/**
 * Every failed HTTP dispatch is logged, stored (provider_calls, stage "dispatch") and alerted. A fallback means
 * the shot loses its own function invocation and runs inside the job's — it still completes, but the isolation
 * and time budget are gone, and the usual cause (wrong APP_URL, deployment protection, an outage) hits every shot.
 */
async function noteDispatchFailure(imageId: string, reason: string, fallback: boolean): Promise<void> {
  const kind = fallback ? "shot_dispatch_fallback" : "shot_dispatch_failed";
  await recordProviderCall({
    stage: "dispatch",
    provider: fallback ? "inline-fallback" : "dispatch-lost",
    ok: false,
    error: reason,
    estCostMicros: 0,
    ctx: { imageId },
  });
  await raiseAlert(kind, {
    imageId,
    reason,
    appUrl: env().APP_URL,
    action: fallback ? "ran inline" : "left pending for the sweep",
  });
}

/**
 * Start shots. http: one function invocation each (returns once they are accepted). inline: run them here.
 * If an http dispatch fails the shot is run here when `fallbackInline`, else left pending for the sweeper;
 * either way the failure is logged and alerted.
 */
export async function dispatchShots(imageIds: string[], opts: { fallbackInline?: boolean } = {}): Promise<void> {
  if (imageIds.length === 0) return;
  if (dispatcherOverride) return dispatcherOverride(imageIds);
  if (dispatchMode() === "inline") {
    await Promise.all(imageIds.map((id) => runShot(id)));
    return;
  }
  await Promise.all(
    imageIds.map(async (id) => {
      const posted = await postShot(id);
      if (posted.ok) return;
      await noteDispatchFailure(id, posted.reason, Boolean(opts.fallbackInline));
      if (opts.fallbackInline) await runShot(id);
    }),
  );
}

// ---------- plan ----------

async function recentPrompts(userId: string, category: string, excludeId: string): Promise<string[]> {
  const rows = await db()
    .select({ prompt: generationImages.prompt })
    .from(generationImages)
    .innerJoin(generations, eq(generations.id, generationImages.generationId))
    .where(
      and(
        eq(generations.userId, userId),
        eq(generations.category, category),
        sql`${generations.id} <> ${excludeId}`,
        eq(generationImages.status, "succeeded"),
      ),
    )
    .orderBy(sql`${generationImages.createdAt} desc`)
    .limit(6);
  return rows.map((r) => r.prompt).filter((p): p is string => Boolean(p));
}

/**
 * Claim a queued generation, write every shot's prompt, then start the shots. Safe to call twice
 * (the claim is atomic) and never throws. In inline mode it also waits for the shots and settles the job.
 */
export async function runGeneration(generationId: string): Promise<void> {
  const d = db();
  const started = Date.now();
  const [gen] = await d
    .update(generations)
    .set({ status: "running" })
    .where(and(eq(generations.id, generationId), eq(generations.status, "queued")))
    .returning();
  if (!gen) return; // already picked up or finished

  const pause = await generationPause();
  if (pause.paused) {
    // Never start paid work while paused; settle (refund) the job right away.
    await d.update(generations).set({ error: pause.message }).where(eq(generations.id, gen.id));
    await finalizeGeneration(gen.id, Date.now() - started);
    return;
  }

  try {
    const source = await getOwnedAsset(gen.userId, gen.sourceAssetId);
    if (!source) throw new Error("Source asset missing");
    const ar = aspectRatio(gen.aspectRatio);
    const category = gen.category as CategoryId;

    // The cleaned photo when ready (background removed, product untouched), else the upload.
    const [reference, recent] = await Promise.all([
      productReference(source),
      recentPrompts(gen.userId, gen.category, gen.id),
    ]);
    const t0 = Date.now();
    let prompts: string[];
    let productSummary: string;
    let promptSource: string;
    let specs: ShotSpec[] = [];
    let planMeta: Generation["plan"] = null;

    // v1: structured per-shot specs + deterministic prompts (no LLM). Anything wrong -> the legacy flow below.
    const planned =
      plannerMode() === "v1" ? await planGeneration(gen, source, recent).catch((err) => {
        console.warn(`[generation ${gen.id}] shot planner failed, using the legacy flow:`, (err as Error).message);
        return null;
      }) : null;
    if (planned) {
      specs = planned.specs;
      prompts = planned.prompts;
      productSummary = planned.productSummary;
      promptSource = "planner-v1";
      planMeta = planned.plan;
    } else {
      const castingInput = { category, values: gen.options, count: gen.count, productType: gen.productType, recentPrompts: recent };
      const plan = await buildPromptPlan({
        ...castingInput,
        aspectRatio: ar,
        customNote: gen.customNote ?? undefined,
        detectedDescription: source.classification?.description,
        preview: await llmPreview(reference.data),
        directions: sampleDirections(category, gen.count),
        castings: sampleCastings(castingInput),
      });
      prompts = plan.prompts;
      productSummary = plan.productSummary;
      promptSource = plan.source;
      await recordProviderCall({
        stage: "plan",
        provider: plan.source,
        ok: true,
        latencyMs: Date.now() - t0,
        estCostMicros: plan.source === "template" ? 0 : STAGE_COST_MICROS.plan,
        ctx: { userId: gen.userId, generationId: gen.id },
      });
    }

    await d
      .update(generations)
      .set({ promptSource, productSummary: productSummary || null, plan: planMeta })
      .where(eq(generations.id, gen.id));
    await Promise.all(
      prompts.map((prompt, idx) =>
        d
          .update(generationImages)
          .set({ prompt, seed: seedFor(gen.id, idx), spec: specs[idx] ?? null })
          .where(and(eq(generationImages.generationId, gen.id), eq(generationImages.idx, idx))),
      ),
    );

    const shots = await d
      .select({ id: generationImages.id })
      .from(generationImages)
      .where(and(eq(generationImages.generationId, gen.id), eq(generationImages.status, "pending")))
      .orderBy(asc(generationImages.idx));
    await dispatchShots(shots.map((s) => s.id), { fallbackInline: true });
  } catch (err) {
    console.error(`[generation ${gen.id}] failed:`, err);
    await d.update(generations).set({ error: "Something went wrong while generating" }).where(eq(generations.id, gen.id));
    await finalizeGeneration(gen.id, Date.now() - started);
    return;
  }
  await settleIfDone(gen.id);
}

// ---------- shots ----------

type FaithfulResult =
  | { ok: true; result: RoutedResult; processed: ProcessedImage; assetId?: string; fidelity: Fidelity | null; attempts: number; seed?: number }
  | { ok: false; held?: undefined; fidelity: Fidelity; attempts: number }
  /** Enforce mode and no verdict from any judge: not delivered until it is verified. */
  | { ok: false; held: true; result: RoutedResult; processed: ProcessedImage; assetId?: string; fidelity: Fidelity; attempts: number; seed?: number };

interface Candidate {
  result: RoutedResult;
  processed: ProcessedImage;
  verdict: Verdict | null;
  seed?: number;
  assetId?: string;
}

/** An image a previous worker already generated and checkpointed: judged again, never paid for again. */
export interface ResumePoint {
  assetId: string;
  data: Buffer;
  width: number;
  height: number;
  provider: string;
  model: string;
  /** Attempts already made (counted against the attempt limit). */
  attempts: number;
  seed?: number;
}

export interface ShotOptions {
  resume?: ResumePoint;
  /** Called with each generated image BEFORE it is judged, so a crash can't lose (and re-buy) it. Returns its asset id. */
  checkpoint?: (c: { processed: ProcessedImage; result: RoutedResult; attempt: number; seed?: number }) => Promise<string | undefined>;
  /** Spend cap: asked before every paid provider call. */
  allow?: RouteOptions["allow"];
  /** The full product photo the judge compares against (the generation input may be a close-up crop). */
  judgeReference?: Buffer;
  /** How prominent the product must be in this shot's output. Default "clear". */
  minProminence?: MinProminence;
  /** Wording for the retry correction; hero shots ask for a centred hero, other shots must not. */
  retryClosing?: string;
}

/** Ask the judge again once if it errored (cheap) before treating the image as unverifiable (expensive to regenerate). */
async function judgeWithRetry(product: Buffer, output: Buffer, req: ImageRequest, label?: string): Promise<Verdict | null> {
  for (let i = 0; i < 2; i++) {
    const t0 = Date.now();
    const v = await judgeFidelity(product, output, label);
    await recordProviderCall({
      stage: "judge",
      provider: v?.judge ?? "judge",
      ok: v !== null,
      latencyMs: Date.now() - t0,
      estCostMicros: v ? STAGE_COST_MICROS.judge : 0,
      ctx: req.ctx,
    });
    if (v) return v;
    if (i === 0) await new Promise((r) => setTimeout(r, env().FIDELITY_JUDGE_RETRY_DELAY_MS));
  }
  return null;
}

/**
 * Generate one shot and verify the product survived unchanged. If the judge finds differences, retry once
 * with those differences called out (Premium retries on a cheaper model, see providersFor); in enforce mode an
 * image that still differs is never delivered, and one the judge could not verify is held (fail closed).
 * Every image is checkpointed before judging, and every paid call is checked against the spend cap first.
 */
async function generateFaithfully(tier: TierId, req: ImageRequest, productLabel?: string, opts: ShotOptions = {}): Promise<FaithfulResult> {
  const { FIDELITY_MODE: mode, FIDELITY_THRESHOLD: threshold, GENERATION_MAX_ATTEMPTS } = env();
  // Premium gets exactly one automatic retry, however GENERATION_MAX_ATTEMPTS is set.
  const maxAttempts = mode === "off" ? 1 : tier === "premium" ? Math.min(2, GENERATION_MAX_ATTEMPTS) : GENERATION_MAX_ATTEMPTS;
  const tries: Candidate[] = [];
  let prompt = req.prompt;
  let attempt = opts.resume?.attempts ?? 0; // attempts already made
  let resume = opts.resume;
  const minProminence = opts.minProminence ?? "clear";
  const judgeAgainst = opts.judgeReference ?? req.image.data;

  for (;;) {
    let cand: Candidate;
    let ctxReq: ImageRequest;
    if (resume) {
      const r = resume;
      resume = undefined;
      ctxReq = { ...req, ctx: { ...req.ctx, attempt: Math.max(1, r.attempts) } };
      cand = {
        result: { data: r.data, model: r.model, provider: r.provider, attempts: [] },
        processed: { data: r.data, mime: "image/jpeg", width: r.width, height: r.height, thumb: Buffer.alloc(0) },
        verdict: null,
        seed: r.seed,
        assetId: r.assetId,
      };
    } else {
      if (attempt >= maxAttempts) break;
      const seed = req.seed === undefined ? undefined : (req.seed + attempt * 7919) & 0x7fffffff;
      ctxReq = { ...req, prompt, seed, variant: req.variant + attempt * 10, ctx: { ...req.ctx, attempt: attempt + 1 } };
      let result: RoutedResult;
      try {
        result = await generateWithFallback(tier, ctxReq, { allow: opts.allow });
      } catch (err) {
        if (tries.length === 0) throw err;
        break; // keep the earlier attempt (also when the spend cap stopped the retry)
      }
      attempt++;
      const processed = await finalizeOutput(result.data, req.aspectRatio);
      const assetId = await opts.checkpoint?.({ processed, result, attempt, seed });
      cand = { result, processed, verdict: null, seed, assetId };
    }
    cand.verdict = mode === "off" ? null : await judgeWithRetry(judgeAgainst, cand.processed.data, ctxReq, productLabel);
    tries.push(cand);
    if (!cand.verdict || passes(cand.verdict, threshold, minProminence)) break;
    prompt =
      `${req.prompt} CORRECTION — a previous attempt failed inspection: ${retryFeedback(cand.verdict, minProminence)}. ` +
      (opts.retryClosing ??
        "Reproduce the product exactly as in the provided photo — identical shape, size, colours, pattern and every detail — as the centred hero of the frame.");
  }

  const best = bestAttempt(tries, threshold, minProminence)!;
  const fidelity = mode === "off" ? null : toFidelity(best.verdict, threshold, minProminence);
  // Fail closed: with no verdict an image is never "passed", and in enforce mode never delivered.
  if (mode === "enforce" && fidelity && !fidelity.verified) {
    return { ok: false, held: true, result: best.result, processed: best.processed, assetId: best.assetId, fidelity, attempts: attempt, seed: best.seed };
  }
  if (mode === "enforce" && fidelity?.verified && !fidelity.passed) {
    return { ok: false, fidelity, attempts: attempt };
  }
  return { ok: true, result: best.result, processed: best.processed, assetId: best.assetId, fidelity, attempts: attempt, seed: best.seed };
}

// ---------- spend caps ----------

async function spentMicros(where: ReturnType<typeof eq>): Promise<number> {
  const [row] = await db()
    .select({ s: sql<number>`coalesce(sum(${providerCalls.estCostMicros}), 0)::int` })
    .from(providerCalls)
    .where(where);
  return row?.s ?? 0;
}

/** Estimated spend so far on one shot / on a whole set, counting retries, fallbacks, failed and in-flight calls and restarts. */
export const shotSpendMicros = (imageId: string) => spentMicros(eq(providerCalls.imageId, imageId));
export const setSpendMicros = (generationId: string) => spentMicros(eq(providerCalls.generationId, generationId));

export function budgetsFor(gen: Pick<Generation, "tier" | "count">): { shot: number; set: number } {
  const shot = SHOT_BUDGET_MICROS[gen.tier as TierId];
  return { shot, set: Math.round(shot * gen.count * SET_BUDGET_FACTOR) };
}

/** The `allow` hook for one shot: may the next paid call (estimated `est`) go ahead? */
function spendGuard(gen: Pick<Generation, "id" | "userId" | "tier" | "count">, imageId: string): NonNullable<RouteOptions["allow"]> {
  const { shot, set } = budgetsFor(gen);
  return async (providerId, est) => {
    const [shotSpent, setSpent] = await Promise.all([shotSpendMicros(imageId), setSpendMicros(gen.id)]);
    if (shotSpent + est <= shot && setSpent + est <= set) return true;
    await raiseAlert("cost_budget_reached", { generationId: gen.id, imageId, providerId, shotSpent, shotBudget: shot, setSpent, setBudget: set });
    return false;
  };
}

/** Give one failed shot's credits back, exactly once (the ledger key is per image). */
async function releaseShotCredit(gen: Pick<Generation, "id" | "userId" | "tier">, imageId: string): Promise<void> {
  const credits = TIERS[gen.tier as TierId].creditsPerImage;
  const r = await moveCredits({
    userId: gen.userId,
    delta: credits,
    reason: "refund",
    idempotencyKey: `refund:img:${imageId}`,
    ref: gen.id,
  });
  if (r.applied) {
    await db()
      .update(generations)
      .set({ refundedCredits: sql`${generations.refundedCredits} + ${credits}` })
      .where(eq(generations.id, gen.id));
  }
}

/** Mark a shot failed (only while it is still in flight) and release its credits. */
async function failShot(
  gen: Pick<Generation, "id" | "userId" | "tier">,
  imageId: string,
  patch: Partial<typeof generationImages.$inferInsert>,
): Promise<void> {
  await db()
    .update(generationImages)
    .set({ ...patch, status: "failed", leaseUntil: null, nextCheckAt: null })
    .where(and(eq(generationImages.id, imageId), inArray(generationImages.status, ["pending", "running"])));
  await releaseShotCredit(gen, imageId);
}

/**
 * Run one shot: claim it (atomically, with a lease), generate, verify, store, and settle the job if it was
 * the last one. Safe to call twice and from any invocation; never throws. A shot restarted after a crash
 * resumes from the image the dead worker already generated (no second charge) and stays inside its spend cap.
 */
export async function runShot(imageId: string): Promise<void> {
  const d = db();
  const now = new Date();
  const [img] = await d
    .update(generationImages)
    .set({
      status: "running",
      leaseUntil: new Date(now.getTime() + SHOT_LEASE_MS),
      dispatchCount: sql`${generationImages.dispatchCount} + 1`,
    })
    .where(
      and(
        eq(generationImages.id, imageId),
        lt(generationImages.dispatchCount, MAX_SHOT_DISPATCHES),
        or(
          eq(generationImages.status, "pending"),
          and(eq(generationImages.status, "running"), lt(generationImages.leaseUntil, now)),
        ),
      ),
    )
    .returning();
  if (!img) return; // done, held, or owned by a live worker

  const [gen] = await d.select().from(generations).where(eq(generations.id, img.generationId));
  if (!gen || gen.status !== "running") return;
  const t0 = Date.now();
  const guard = and(eq(generationImages.id, img.id), eq(generationImages.status, "running"));
  try {
    const pause = await generationPause();
    if (pause.paused) {
      await failShot(gen, img.id, { error: pause.message });
      return;
    }
    const source = await getOwnedAsset(gen.userId, gen.sourceAssetId);
    if (!source) throw new Error("Source asset missing");
    // The full cleaned product photo is what the judge compares against. What the image model is shown can be a
    // per-shot view of it (planner v1): off-centre, small, tilted or a real close-up crop.
    const reference = await productReference(source);
    const spec = img.spec ?? null;
    const ar = aspectRatio(gen.aspectRatio);
    const shotRef = spec
      ? await shotReferenceFor(source, { view: spec.view, tiltDeg: spec.tiltDeg, aspect: { width: ar.width, height: ar.height } })
      : { data: reference.data, mime: reference.mime, small: undefined, varied: false };

    // A previous worker may have died after the provider answered: reuse its image instead of paying again.
    let resume: ResumePoint | undefined;
    if (img.assetId && img.attempts > 0 && img.provider) {
      const [prev] = await d.select().from(assets).where(eq(assets.id, img.assetId));
      if (prev) {
        resume = {
          assetId: prev.id,
          data: await storage().get(prev.storageKey),
          width: prev.width,
          height: prev.height,
          provider: img.provider,
          model: img.model ?? img.provider,
          attempts: img.attempts,
          seed: img.seed ?? undefined,
        };
        console.warn(`[generation ${gen.id}] shot ${img.idx} resumed from checkpoint (start ${img.dispatchCount})`);
      }
    }

    const out = await generateFaithfully(
      gen.tier as TierId,
      {
        prompt: img.prompt ?? "",
        image: { data: shotRef.data, mime: shotRef.mime, small: shotRef.small },
        aspectRatio: ar,
        variant: img.idx,
        seed: img.seed ?? seedFor(gen.id, img.idx),
        ctx: { userId: gen.userId, generationId: gen.id, imageId: img.id },
      },
      gen.productSummary || source.classification?.description,
      {
        resume,
        allow: spendGuard(gen, img.id),
        judgeReference: reference.data,
        minProminence: spec?.minProminence ?? "clear",
        retryClosing:
          spec && spec.minProminence !== "hero"
            ? "Reproduce the product exactly as in the provided photo — identical shape, size, colours, pattern and every detail — keeping it clearly visible and unobstructed, and keep this shot's composition as described."
            : undefined,
        checkpoint: async ({ processed, result, attempt, seed }) => {
          const saved = await saveAsset(gen.userId, "output", processed, `out/${gen.id}`);
          await d
            .update(generationImages)
            .set({ assetId: saved.id, provider: result.provider, model: result.model, attempts: attempt, seed: seed ?? img.seed })
            .where(guard);
          return saved.id;
        },
      },
    );

    if (!out.ok && out.held) {
      // The judge couldn't be reached: keep the image private and re-check it before delivering.
      console.warn(`[generation ${gen.id}] shot ${img.idx} held: quality check unavailable`);
      const heldAssetId = out.assetId ?? (await saveAsset(gen.userId, "output", out.processed, `out/${gen.id}`)).id;
      await d
        .update(generationImages)
        .set({
          status: "held",
          provider: out.result.provider,
          model: out.result.model,
          assetId: heldAssetId,
          fidelity: out.fidelity,
          attempts: out.attempts,
          seed: out.seed ?? img.seed,
          error: "Waiting for the quality check",
          nextCheckAt: new Date(Date.now() + FIRST_RECHECK_MS),
          leaseUntil: null,
          latencyMs: Date.now() - t0,
        })
        .where(guard);
    } else if (!out.ok) {
      console.warn(`[generation ${gen.id}] shot ${img.idx} rejected: product changed (${out.fidelity.differences.join("; ")})`);
      await failShot(gen, img.id, {
        error: "Couldn't keep the product identical",
        fidelity: out.fidelity,
        attempts: out.attempts,
        latencyMs: Date.now() - t0,
      });
    } else {
      const assetId = out.assetId ?? (await saveAsset(gen.userId, "output", out.processed, `out/${gen.id}`)).id;
      await d
        .update(generationImages)
        .set({
          status: "succeeded",
          provider: out.result.provider,
          model: out.result.model,
          assetId,
          fidelity: out.fidelity,
          attempts: out.attempts,
          seed: out.seed ?? img.seed,
          leaseUntil: null,
          latencyMs: Date.now() - t0,
        })
        .where(guard);
    }
  } catch (err) {
    const budget = err instanceof BudgetStopError;
    console.error(`[generation ${gen.id}] shot ${img.idx} failed:`, (err as Error).message);
    await failShot(gen, img.id, { error: budget ? "This image couldn't be completed" : "Generation failed", latencyMs: Date.now() - t0 });
  }
  await settleIfDone(gen.id);
}

// ---------- settling ----------

/** Settle the generation if no shot is still pending, running or held. */
export async function settleIfDone(generationId: string, latencyMs?: number): Promise<void> {
  const open = await db()
    .select({ id: generationImages.id })
    .from(generationImages)
    .where(and(eq(generationImages.generationId, generationId), inArray(generationImages.status, ["pending", "running", "held"])))
    .limit(1);
  if (open.length === 0) await finalizeGeneration(generationId, latencyMs);
}

/**
 * Settle a generation: fail whatever is still in flight, release credits for every failed shot (once each),
 * and set the final status. Idempotent. Held images wait for their re-check until HELD_MAX_MS.
 */
export async function finalizeGeneration(generationId: string, latencyMs?: number): Promise<void> {
  const d = db();
  const [gen] = await d.select().from(generations).where(eq(generations.id, generationId));
  if (!gen || ["succeeded", "partial", "failed"].includes(gen.status)) return;

  await d
    .update(generationImages)
    .set({ status: "failed", leaseUntil: null, error: sql`coalesce(${generationImages.error}, 'Timed out')` })
    .where(and(eq(generationImages.generationId, gen.id), inArray(generationImages.status, ["pending", "running"])));

  // Images the judge couldn't verify are neither delivered nor refunded yet: they wait for their re-check,
  // and only after HELD_MAX_MS are they failed (and so refunded below). Credits are never kept for unverified work.
  if (Date.now() - gen.createdAt.getTime() > HELD_MAX_MS) {
    await d
      .update(generationImages)
      .set({ status: "failed", error: "We couldn't verify this image, so you haven't been charged for it", nextCheckAt: null })
      .where(and(eq(generationImages.generationId, gen.id), eq(generationImages.status, "held")));
  }

  const images = await d.select().from(generationImages).where(eq(generationImages.generationId, gen.id));
  if (images.some((i) => i.status === "held")) return; // settled by recheckHeldImages / the sweeper

  for (const img of images.filter((i) => i.status === "failed")) await releaseShotCredit(gen, img.id);

  const ok = images.filter((i) => i.status === "succeeded").length;
  const [fresh] = await d.select({ refunded: generations.refundedCredits }).from(generations).where(eq(generations.id, gen.id));
  await d
    .update(generations)
    .set({
      status: ok === gen.count ? "succeeded" : ok > 0 ? "partial" : "failed",
      completedAt: new Date(),
      // The automatic duplicate-request key only guards a job while it is in flight; once it has settled, the
      // same request again ("Generate again") is a deliberate new job. Client-supplied keys are kept.
      idempotencyKey: sql`case when ${generations.idempotencyKey} like 'auto:%' then null else ${generations.idempotencyKey} end`,
      latencyMs: latencyMs ?? Date.now() - gen.createdAt.getTime(),
      error: ok === 0 ? (gen.error ?? "All images failed to generate. Your credits have been refunded.") : gen.error,
      refundedCredits: fresh?.refunded ?? gen.refundedCredits,
    })
    .where(and(eq(generations.id, gen.id), inArray(generations.status, ["queued", "running"])));
}

// ---------- held images ----------

/**
 * Re-judge images held because no quality verdict was available. A pass delivers the image, a fail rejects it,
 * and "still no verdict" backs off and tries again until HELD_MAX_MS. Safe to call concurrently and repeatedly.
 */
export async function recheckHeldImages(generationId: string): Promise<void> {
  const d = db();
  const [gen] = await d.select().from(generations).where(eq(generations.id, generationId));
  if (!gen || !["queued", "running"].includes(gen.status)) return;
  const { FIDELITY_THRESHOLD: threshold } = env();

  const due = await d
    .select()
    .from(generationImages)
    .where(
      and(
        eq(generationImages.generationId, gen.id),
        eq(generationImages.status, "held"),
        or(sql`${generationImages.nextCheckAt} is null`, lt(generationImages.nextCheckAt, new Date())),
      ),
    );
  if (due.length > 0) {
    const source = await getOwnedAsset(gen.userId, gen.sourceAssetId);
    for (const img of due) {
      // Claim the check by pushing the next one out, so concurrent pollers don't all call the judge.
      const backoff = Math.min(FIRST_RECHECK_MS * 2 ** (img.checkCount + 1), MAX_RECHECK_BACKOFF_MS);
      const [claimed] = await d
        .update(generationImages)
        .set({ checkCount: img.checkCount + 1, nextCheckAt: new Date(Date.now() + backoff) })
        .where(and(eq(generationImages.id, img.id), eq(generationImages.status, "held"), eq(generationImages.checkCount, img.checkCount)))
        .returning();
      if (!claimed || !img.assetId || !source) continue;
      try {
        const [asset] = await d.select().from(assets).where(eq(assets.id, img.assetId));
        const [reference, output] = await Promise.all([productReference(source), storage().get(asset.storageKey)]);
        const t0 = Date.now();
        const verdict = await judgeFidelity(reference.data, output, gen.productSummary || source.classification?.description);
        await recordProviderCall({
          stage: "judge",
          provider: verdict?.judge ?? "judge",
          ok: verdict !== null,
          latencyMs: Date.now() - t0,
          estCostMicros: verdict ? STAGE_COST_MICROS.judge : 0,
          ctx: { userId: gen.userId, generationId: gen.id, imageId: img.id, attempt: img.checkCount + 1 },
        });
        if (!verdict) continue; // still unavailable: stays held, backed off
        const fidelity = toFidelity(verdict, threshold, img.spec?.minProminence ?? "clear");
        if (fidelity.passed) {
          await d
            .update(generationImages)
            .set({ status: "succeeded", fidelity, error: null, nextCheckAt: null })
            .where(and(eq(generationImages.id, img.id), eq(generationImages.status, "held")));
        } else {
          await d
            .update(generationImages)
            .set({ status: "failed", fidelity, error: "Couldn't keep the product identical", nextCheckAt: null })
            .where(and(eq(generationImages.id, img.id), eq(generationImages.status, "held")));
          await releaseShotCredit(gen, img.id);
        }
      } catch (err) {
        console.warn(`[generation ${gen.id}] recheck of image ${img.idx} failed:`, (err as Error).message);
      }
    }
  }
  await settleIfDone(gen.id);
}

// ---------- recovery ----------

/**
 * Repair one in-flight generation: a shot whose worker died (expired lease) goes back to pending, or fails
 * once it has been started too often; a pending shot nobody claimed is dispatched again. Returns how many
 * shots were restarted. Cheap, idempotent, and safe to call from a poll or the sweeper.
 */
export async function recoverGeneration(generationId: string): Promise<number> {
  const d = db();
  const [gen] = await d.select().from(generations).where(eq(generations.id, generationId));
  if (!gen || gen.status !== "running") return 0;
  const now = new Date();

  const expired = await d
    .select()
    .from(generationImages)
    .where(and(eq(generationImages.generationId, gen.id), eq(generationImages.status, "running"), lt(generationImages.leaseUntil, now)));
  for (const img of expired) {
    if (img.dispatchCount >= MAX_SHOT_DISPATCHES) {
      await failShot(gen, img.id, { error: "Generation stopped responding" });
    } else {
      await d
        .update(generationImages)
        .set({ status: "pending", leaseUntil: null })
        .where(and(eq(generationImages.id, img.id), eq(generationImages.status, "running"), lt(generationImages.leaseUntil, now)));
    }
  }

  // Pending shots with a prompt (so planning finished) that no worker picked up in a while.
  const stuck: GenerationImage[] =
    Date.now() - gen.createdAt.getTime() > LOST_DISPATCH_MS
      ? await d
          .select()
          .from(generationImages)
          .where(
            and(
              eq(generationImages.generationId, gen.id),
              eq(generationImages.status, "pending"),
              lt(generationImages.dispatchCount, MAX_SHOT_DISPATCHES),
              sql`${generationImages.prompt} is not null`,
            ),
          )
      : [];
  const failedForDispatches = await d
    .select()
    .from(generationImages)
    .where(
      and(
        eq(generationImages.generationId, gen.id),
        eq(generationImages.status, "pending"),
        sql`${generationImages.dispatchCount} >= ${MAX_SHOT_DISPATCHES}`,
      ),
    );
  for (const img of failedForDispatches) await failShot(gen, img.id, { error: "Generation stopped responding" });

  await dispatchShots(stuck.map((s) => s.id));
  await settleIfDone(gen.id);
  return stuck.length;
}

/** Fail + refund generations that have been in flight longer than STALE_AFTER_MS. */
export async function failStaleGenerations(userId?: string): Promise<number> {
  const stale = await db()
    .select({ id: generations.id })
    .from(generations)
    .where(
      and(
        userId ? eq(generations.userId, userId) : undefined,
        inArray(generations.status, ["queued", "running"]),
        lt(generations.createdAt, new Date(Date.now() - STALE_AFTER_MS)),
      ),
    );
  for (const s of stale) await finalizeGeneration(s.id);
  return stale.length;
}

/** Per-user recovery used when a user polls or lists, so jobs recover even without a scheduler. */
export async function reapStaleGenerations(userId: string) {
  await failStaleGenerations(userId);
  const running = await db()
    .select({ id: generations.id })
    .from(generations)
    .where(and(eq(generations.userId, userId), eq(generations.status, "running")));
  for (const g of running) await recoverGeneration(g.id);
}

export interface SweepResult {
  plannedQueued: number;
  recoveredShots: number;
  failedStale: number;
  recheckedGenerations: number;
}

/**
 * The scheduled sweep (see /api/cron/sweep): start generations nobody started, restart shots whose worker
 * died, re-check held images, and fail anything past its deadline (refunding it). Idempotent.
 */
export async function sweepJobs(limit = 50): Promise<SweepResult> {
  const d = db();
  const result: SweepResult = { plannedQueued: 0, recoveredShots: 0, failedStale: 0, recheckedGenerations: 0 };

  result.failedStale = await failStaleGenerations();

  // Queued, never started (the request that should have run it died).
  const queued = await d
    .select({ id: generations.id })
    .from(generations)
    .where(and(eq(generations.status, "queued"), lt(generations.createdAt, new Date(Date.now() - LOST_DISPATCH_MS))))
    .orderBy(asc(generations.createdAt))
    .limit(limit);
  for (const g of queued) {
    await runGeneration(g.id);
    result.plannedQueued++;
  }

  const running = await d
    .select({ id: generations.id })
    .from(generations)
    .where(eq(generations.status, "running"))
    .orderBy(asc(generations.createdAt))
    .limit(limit);
  for (const g of running) {
    result.recoveredShots += await recoverGeneration(g.id);
    await recheckHeldImages(g.id);
    result.recheckedGenerations++;
  }
  return result;
}
