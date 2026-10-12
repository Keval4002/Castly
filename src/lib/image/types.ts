import type { AspectRatio } from "@/lib/catalog/options";

export interface ImageRequest {
  prompt: string;
  /** The user's product photo (normalised JPEG). */
  image: { data: Buffer; mime: string };
  aspectRatio: AspectRatio;
  /** Variant index, used by providers that accept seeds. */
  variant: number;
}

export interface ImageResult {
  data: Buffer;
  model: string;
}

export interface ImageProvider {
  id: string;
  model: string;
  available(): boolean;
  generate(req: ImageRequest): Promise<ImageResult>;
}
