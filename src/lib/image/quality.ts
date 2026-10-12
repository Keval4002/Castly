/** Shared (client-safe) types for photo cleaning and product-fidelity checks. */

export interface Preparation {
  status: "pending" | "ready" | "failed";
  /** How the background was handled. */
  method?: "fal-birefnet" | "local-birefnet" | "basic";
  coverage?: number;
  repairedPixels?: number;
  ms?: number;
  error?: string;
  startedAt: string;
}

/** How the product sits in the generated frame. */
export type Prominence = "hero" | "clear" | "small" | "not_visible";

export interface Fidelity {
  /** False when no judge was available — the image is unverified (and never counts as passed). */
  verified: boolean;
  passed: boolean;
  /** 0–1, how faithfully the product was reproduced. */
  score: number | null;
  prominence?: Prominence | null;
  differences: string[];
  judge: string | null;
}

export interface Verdict {
  sameProduct: boolean;
  score: number;
  prominence: Prominence;
  differences: string[];
  judge: string;
}

const PROMINENCE_RANK: Record<Prominence, number> = { not_visible: 0, small: 1, clear: 2, hero: 3 };

/**
 * How prominent the product must be in THIS shot. "clear" is the default (the original rule: hero or clear);
 * a wide, styled or off-centre shot only needs "small" (visible, details judgeable); a hidden product always fails.
 */
export type MinProminence = "hero" | "clear" | "small";

/** Identical product AND shown at least as prominently as the shot requires. */
export function passes(v: Verdict, threshold: number, min: MinProminence = "clear"): boolean {
  return v.sameProduct && v.score >= threshold && PROMINENCE_RANK[v.prominence] >= PROMINENCE_RANK[min];
}

/** What to tell the image model on a retry. */
export function retryFeedback(v: Verdict, min: MinProminence = "clear"): string {
  const parts = [...v.differences];
  if (PROMINENCE_RANK[v.prominence] < PROMINENCE_RANK[min]) {
    parts.push(
      min === "small" || min === "clear"
        ? "the product was too small or hidden — keep it clearly visible and unobstructed in the frame"
        : "the product was too small or hidden — make it the large, sharpest focal point",
    );
  }
  return parts.join("; ") || "product details changed";
}

export function toFidelity(v: Verdict | null, threshold: number, min: MinProminence = "clear"): Fidelity {
  // Fail closed: an image nobody could verify is never "passed".
  if (!v) return { verified: false, passed: false, score: null, prominence: null, differences: [], judge: null };
  return {
    verified: true,
    passed: passes(v, threshold, min),
    score: v.score,
    prominence: v.prominence,
    differences: v.differences,
    judge: v.judge,
  };
}

/** Prefer a passing attempt, then the highest score; unverified attempts rank below verified passes. */
export function bestAttempt<T extends { verdict: Verdict | null }>(attempts: T[], threshold: number, min: MinProminence = "clear"): T | undefined {
  const rank = (a: T) => (a.verdict === null ? 1.5 : passes(a.verdict, threshold, min) ? 2 + a.verdict.score : a.verdict.score);
  return [...attempts].sort((a, b) => rank(b) - rank(a))[0];
}
