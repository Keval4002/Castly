import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { getOwnedAsset, signAssets } from "@/lib/assets";
import { CATEGORIES, CHILD_MODELS_ENABLED, isChildModelChoice, resolveOptions, type CategoryId } from "@/lib/catalog/options";
import { optionsForLook } from "@/lib/catalog/simple";
import { reconcileProduct, type Correction } from "@/lib/classify/reconcile";
import type { CreateGenerationInput } from "@/lib/catalog/request";
import { applyCreditMovement, isUniqueViolation } from "@/lib/credits";
import { db } from "@/lib/db";
import { generationImages, generations, products, type Generation, type GenerationImage } from "@/lib/db/schema";
import { generationCost, TIERS, type TierId } from "@/lib/pricing";
import { generationPause } from "@/lib/switches";
import type { Fidelity } from "@/lib/image/quality";
import { isTierAvailable } from "@/lib/image/router";
import {
  finalizeGeneration,
  recheckHeldImages,
  reapStaleGenerations,
  recoverGeneration,
  runGeneration,
  STALE_AFTER_MS,
  HELD_MAX_MS,
} from "./jobs";

// The job engine lives in ./jobs; these re-exports keep the public surface of this module unchanged.
export { finalizeGeneration, recheckHeldImages, reapStaleGenerations, recoverGeneration, runGeneration, STALE_AFTER_MS, HELD_MAX_MS };
export const MAX_ACTIVE_GENERATIONS = 3;
/** Repeat requests for the same job inside this window return the original job (double click, retry). */
export const DEDUPE_WINDOW_MS = 15 * 1000;

export class GenerationError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
  }
}

export interface CreateGenerationOpts {
  /** The simple look picked in the Studio / bulk flow (stored for display and export). */
  look?: string;
  /** Bulk runs queue past the per-user active limit; they are processed a few at a time. */
  skipActiveCheck?: boolean;
  /** Client Idempotency-Key: a repeat with the same key returns the original job and never charges again. */
  idempotencyKey?: string;
}

