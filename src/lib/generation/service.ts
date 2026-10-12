import "server-only";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { getOwnedAsset, saveAsset, signAssets } from "@/lib/assets";
import { aspectRatio, CATEGORIES, resolveOptions, type CategoryId } from "@/lib/catalog/options";
import { reconcileProduct, type Correction } from "@/lib/classify/reconcile";
import type { CreateGenerationInput } from "@/lib/catalog/request";
import { applyCreditMovement, moveCredits } from "@/lib/credits";
import { db } from "@/lib/db";
import { generationImages, generations, type Generation, type GenerationImage } from "@/lib/db/schema";
import { finalizeOutput, llmPreview } from "@/lib/image/process";
import { generateWithFallback, isTierAvailable } from "@/lib/image/router";
import { generationCost, TIERS, type TierId } from "@/lib/pricing";
import { buildPromptPlan } from "@/lib/prompt/builder";
import { sampleDirections } from "@/lib/prompt/shared";
import { storage } from "@/lib/storage";

export const MAX_ACTIVE_GENERATIONS = 3;
/** Jobs older than this that never finished are failed and refunded. */
export const STALE_AFTER_MS = 10 * 60 * 1000;

export class GenerationError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
  }
}

export async function createGeneration(userId: string, input: CreateGenerationInput): Promise<Generation> {
  const tier = input.tier as TierId;
  if (!isTierAvailable(tier)) {
    throw new GenerationError(`${TIERS[tier].label} is temporarily unavailable. Try another quality tier.`, 503, "tier_unavailable");
  }

  const source = await getOwnedAsset(userId, input.sourceAssetId);
  if (!source || source.kind !== "upload") throw new GenerationError("Product photo not found", 404, "asset_not_found");

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
  if (active >= MAX_ACTIVE_GENERATIONS) {
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
        "Castly currently supports clothing and jewellery. If this is wrong, confirm your product type and try again.",
      422,
      "unsupported_product",
    );
  }
  const category = product.category;
  const categoryCorrected = product.corrections.some((c) => c.field === "category");

  const cost = generationCost(tier, input.count);
  // Options chosen for the wrong category don't apply — start from that category's first look.
  const options = resolveOptions(category, categoryCorrected ? CATEGORIES[category].presets[0].values : input.options);

  return d.transaction(async (tx) => {
    const [gen] = await tx
      .insert(generations)
      .values({
        userId,
        sourceAssetId: source.id,
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
  });
}

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
    .orderBy(desc(generationImages.createdAt))
    .limit(6);
  return rows.map((r) => r.prompt).filter((p): p is string => Boolean(p));
}

/** Runs after the HTTP response is sent (via `after()`). Never throws. */
export async function runGeneration(generationId: string): Promise<void> {
  const d = db();
  const started = Date.now();
  const [claimed] = await d
    .update(generations)
    .set({ status: "running" })
    .where(and(eq(generations.id, generationId), eq(generations.status, "queued")))
    .returning();
  if (!claimed) return; // already picked up or finished
  const gen = claimed;

  try {
    const source = await getOwnedAsset(gen.userId, gen.sourceAssetId);
    if (!source) throw new Error("Source asset missing");
    const ar = aspectRatio(gen.aspectRatio);
    const category = gen.category as CategoryId;

    const [sourceData, recent] = await Promise.all([
      storage().get(source.storageKey),
      recentPrompts(gen.userId, gen.category, gen.id),
    ]);
    const plan = await buildPromptPlan({
      category,
      values: gen.options,
      aspectRatio: ar,
      count: gen.count,
      customNote: gen.customNote ?? undefined,
      productType: gen.productType,
      detectedDescription: source.classification?.description,
      preview: await llmPreview(sourceData),
      recentPrompts: recent,
      directions: sampleDirections(category, gen.count),
    });

    await d
      .update(generations)
      .set({ promptSource: plan.source, productSummary: plan.productSummary || null })
      .where(eq(generations.id, gen.id));

    await Promise.all(
      plan.prompts.map(async (prompt, idx) => {
        const t0 = Date.now();
        await d
          .update(generationImages)
          .set({ prompt })
          .where(and(eq(generationImages.generationId, gen.id), eq(generationImages.idx, idx)));
        try {
          const result = await generateWithFallback(gen.tier as TierId, {
            prompt,
            image: { data: sourceData, mime: source.mime },
            aspectRatio: ar,
            variant: idx,
          });
          const processed = await finalizeOutput(result.data, ar);
          const asset = await saveAsset(gen.userId, "output", processed, `out/${gen.id}`);
          await d
            .update(generationImages)
            .set({
              status: "succeeded",
              provider: result.provider,
              model: result.model,
              assetId: asset.id,
              latencyMs: Date.now() - t0,
            })
            .where(and(eq(generationImages.generationId, gen.id), eq(generationImages.idx, idx)));
        } catch (err) {
          console.error(`[generation ${gen.id}] variant ${idx} failed:`, (err as Error).message);
          await d
            .update(generationImages)
            .set({ status: "failed", error: "Generation failed", latencyMs: Date.now() - t0 })
            .where(and(eq(generationImages.generationId, gen.id), eq(generationImages.idx, idx)));
        }
      }),
    );
  } catch (err) {
    console.error(`[generation ${gen.id}] failed:`, err);
    await d.update(generations).set({ error: "Something went wrong while generating" }).where(eq(generations.id, gen.id));
  }
  await finalizeGeneration(gen.id, Date.now() - started);
}

