/**
 * Shot planner: preset (data) + product profile + what the seller supplied -> structured ShotSpecs.
 * Pure and deterministic: the only randomness is a seeded PRNG, so the same seed gives the same plan.
 */
import { getLatestPresetById } from "./presets";
import type { Preset, ShotTemplate, VocabAxis } from "./presets/types";
import {
  DEFAULT_MIN_DIFFERENCES,
  SHOT_AXES,
  type PlanInput,
  type PlanResult,
  type ProductProfile,
  type ShotSpec,
  type SkippedShot,
} from "./types";

export interface PlanOptions {
  /** Use the same person (modelSlot 0) in every on-model shot instead of a distinct person per shot. */
  sameModelAcrossSet?: boolean;
}

const MAX_COUNT = 12;
const CANDIDATES_PER_SHOT = 120;
const RESTARTS = 16;
const REFINE_PASSES = 2;

// ---------- seeded PRNG ----------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)]!;
}

// ---------- variety ----------

/** Number of SHOT_AXES on which two shots differ (`view` compares the view id). */
export function pairwiseDifferences(a: ShotSpec, b: ShotSpec): number {
  let n = 0;
  for (const axis of SHOT_AXES) if (a[axis] !== b[axis]) n++;
  return n;
}

function minDiffOf(specs: readonly ShotSpec[]): number {
  if (specs.length < 2) return SHOT_AXES.length; // no pairs: vacuously "everything differs"
  let min = Infinity;
  for (let i = 0; i < specs.length; i++) for (let j = i + 1; j < specs.length; j++) min = Math.min(min, pairwiseDifferences(specs[i]!, specs[j]!));
  return min;
}

// ---------- colour clash ----------

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function toHsl([r, g, b]: [number, number, number]): { h: number; s: number; l: number } {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === R) h = ((G - B) / d) % 6;
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

const NEAR_IDENTICAL_RGB = 48;
const HUE_CLASH_DEG = 30;
const LIGHTNESS_CLASH = 0.28;

function isChromatic(c: { s: number; l: number }): boolean {
  return c.s > 0.25 && c.l > 0.12 && c.l < 0.88;
}

/**
 * True if two colours would blend or fight: near-identical colour, or similar hue (< 30 degrees) at similar lightness.
 * Neutrals (ivory, white, black, charcoal, greys) never clash with a different colour. Unparseable colours never clash.
 */
export function coloursClash(a: string, b: string): boolean {
  const ra = parseHex(a), rb = parseHex(b);
  if (!ra || !rb) return false;
  const dist = Math.hypot(ra[0] - rb[0], ra[1] - rb[1], ra[2] - rb[2]);
  if (dist < NEAR_IDENTICAL_RGB) return true;
  const ha = toHsl(ra), hb = toHsl(rb);
  if (!isChromatic(ha) || !isChromatic(hb)) return false;
  const dh = Math.min(Math.abs(ha.h - hb.h), 360 - Math.abs(ha.h - hb.h));
  return dh < HUE_CLASH_DEG && Math.abs(ha.l - hb.l) < LIGHTNESS_CLASH;
}

const METAL_HEX: Record<string, string | undefined> = {
  yellow_gold: "#d4af37",
  rose_gold: "#b76e79",
  silver: "#c0c0c0",
  oxidised: "#4a4a4a",
};

/** The colours a styling entry must not clash with: the product's top two colours and (jewellery) its metal. */
export function productColoursToAvoid(profile: ProductProfile): string[] {
  const out = profile.colours.slice(0, 2).map((c) => c.hex);
  const metal = profile.metalTone ? METAL_HEX[profile.metalTone] : undefined;
  if (profile.category === "jewellery" && metal) out.push(metal);
  return out;
}

function stylingPool(preset: Preset, allowed: readonly string[] | undefined, avoid: readonly string[]): string[] {
  const ids = (allowed ?? Object.keys(preset.vocabulary.styling)).filter((id) => id in preset.vocabulary.styling);
  const entries = ids.map((id) => ({ id, tone: preset.vocabulary.styling[id]!.tone }));
  const clean = entries.filter((e) => !e.tone || !avoid.some((c) => coloursClash(e.tone!, c)));
  if (clean.length >= 2) return clean.map((e) => e.id);
  // Too few safe options: fall back to the safe ones plus any with no colour, then to everything the template allows.
  const noTone = entries.filter((e) => !e.tone);
  if (clean.length + noTone.length > 0) return [...new Set([...clean, ...noTone].map((e) => e.id))];
  return ids;
}

