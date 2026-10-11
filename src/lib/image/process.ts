import "server-only";
import sharp from "sharp";
import type { AspectRatio } from "@/lib/catalog/options";

export interface ProcessedImage {
  data: Buffer;
  mime: "image/jpeg";
  width: number;
  height: number;
  thumb: Buffer; // webp, for fast gallery loading
}

const ACCEPTED = new Set(["jpeg", "png", "webp", "avif", "gif", "tiff", "heif"]);

/** Validate + normalise an uploaded product photo: fix EXIF rotation, cap size, JPEG. */
export async function normalizeUpload(input: Buffer): Promise<ProcessedImage> {
  const meta = await sharp(input).metadata();
  if (!meta.format || !ACCEPTED.has(meta.format)) {
    throw new UnsupportedImageError(`Unsupported image format: ${meta.format ?? "unknown"}`);
  }
  if ((meta.width ?? 0) < 256 || (meta.height ?? 0) < 256) {
    throw new UnsupportedImageError("Image is too small — please upload at least 256×256 px.");
  }
  const pipeline = sharp(input)
    .rotate()
    .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" });
  const { data, info } = await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  const thumb = await makeThumb(data);
  return { data, mime: "image/jpeg", width: info.width, height: info.height, thumb };
}

/** Center-crop/resize a provider output to the exact requested aspect ratio. */
export async function finalizeOutput(input: Buffer, ar: AspectRatio): Promise<ProcessedImage> {
  const { data, info } = await sharp(input)
    .rotate()
    .resize({ width: ar.width, height: ar.height, fit: "cover", position: "attention" })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  const thumb = await makeThumb(data);
  return { data, mime: "image/jpeg", width: info.width, height: info.height, thumb };
}

export async function makeThumb(input: Buffer): Promise<Buffer> {
  return sharp(input).resize({ width: 512, height: 512, fit: "inside" }).webp({ quality: 78 }).toBuffer();
}

/** Small preview for the prompt LLM (vision) — keeps token cost and latency low. */
export async function llmPreview(input: Buffer): Promise<Buffer> {
  return sharp(input).resize({ width: 512, height: 512, fit: "inside" }).jpeg({ quality: 80 }).toBuffer();
}

export class UnsupportedImageError extends Error {}
