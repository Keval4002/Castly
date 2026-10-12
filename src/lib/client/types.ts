export interface GenerationImageDTO {
  idx: number;
  status: "pending" | "succeeded" | "failed";
  url: string | null;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  provider: string | null;
}

export interface GenerationDTO {
  id: string;
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
}

export function isActive(g: GenerationDTO) {
  return g.status === "queued" || g.status === "running";
}
