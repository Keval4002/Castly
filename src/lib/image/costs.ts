/**
 * Estimated provider cost per call, in USD micro-dollars (1 = $0.000001, so $0.039 = 39_000).
 * List prices from docs/PRICING.md (Oct 2026); re-check before relying on them. Where a provider
 * reports its real charge, store it as `actualCostMicros` next to the estimate.
 */
export const IMAGE_COST_MICROS: Record<string, number> = {
  "fal-seedream": 30_000,
  gemini: 39_000,
  "fal-kontext": 40_000,
  // gpt-image-1, quality high, portrait, high-fidelity input (~$0.25 output + ~$0.04 input)
  openai: 290_000,
  cloudflare: 0,
  mock: 0,
};

/** Non-image stages: tiny per-call LLM costs. */
export const STAGE_COST_MICROS: Record<string, number> = {
  plan: 500, // prompt LLM, per batch
  judge: 1_500, // vision fidelity judge, per image
  classify: 500,
  background: 1_000,
};

/**
 * Spend cap per shot (estimated USD micros): every provider attempt, fallback, fidelity retry and worker restart
 * for one shot counts, whether it succeeded or not. When a shot reaches it, no more paid calls are made for it.
 * A Premium shot is ~$0.29 first attempt + ~$0.04 retry on a cheaper model + judges, so $0.40 fits one retry.
 */
export const SHOT_BUDGET_MICROS: Record<"economy" | "standard" | "premium", number> = {
  economy: 100_000,
  standard: 120_000,
  premium: 400_000,
};
/** A whole set may spend at most this share of (shots × per-shot cap), so one runaway set can't drain the budget. */
export const SET_BUDGET_FACTOR = 0.8;

export function estimateImageCostMicros(providerId: string): number {
  return IMAGE_COST_MICROS[providerId] ?? 0;
}

export function microsToUsd(micros: number): number {
  return micros / 1_000_000;
}