// ---------- eligibility ----------

function longestSide(profile: ProductProfile): number {
  return Math.max(profile.pixels.width, profile.pixels.height);
}

function typeMatches(t: ShotTemplate, productType: string | null | undefined): boolean {
  if (!t.productTypes || t.productTypes.length === 0 || !productType) return true;
  const pt = productType.toLowerCase();
  return t.productTypes.some((w) => pt.includes(w.toLowerCase()));
}

function splitEligible(preset: Preset, input: PlanInput): { eligible: ShotTemplate[]; skipped: SkippedShot[] } {
  const productType = input.productType ?? input.profile.productType;
  const sorted = [...preset.templates].sort((a, b) => a.priority - b.priority);
  const eligible: ShotTemplate[] = [];
  const skipped: SkippedShot[] = [];
  for (const t of sorted) {
    const missing = t.requires.find((a) => a !== "front" && !input.availableAngles.has(a));
    if (missing) {
      skipped.push({
        purpose: t.purpose,
        label: t.label,
        reason: t.needsMessage ?? `This shot needs a ${missing} photo — add one to enable it.`,
        needs: missing,
      });
    } else if (!typeMatches(t, productType)) {
      skipped.push({ purpose: t.purpose, label: t.label, reason: "This shot doesn't suit this type of product." });
    } else if (t.minProductPixels && longestSide(input.profile) < t.minProductPixels) {
      skipped.push({
        purpose: t.purpose,
        label: t.label,
        reason: "Your photo is too small for an honest close-up — upload a larger photo to enable it.",
      });
    } else {
      eligible.push(t);
    }
  }
  return { eligible, skipped };
}

function chooseTemplates(eligible: readonly ShotTemplate[], count: number): ShotTemplate[] {
  if (eligible.length === 0 || count <= 0) return [];
  const chosen: ShotTemplate[] = [];
  if (count <= eligible.length) {
    chosen.push(...eligible.slice(0, count));
    // The whole piece must be shown unobstructed at least once.
    const full = eligible.find((t) => t.fullPieceVisible);
    if (count >= 2 && full && !chosen.some((t) => t.fullPieceVisible)) chosen[chosen.length - 1] = full;
  } else {
    for (let i = 0; i < count; i++) chosen.push(eligible[i % eligible.length]!);
  }
  return chosen;
}

// ---------- axis selection ----------

type Free = Pick<ShotSpec, "framing" | "angle" | "pose" | "background" | "lighting" | "styling" | "hair">;

function validIds(preset: Preset, axis: VocabAxis, ids: readonly string[] | undefined): string[] {
  const vocab = preset.vocabulary[axis];
  const list = (ids ?? Object.keys(vocab)).filter((id) => id in vocab);
  return list.length ? list : Object.keys(vocab);
}