/** Stable keys for "this exact request": the client's own key, else a fingerprint bucketed by time. */
function idempotencyKeys(userId: string, input: CreateGenerationInput, opts: CreateGenerationOpts): { write: string; read: string[] } {
  if (opts.idempotencyKey) {
    const k = `key:${opts.idempotencyKey}`;
    return { write: k, read: [k] };
  }
  const options = Object.fromEntries(Object.entries(input.options ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([
        userId,
        input.sourceAssetId,
        input.category,
        input.overrideDetection ?? false,
        input.tier,
        input.count,
        input.aspectRatio,
        input.productType ?? null,
        input.customNote ?? null,
        opts.look ?? null,
        options,
      ]),
    )
    .digest("hex")
    .slice(0, 32);
  const bucket = Math.floor(Date.now() / DEDUPE_WINDOW_MS);
  // Read the previous bucket too, so a double click straddling a boundary is still caught.
  return { write: `auto:${fingerprint}:${bucket}`, read: [`auto:${fingerprint}:${bucket}`, `auto:${fingerprint}:${bucket - 1}`] };
}

async function findByKeys(userId: string, keys: string[]): Promise<Generation | undefined> {
  const [row] = await db()
    .select()
    .from(generations)
    .where(and(eq(generations.userId, userId), or(...keys.map((k) => eq(generations.idempotencyKey, k)))))
    .orderBy(desc(generations.createdAt))
    .limit(1);
  return row;
}

export async function createGeneration(
  userId: string,
  input: CreateGenerationInput,
  opts: CreateGenerationOpts = {},
): Promise<Generation> {
  const pause = await generationPause();
  if (pause.paused) throw new GenerationError(pause.message, 503, "generation_paused");

  // A double click or a retry after a timeout must not create (or charge for) a second job.
  const keys = idempotencyKeys(userId, input, opts);
  const existing = await findByKeys(userId, keys.read);
  if (existing) return existing;

  const tier = input.tier as TierId;
  if (!isTierAvailable(tier)) {
    throw new GenerationError(`${TIERS[tier].label} is temporarily unavailable. Try another quality tier.`, 503, "tier_unavailable");
  }

  const source = await getOwnedAsset(userId, input.sourceAssetId);
  if (!source || source.kind !== "upload") throw new GenerationError("Product photo not found", 404, "asset_not_found");

  // Generated child models are held back until a human-review flow exists (see CHILD_MODELS_ENABLED).
  if (!CHILD_MODELS_ENABLED && Object.values(input.options).some(isChildModelChoice)) {
    throw new GenerationError(
      "Child models aren't available yet. Choose an adult model, or show the garment as a flat lay, on a hanger or on a ghost mannequin.",
      422,
      "child_models_unavailable",
    );
  }

  const d = db();
  const [{ active }] = await d
    .select({ active: sql<number>`count(*)::int` })
    .from(generations)
    .where(
      and(
        eq(generations.userId, userId),
        inArray(generations.status, ["queued", "running"]),
        gte(generations.createdAt, new Date(Date.now() - STALE_AFTER_MS)),
      ),
    );
  if (!opts.skipActiveCheck && active >= MAX_ACTIVE_GENERATIONS) {
    throw new GenerationError("You already have batches in progress. Please wait for them to finish.", 429, "too_many_active");
  }

  // Trust a confident classifier over a mismatching user selection.
  const product = reconcileProduct(
    { category: input.category as CategoryId, productType: input.productType, overrideDetection: input.overrideDetection },
    source.classification ?? null,
  );
  if (!product.ok) {
    throw new GenerationError(
      `This looks like ${product.description ? `“${product.description}”` : "something other than clothing or jewellery"}. ` +
        "Dukaanshot currently supports clothing and jewellery. If this is wrong, confirm your product type and try again.",
      422,
      "unsupported_product",
    );
  }
  const category = product.category;
  const categoryCorrected = product.corrections.some((c) => c.field === "category");

  const cost = generationCost(tier, input.count);
  // Options chosen for the wrong category don't apply — start from that category's first look.
  const options =
    opts.look && categoryCorrected
      ? optionsForLook(category, opts.look, null, product.productType)
      : resolveOptions(
          category,
          categoryCorrected ? CATEGORIES[category].presets[0].values : input.options,
          product.productType,
        );

  const [owner] = await d
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.userId, userId), eq(products.sourceAssetId, source.id)));

  return d
    .transaction(async (tx) => {
    const [gen] = await tx
      .insert(generations)
      .values({
        userId,
        idempotencyKey: keys.write,
        sourceAssetId: source.id,
        productId: owner?.id,
        look: opts.look,
        category,
        productType: product.productType,
        corrections: product.corrections,
        tier,
        aspectRatio: input.aspectRatio,
        options,
        customNote: input.customNote,
        count: input.count,
        costCredits: cost,
      })
      .returning();
    await tx
      .insert(generationImages)
      .values(Array.from({ length: input.count }, (_, idx) => ({ generationId: gen.id, idx })));
    // Throws InsufficientCreditsError → whole transaction rolls back.
    await applyCreditMovement(tx, {
      userId,
      delta: -cost,
      reason: "generation",
      idempotencyKey: `generation:${gen.id}`,
      ref: gen.id,
    });
    return gen;
  })
    .catch(async (err) => {
      // A concurrent identical request won the race: the whole transaction (and its debit) rolled back.
      if (isUniqueViolation(err)) {
        const winner = await findByKeys(userId, keys.read);
        if (winner) return winner;
      }
      throw err;
    });
}

// ---------- read models ----------

export interface GenerationDTO {
  id: string;
  productId: string | null;
  look: string | null;
  status: Generation["status"];
  category: CategoryId;
  productType: string | null;
  corrections: Correction[];
  tier: string;
  aspectRatio: string;
  options: Record<string, string>;
  customNote: string | null;
  count: number;
  costCredits: number;
  refundedCredits: number;
  productSummary: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  source: { id: string; url: string; thumbUrl: string } | null;
  images: {
    idx: number;
    status: GenerationImage["status"];
    url: string | null;
    thumbUrl: string | null;
    width: number | null;
    height: number | null;
    provider: string | null;
    fidelity: Pick<Fidelity, "verified" | "passed" | "score"> | null;
    /** Plain-words purpose of this shot, e.g. "Chest & collar close-up" (planner v1). */
    purpose: string | null;
  }[];
  /** Shots the planner left out and why, e.g. a back view without a back photo. */
  skippedShots: { purpose: string; label: string; reason: string; needs?: string }[];
}

