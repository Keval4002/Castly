/**
 * Credit economics. Shared by client and server — no secrets here.
 * Tune these numbers after reviewing docs/PRICING.md.
 */

export const SIGNUP_BONUS_CREDITS = 10;

export type TierId = "economy" | "standard" | "premium";

export interface Tier {
  id: TierId;
  label: string;
  tagline: string;
  creditsPerImage: number;
  /** Rough wall-clock time per batch, shown in the UI. */
  eta: string;
}

export const TIERS: Record<TierId, Tier> = {
  economy: {
    id: "economy",
    label: "Quick",
    tagline: "Fast & cheapest. Great for bulk catalogue drafts.",
    creditsPerImage: 1,
    eta: "~10s",
  },
  standard: {
    id: "standard",
    label: "Studio",
    tagline: "Best balance of realism, product accuracy and speed.",
    creditsPerImage: 2,
    eta: "~15s",
  },
  premium: {
    id: "premium",
    label: "Premium HD",
    tagline: "Highest detail for hero shots, ads and website banners.",
    creditsPerImage: 8,
    eta: "~40s",
  },
};

export const TIER_ORDER: TierId[] = ["economy", "standard", "premium"];
export const DEFAULT_TIER: TierId = "standard";

export interface CreditPack {
  id: string;
  label: string;
  credits: number;
  /** Price in paise (INR × 100). */
  amountPaise: number;
  badge?: string;
}

export const CREDIT_PACKS: CreditPack[] = [
  { id: "starter", label: "Starter", credits: 40, amountPaise: 199_00 },
  { id: "growth", label: "Growth", credits: 110, amountPaise: 499_00, badge: "Popular" },
  { id: "business", label: "Business", credits: 360, amountPaise: 1499_00, badge: "Best value" },
];

export function findPack(id: string): CreditPack | undefined {
  return CREDIT_PACKS.find((p) => p.id === id);
}

export function generationCost(tier: TierId, count: number): number {
  return TIERS[tier].creditsPerImage * count;
}

export function formatINR(paise: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    paise / 100,
  );
}

export const MAX_VARIANTS = 4;