/**
 * Settle a generation: mark unfinished images failed, refund them once, and
 * set the final status. Idempotent.
 */
export async function finalizeGeneration(generationId: string, latencyMs?: number): Promise<void> {
  const d = db();
  const [gen] = await d.select().from(generations).where(eq(generations.id, generationId));
  if (!gen || ["succeeded", "partial", "failed"].includes(gen.status)) return;

  await d
    .update(generationImages)
    .set({ status: "failed", error: sql`coalesce(${generationImages.error}, 'Timed out')` })
    .where(and(eq(generationImages.generationId, gen.id), eq(generationImages.status, "pending")));

  const images = await d.select().from(generationImages).where(eq(generationImages.generationId, gen.id));
  const ok = images.filter((i) => i.status === "succeeded").length;
  const failed = gen.count - ok;
  const refund = failed * TIERS[gen.tier as TierId].creditsPerImage;

  if (refund > 0) {
    await moveCredits({
      userId: gen.userId,
      delta: refund,
      reason: "refund",
      idempotencyKey: `refund:${gen.id}`,
      ref: gen.id,
    });
  }
  await d
    .update(generations)
    .set({
      status: ok === gen.count ? "succeeded" : ok > 0 ? "partial" : "failed",
      refundedCredits: refund,
      completedAt: new Date(),
      latencyMs: latencyMs ?? null,
      error: ok === 0 ? (gen.error ?? "All images failed to generate. Your credits have been refunded.") : gen.error,
    })
    .where(and(eq(generations.id, gen.id), inArray(generations.status, ["queued", "running"])));
}

/** Fail + refund jobs whose worker died (e.g. serverless timeout). */
export async function reapStaleGenerations(userId: string) {
  const stale = await db()
    .select({ id: generations.id })
    .from(generations)
    .where(
      and(
        eq(generations.userId, userId),
        inArray(generations.status, ["queued", "running"]),
        lt(generations.createdAt, new Date(Date.now() - STALE_AFTER_MS)),
      ),
    );
  for (const s of stale) await finalizeGeneration(s.id);
}

// ---------- read models ----------

export interface GenerationDTO {
  id: string;
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
  }[];
}

async function toDTOs(gens: Generation[]): Promise<GenerationDTO[]> {
  if (gens.length === 0) return [];
  const images = await db()
    .select()
    .from(generationImages)
    .where(inArray(generationImages.generationId, gens.map((g) => g.id)))
    .orderBy(generationImages.idx);
  const assetIds = [...gens.map((g) => g.sourceAssetId), ...images.map((i) => i.assetId).filter((x): x is string => !!x)];
  const urls = await signAssets(assetIds);

  return gens.map((g) => {
    const src = urls.get(g.sourceAssetId);
    return {
      id: g.id,
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
      error: g.error,
      createdAt: g.createdAt.toISOString(),
      completedAt: g.completedAt?.toISOString() ?? null,
      source: src ? { id: g.sourceAssetId, url: src.url, thumbUrl: src.thumbUrl } : null,
      images: images
        .filter((i) => i.generationId === g.id)
        .map((i) => {
          const a = i.assetId ? urls.get(i.assetId) : undefined;
          return {
            idx: i.idx,
            status: i.status,
            url: a?.url ?? null,
            thumbUrl: a?.thumbUrl ?? null,
            width: a?.width ?? null,
            height: a?.height ?? null,
            provider: i.provider,
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
  if (["queued", "running"].includes(gen.status) && Date.now() - gen.createdAt.getTime() > STALE_AFTER_MS) {
    await finalizeGeneration(gen.id);
    return getGeneration(userId, id);
  }
  const [dto] = await toDTOs([gen]);
  return dto;
}

export async function listGenerations(userId: string, limit = 24, before?: Date): Promise<GenerationDTO[]> {
  await reapStaleGenerations(userId);
  const gens = await db()
    .select()
    .from(generations)
    .where(and(eq(generations.userId, userId), before ? lt(generations.createdAt, before) : undefined))
    .orderBy(desc(generations.createdAt))
    .limit(limit);
  return toDTOs(gens);
}