async function toDTOs(gens: Generation[]): Promise<GenerationDTO[]> {
  if (gens.length === 0) return [];
  const images = await db()
    .select()
    .from(generationImages)
    .where(inArray(generationImages.generationId, gens.map((g) => g.id)))
    .orderBy(generationImages.idx);
  const assetIds = [
    ...gens.map((g) => g.sourceAssetId),
    ...images.filter((i) => i.status === "succeeded").map((i) => i.assetId).filter((x): x is string => !!x),
  ];
  const urls = await signAssets(assetIds);

  return gens.map((g) => {
    const src = urls.get(g.sourceAssetId);
    return {
      id: g.id,
      productId: g.productId,
      look: g.look,
      status: g.status,
      category: g.category as CategoryId,
      productType: g.productType,
      corrections: g.corrections,
      tier: g.tier,
      aspectRatio: g.aspectRatio,
      options: g.options,
      customNote: g.customNote,
      count: g.count,
      costCredits: g.costCredits,
      refundedCredits: g.refundedCredits,
      productSummary: g.productSummary,
      skippedShots: g.plan?.skipped ?? [],
      error: g.error,
      createdAt: g.createdAt.toISOString(),
      completedAt: g.completedAt?.toISOString() ?? null,
      source: src ? { id: g.sourceAssetId, url: src.url, thumbUrl: src.thumbUrl } : null,
      images: images
        .filter((i) => i.generationId === g.id)
        .map((i) => {
          const a = i.assetId && i.status === "succeeded" ? urls.get(i.assetId) : undefined;
          return {
            idx: i.idx,
            status: i.status,
            url: a?.url ?? null,
            thumbUrl: a?.thumbUrl ?? null,
            width: a?.width ?? null,
            height: a?.height ?? null,
            provider: i.provider,
            fidelity: i.fidelity ? { verified: i.fidelity.verified, passed: i.fidelity.passed, score: i.fidelity.score } : null,
            purpose: i.spec?.purposeLabel ?? null,
          };
        }),
    };
  });
}

export async function getGeneration(userId: string, id: string): Promise<GenerationDTO | null> {
  const [gen] = await db()
    .select()
    .from(generations)
    .where(and(eq(generations.id, id), eq(generations.userId, userId)));
  if (!gen) return null;
  let current = gen;
  if (["queued", "running"].includes(gen.status)) {
    // Until the scheduled sweep runs everywhere, a poll repairs its own job: dead shots restart, held images
    // are re-checked, and anything past its deadline is failed and refunded.
    await recoverGeneration(gen.id);
    await recheckHeldImages(gen.id);
    if (Date.now() - gen.createdAt.getTime() > STALE_AFTER_MS) await finalizeGeneration(gen.id);
    [current] = await db().select().from(generations).where(eq(generations.id, id));
  }
  const [dto] = await toDTOs([current]);
  return dto;
}

export async function listGenerations(
  userId: string,
  limit = 24,
  before?: Date,
  productId?: string,
): Promise<GenerationDTO[]> {
  await reapStaleGenerations(userId);
  const gens = await db()
    .select()
    .from(generations)
    .where(
      and(
        eq(generations.userId, userId),
        before ? lt(generations.createdAt, before) : undefined,
        productId ? eq(generations.productId, productId) : undefined,
      ),
    )
    .orderBy(desc(generations.createdAt))
    .limit(limit);
  return toDTOs(gens);
}

/**
 * Run queued generations a few at a time (bulk). Never throws; each job is
 * claimed atomically in `runGeneration`, so a duplicate call is harmless.
 */
export async function runQueue(ids: string[], concurrency = MAX_ACTIVE_GENERATIONS): Promise<void> {
  const pending = [...ids];
  const worker = async () => {
    for (let id = pending.shift(); id; id = pending.shift()) await runGeneration(id);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
}