function planShotsInner(input: PlanInput, opts: PlanOptions): PlanResult {
  const preset = getLatestPresetById(input.presetId);
  if (!preset) throw new Error(`Unknown shot preset: ${input.presetId}`);
  const target = input.minDifferences ?? DEFAULT_MIN_DIFFERENCES;
  const count = Math.max(0, Math.min(MAX_COUNT, Math.floor(input.count)));
  const { eligible, skipped } = splitEligible(preset, input);
  const templates = chooseTemplates(eligible, count);

  const base = { presetId: preset.id, presetVersion: preset.version, family: preset.family, skipped, target };
  if (templates.length === 0) {
    return { ...base, specs: [], minPairwiseDiff: SHOT_AXES.length, relaxed: count > 0 };
  }

  const lockedBackground = input.locks?.background && input.locks.background in preset.vocabulary.background ? input.locks.background : undefined;
  const lockedLighting = input.locks?.lighting && input.locks.lighting in preset.vocabulary.lighting ? input.locks.lighting : undefined;
  const avoid = productColoursToAvoid(input.profile);

  // Per-shot value pools.
  const pools = templates.map((t) => ({
    framing: validIds(preset, "framing", t.framing),
    angle: validIds(preset, "angle", t.angle),
    pose: validIds(preset, "pose", t.pose),
    background: lockedBackground ? [lockedBackground] : validIds(preset, "background", t.allow?.background),
    lighting: lockedLighting ? [lockedLighting] : validIds(preset, "lighting", t.allow?.lighting),
    styling: stylingPool(preset, t.allow?.styling, avoid),
    hair: validIds(preset, "hair", t.allow?.hair),
  }));

  const onModel = preset.family === "on_model";
  const modelSlot = (i: number) => (onModel && !opts.sameModelAcrossSet ? i : 0);

  const build = (i: number, free: Free): ShotSpec => {
    const t = templates[i]!;
    return {
      presetId: preset.id,
      presetVersion: preset.version,
      family: preset.family,
      purpose: t.purpose,
      purposeLabel: t.label,
      ...free,
      modelSlot: modelSlot(i),
      view: t.view,
      tiltDeg: 0,
      minProminence: t.minProminence,
      requires: [...t.requires],
    };
  };

  const rng = mulberry32(input.seed);
  const randomFree = (i: number): Free => {
    const p = pools[i]!;
    return {
      framing: pick(rng, p.framing),
      angle: pick(rng, p.angle),
      pose: pick(rng, p.pose),
      background: pick(rng, p.background),
      lighting: pick(rng, p.lighting),
      styling: pick(rng, p.styling),
      hair: pick(rng, p.hair),
    };
  };

  /** Score of putting `cand` at slot i: (worst pairwise difference to the others, total difference). */
  const score = (cand: ShotSpec, others: readonly ShotSpec[]): [number, number] => {
    if (others.length === 0) return [SHOT_AXES.length, 0];
    let min = Infinity, sum = 0;
    for (const o of others) {
      const d = pairwiseDifferences(cand, o);
      min = Math.min(min, d);
      sum += d;
    }
    return [min, sum];
  };
  const better = (a: [number, number], b: [number, number]) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);

  const pickBest = (i: number, others: readonly ShotSpec[]): ShotSpec => {
    let best: ShotSpec | undefined;
    let bestScore: [number, number] = [-1, -1];
    for (let k = 0; k < CANDIDATES_PER_SHOT; k++) {
      const cand = build(i, randomFree(i));
      const s = score(cand, others);
      if (!best || better(s, bestScore)) {
        best = cand;
        bestScore = s;
      }
    }
    return best!;
  };

  let bestPlan: ShotSpec[] = [];
  let bestKey: [number, number] = [-1, -1];
  for (let r = 0; r < RESTARTS; r++) {
    const plan: ShotSpec[] = [];
    for (let i = 0; i < templates.length; i++) plan.push(pickBest(i, plan));
    // Refine: re-pick each shot against all the others so early picks can adapt to later ones.
    for (let pass = 0; pass < REFINE_PASSES; pass++) {
      for (let i = 0; i < plan.length; i++) {
        const others = plan.filter((_, j) => j !== i);
        const cand = pickBest(i, others);
        if (better(score(cand, others), score(plan[i]!, others))) plan[i] = cand;
      }
    }
    const key: [number, number] = [minDiffOf(plan), plan.reduce((s, a, i) => s + plan.slice(i + 1).reduce((t, b) => t + pairwiseDifferences(a, b), 0), 0)];
    if (better(key, bestKey)) {
      bestPlan = plan;
      bestKey = key;
    }
    if (key[0] >= target) break;
  }

  // A small deterministic tilt so the product layout is not copied exactly; hero shots stay level.
  const specs = bestPlan.map((s) => {
    const tilt = s.view === "hero" ? 0 : Math.round(rng() * 12 - 6);
    return { ...s, tiltDeg: tilt + 0 };
  });

  const minPairwiseDiff = minDiffOf(specs);
  const relaxed = specs.length < count || (specs.length >= 2 && minPairwiseDiff < target);
  return { ...base, specs, minPairwiseDiff, relaxed };
}

/** Plan `input.count` shots. Same input + seed => identical result. */
export function planShots(input: PlanInput, opts?: PlanOptions): PlanResult {
  return planShotsInner(input, opts ?? {});
}
