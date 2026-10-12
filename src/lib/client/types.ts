export interface GenerationImageDTO {
  idx: number;
  status: "pending" | "running" | "succeeded" | "failed" | "held";
  url: string | null;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  provider: string | null;
  /** Product check: passed = the product was verified identical to the upload. */
  fidelity: { verified: boolean; passed: boolean; score: number | null } | null;
  /** Plain-words purpose of this shot, e.g. "Chest & collar close-up". */
  purpose?: string | null;
}

export interface GenerationDTO {
  id: string;
  productId: string | null;
  look: string | null;
  status: "queued" | "running" | "succeeded" | "partial" | "failed";
  category: "clothing" | "jewellery";
  productType: string | null;
  corrections: { field: "category" | "productType"; from: string | null; to: string }[];
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
  images: GenerationImageDTO[];
  /** Shots left out, with the reason in plain words (e.g. a back view needs a back photo). */
  skippedShots?: { purpose: string; label: string; reason: string; needs?: string }[];
}

export function isActive(g: GenerationDTO) {
  return g.status === "queued" || g.status === "running";
}
