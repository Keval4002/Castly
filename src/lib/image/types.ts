import type { AspectRatio } from "@/lib/catalog/options";

/** Who a provider call is for, so its cost and outcome can be attributed. */
export interface CallContext {
  userId?: string;
  generationId?: string;
  imageId?: string;
  /** 1-based attempt number for this shot (fidelity retries). */
  attempt?: number;
}

export interface ImageRequest {
  prompt: string;
  /**
   * The product reference (JPEG). `small` is the same view rendered directly at <= 511px (product
   * filling more of the frame) for providers with a tiny reference limit (Cloudflare FLUX.2 klein).
   */
  image: { data: Buffer; mime: string; small?: Buffer };
  aspectRatio: AspectRatio;
  /** Variant index. */
  variant: number;
  /** Sent to providers that accept a seed (recorded per shot so "redo" and "more like this" work). */
  seed?: number;
  /** Attribution for cost recording. */
  ctx?: CallContext;
}

export interface ImageResult {
  data: Buffer;
  model: string;
  /** The provider's own reported charge, in USD micro-dollars, when it reports one. */
  actualCostMicros?: number;
}

/**
 * The only thing the rest of the app knows about an image vendor. Adapters live in ./providers;
 * routing, fallback and cost recording live in ./router, so adding or replacing a vendor (or an
 * in-house model) means writing one adapter and listing it in a tier chain.
 */
export interface ImageProvider {
  id: string;
  model: string;
  available(): boolean;
  generate(req: ImageRequest): Promise<ImageResult>;
}
