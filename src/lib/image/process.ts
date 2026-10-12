import "server-only";
import convertHeic from "heic-convert";
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
/** Below this the product can't be made out reliably. */
export const MIN_UPLOAD_SIDE = 150;
/** Small uploads are upscaled to at least this on the longest side. */
const UPSCALE_TO = 1024;

/** Hard cap on decoded pixels (decompression-bomb guard); sharp's default is 268 MP. */
const MAX_INPUT_PIXELS = 100_000_000;

type Sniffed = "jpeg" | "png" | "gif" | "webp" | "tiff" | "avif" | "heic" | "bmp" | "pdf" | "svg" | "unknown";

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"]);

/** Identify the real file type from its bytes, never from its name or MIME type. */
export function sniffImage(b: Buffer): Sniffed {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  const head = b.subarray(0, 12).toString("latin1");
  if (head.startsWith("GIF8")) return "gif";
  if (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") return "webp";
  if (head.startsWith("II*\0") || head.startsWith("MM\0*")) return "tiff";
  if (head.startsWith("BM")) return "bmp";
  if (head.startsWith("%PDF")) return "pdf";
  if (head.slice(4, 8) === "ftyp") {
    const brand = head.slice(8, 12);
    if (brand === "avif" || brand === "avis") return "avif";
    if (HEIC_BRANDS.has(brand)) return "heic";
    // Generic HEIF container (mif1/msf1): HEIC unless it says AVIF in its compatible brands.
    if (brand === "mif1" || brand === "msf1") {
      return b.subarray(8, Math.min(b.length, 64)).toString("latin1").includes("avif") ? "avif" : "heic";
    }
  }
  const text = b.subarray(0, 256).toString("utf8").trimStart().toLowerCase();
  if (text.startsWith("<svg") || (text.startsWith("<?xml") && text.includes("<svg"))) return "svg";
  return "unknown";
}

const READ_ERROR =
  "We couldn't read this photo — the file may be damaged or incomplete. Please re-save or re-take it and upload again.";

/** HEIC/HEVC (iPhone) photos: sharp's prebuilt libheif can't decode them, so convert to JPEG first. */
async function heicToJpeg(input: Buffer): Promise<Buffer> {
  try {
    const out = await convertHeic({ buffer: input, format: "JPEG", quality: 0.92 });
    return Buffer.from(out);
  } catch {
    throw new UnsupportedImageError(
      "We couldn't open this iPhone (HEIC) photo. Please export it as JPEG (Photos → Share → Save as JPEG, or set Camera → Formats → Most Compatible) and upload again.",
      "heic_unreadable",
    );
  }
}

/** Validate + normalise an uploaded product photo: fix EXIF rotation, cap size, JPEG. */
export async function normalizeUpload(raw: Buffer): Promise<ProcessedImage> {
  if (raw.length === 0) throw new UnsupportedImageError("This file is empty. Please choose your product photo again.", "empty_file");

  const kind = sniffImage(raw);
  if (kind === "pdf" || kind === "svg" || kind === "bmp" || kind === "unknown") {
    const what = kind === "pdf" ? "a PDF" : kind === "svg" ? "an SVG graphic" : kind === "bmp" ? "a BMP image" : "not a supported image";
    throw new UnsupportedImageError(
      `This file is ${what}. Please upload a JPG, PNG, WebP or iPhone (HEIC) photo of your product.`,
      "unsupported_format",
    );
  }
  const input = kind === "heic" ? await heicToJpeg(raw) : raw;

  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch (err) {
    throw readError(err);
  }
  if (!meta.format || !ACCEPTED.has(meta.format)) {
    throw new UnsupportedImageError(
      `This image format (${meta.format ?? "unknown"}) isn't supported. Please upload a JPG, PNG, WebP or iPhone (HEIC) photo.`,
      "unsupported_format",
    );
  }
  const longest = Math.max(meta.width ?? 0, meta.height ?? 0);
  if (longest < MIN_UPLOAD_SIDE) {
    throw new UnsupportedImageError(`Image is too small — please upload at least ${MIN_UPLOAD_SIDE} px on the longest side.`, "too_small");
  }
  // Sellers often only have small web / WhatsApp images: upscale those so
  // image models get a usable reference, and cap large ones.
  const target = Math.min(Math.max(longest, UPSCALE_TO), 2048);
  try {
    const pipeline = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: target, height: target, fit: "inside", kernel: "lanczos3" })
      .flatten({ background: "#ffffff" });
    const { data, info } = await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    const thumb = await makeThumb(data);
    return { data, mime: "image/jpeg", width: info.width, height: info.height, thumb };
  } catch (err) {
    throw readError(err);
  }
}

function readError(err: unknown): UnsupportedImageError {
  if (err instanceof UnsupportedImageError) return err;
  if (/pixel limit/i.test((err as Error)?.message ?? "")) {
    return new UnsupportedImageError(
      "This photo has too many pixels to process. Please resize it (under about 100 megapixels) and upload again.",
      "too_many_pixels",
    );
  }
  return new UnsupportedImageError(READ_ERROR, "corrupt_image");
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

export class UnsupportedImageError extends Error {
  constructor(
    message: string,
    public readonly code = "unsupported_image",
  ) {
    super(message);
  }
}
