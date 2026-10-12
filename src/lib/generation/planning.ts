import "server-only";
import { describeSelections, type CategoryId } from "@/lib/catalog/options";
import type { Asset, Generation } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { availableAngles } from "@/lib/product-photos";
import { sampleCastings } from "@/lib/prompt/shared";
import { getPreset } from "@/lib/shots/presets";
import { planShots } from "@/lib/shots/planner";
import { renderShotPrompt } from "@/lib/shots/prompt";
import type { Family, PhotoAngle, PlanResult, ProductProfile, ShotSpec } from "@/lib/shots/types";

/** v1 = per-shot specs, reference views and prompts; off = the legacy single-reference flow. */
export function plannerMode(): "v1" | "off" {
  return env().SHOT_PLANNER ?? (env().NODE_ENV === "production" ? "off" : "v1");
}

const ON_MODEL_PRESENTATIONS: Record<CategoryId, string[]> = {
  clothing: ["on_model_full", "on_model_half", "on_model_detail"],
  jewellery: ["on_model_closeup", "on_model_portrait", "hand_model"],
};

/** Is the seller's chosen presentation a person wearing the product, or the product on its own? */
export function familyFor(category: CategoryId, options: Record<string, string>): Family {
  return ON_MODEL_PRESENTATIONS[category].includes(options.presentation ?? "") ? "on_model" : "product_only";
}

/** Stand-in profile when preparation hasn't measured one (older uploads, failed cleaning): colours unknown. */
export function estimatedProfile(category: CategoryId, source: Pick<Asset, "classification" | "width" | "height">): ProductProfile {
  const cls = source.classification;
  return {
    version: 1,
    category,
    productType: cls?.productType ?? null,
    description: cls?.description ?? null,
    colours: [],
    aspect: source.width && source.height ? source.width / source.height : 1,
    pixels: { width: source.width ?? 0, height: source.height ?? 0 },
    solidShare: 1,
    source: "estimate",
  };
}

export interface PlannedGeneration {
  specs: ShotSpec[];
  prompts: string[];
  productSummary: string;
  plan: Omit<PlanResult, "specs"> & { planner: string };
}

/** Deterministic seed for a generation, so "redo" with the same inputs gives the same plan. */
function planSeed(generationId: string): number {
  let h = 2166136261;
  for (let i = 0; i < generationId.length; i++) h = Math.imul(h ^ generationId.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Plan every shot of a generation: structured specs from the preset's fixed vocabulary (every pair of shots
 * differs on several attributes), then one deterministic prompt per shot that starts with that shot's direction.
 * No LLM and no network: it costs nothing and is reproducible. Returns null if it can't plan (caller falls back
 * to the legacy flow).
 */
export async function planGeneration(
  gen: Generation,
  source: Asset,
  recentPrompts: string[],
): Promise<PlannedGeneration | null> {
  const category = gen.category as CategoryId;
  const family = familyFor(category, gen.options);
  const preset = getPreset(category, family);
  const profile: ProductProfile = source.profile ?? estimatedProfile(category, source);

  const angles = new Set<PhotoAngle>(["front"]);
  if (gen.productId) for (const a of await availableAngles(gen.productId)) angles.add(a);

  const result = planShots({
    presetId: preset.id,
    family,
    count: gen.count,
    profile,
    availableAngles: angles,
    locks: lockedAxes(category, gen.options),
    seed: planSeed(gen.id),
    minDifferences: 3,
    productType: gen.productType,
  });
  if (result.specs.length === 0) return null;

  // A person per on-model shot, never the same one twice. Hair is a shot attribute, so castings leave it out.
  const castings = sampleCastings(
    { category, values: gen.options, count: result.specs.length, productType: gen.productType, recentPrompts },
    Math.random,
    { omitHair: true },
  );
  const selection = describeSelections(category, gen.options, gen.productType);
  const occasion = selection.find((s) => s.group === "occasion")?.prompt;
  const summary = source.classification?.description?.trim() || profile.description?.trim() || "";

  const prompts = result.specs.map((spec) =>
    renderShotPrompt(spec, {
      profile,
      productSummary: summary || undefined,
      casting: castings[spec.modelSlot],
      occasion,
      customNote: gen.customNote ?? undefined,
    }),
  );

  const { specs: _specs, ...rest } = result;
  void _specs;
  return { specs: result.specs, prompts, productSummary: summary, plan: { ...rest, planner: "v1" } };
}

/**
 * The seller's backdrop choice fixes the background for every shot (a "Marketplace" look stays on plain white);
 * the planner then varies everything else. Ids are the catalogue's; presets translate them.
 */
function lockedAxes(category: CategoryId, options: Record<string, string>): { background?: string } {
  const chosen = category === "clothing" ? options.setting : options.backdrop;
  // The catalogue calls plain white "studio_white"; the presets call it "white_studio". Other ids are shared.
  const background = chosen === "studio_white" ? "white_studio" : chosen;
  // Lighting is not locked: the catalogue's lighting ids describe a mood, and varying it is part of the variety.
  return { background: background || undefined };
}
