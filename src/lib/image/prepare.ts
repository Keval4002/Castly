import "server-only";
import sharp from "sharp";
import { removeBackground, type Mask } from "./background";
import { makeThumb, type ProcessedImage } from "./process";

/**
 * Product-photo cleaning, run right after upload while the seller picks settings.
 *
 * It only changes what is around the product — never the product's own
 * pixels (no colour, exposure, denoise or sharpening changes):
 *   1. background removal (BiRefNet) → alpha mask
 *   2. mask repair: holes the model punched into the product are filled back,
 *      real see-through gaps (filigree, chain links) are kept
 *   3. product placed on a clean white background, cropped and centred with padding
 * Without a background model it trims plain borders and pads instead.
 */
export interface PreparedProduct {
  clean: ProcessedImage;
  method: Mask["method"] | "basic";
  /** Share of the frame the product covers after cleaning (0–1). */
  coverage: number;
  /** Mask pixels restored to the product by hole repair. */
  repairedPixels: number;
  /** Transparent PNG (RGBA) tight-cropped to the product; alpha is the repaired mask. Absent for basic cleaning. */
  cutout?: { data: Buffer; width: number; height: number };
}

/** Longest side of the cleaned reference sent to image models. */
const REFERENCE_SIDE = 1536;
/** White margin around the product, as a share of its larger side. */
const PADDING = 0.08;
/** Mean-RGB distance under which an enclosed gap counts as background showing through. */
const HOLE_COLOR_TOLERANCE = 38;
const SOLID = 128;

export async function prepareProduct(upload: Buffer): Promise<PreparedProduct> {
  const mask = await removeBackground(upload).catch((err) => {
    console.warn(`[prepare] background removal failed, using basic cleaning: ${(err as Error).message}`);
    return null;
  });
  if (mask) {
    const result = await composeWithMask(upload, mask);
    if (result) return result;
  }
  return basicClean(upload);
}

/** Cut out with the mask and place on white. Null when the mask is implausible. */
export async function composeWithMask(upload: Buffer, mask: Pick<Mask, "data" | "width" | "height"> & { method: PreparedProduct["method"] }): Promise<PreparedProduct | null> {
  const { width, height } = mask;
  if (mask.data.length !== width * height) throw new Error(`Mask must be single-channel ${width}x${height}`);
  const rgb = await sharp(upload).resize(width, height, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const { alpha, repaired } = repairMask(mask.data, rgb, width, height);

  const box = boundingBox(alpha, width, height);
  const coverage = box ? countSolid(alpha) / (width * height) : 0;
  // Empty or near-full masks mean the model didn't find a single product.
  if (!box || coverage < 0.005 || coverage > 0.97) return null;

  // Two pipelines: sharp applies extract() before joinChannel() within one.
  const rgba = await sharp(rgb, { raw: { width, height, channels: 3 } })
    .joinChannel(Buffer.from(alpha), { raw: { width, height, channels: 1 } })
    .raw()
    .toBuffer();
  const cut = await sharp(rgba, { raw: { width, height, channels: 4 } }).extract(box).png().toBuffer();
  const clean = await placeOnWhite(cut, box.width, box.height);
  return {
    clean,
    method: mask.method,
    coverage: Math.round(coverage * 1000) / 1000,
    repairedPixels: repaired,
    cutout: { data: cut, width: box.width, height: box.height },
  };
}

async function basicClean(upload: Buffer): Promise<PreparedProduct> {
  let img = sharp(upload);
  let { width = 0, height = 0 } = await img.metadata();
  try {
    // Remove plain borders around the product (threshold keeps soft shadows).
    const { data, info } = await sharp(upload).trim({ threshold: 18 }).toBuffer({ resolveWithObject: true });
    if (info.width * info.height >= width * height * 0.2) {
      img = sharp(data);
      ({ width, height } = info);
    }
  } catch {
    // Nothing to trim.
  }
  const clean = await placeOnWhite(await img.png().toBuffer(), width, height);
  return { clean, method: "basic", coverage: 1, repairedPixels: 0 };
}

async function placeOnWhite(png: Buffer, width: number, height: number): Promise<ProcessedImage> {
  const pad = Math.round(Math.max(width, height) * PADDING);
  const { data, info } = await sharp(png)
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 255, g: 255, b: 255, alpha: 1 } }) // opaque: sharp flattens before extending
    .flatten({ background: "#ffffff" })
    .resize({ width: REFERENCE_SIDE, height: REFERENCE_SIDE, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { data, mime: "image/jpeg", width: info.width, height: info.height, thumb: await makeThumb(data) };
}

/**
 * Fill holes that segmentation punched into the product.
 *
 * A gap fully enclosed by the product is either background showing through
 * (filigree, a ring's centre) or part of the product the model mis-segmented
 * (a gold dot on a red dress). We compare each gap's colour in the original
 * photo with the surrounding background: similar → keep transparent,
 * different → restore it as product. When unsure we keep pixels, never drop them.
 */
export function repairMask(alphaIn: Uint8Array, rgb: Uint8Array, width: number, height: number) {
  const n = width * height;
  const alpha = Uint8Array.from(alphaIn);
  const solid = (i: number) => alpha[i] >= SOLID;

  // Background connected to the frame edge.
  const outside = new Uint8Array(n);
  const stack: number[] = [];
  const seed = (i: number) => {
    if (!solid(i) && !outside[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < width; x++) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    seed(y * width);
    seed(y * width + width - 1);
  }
  flood(stack, width, height, (j) => {
    if (solid(j) || outside[j]) return false;
    outside[j] = 1;
    return true;
  });

  const bg = [0, 0, 0];
  let bgN = 0;
  for (let i = 0; i < n; i += 7) {
    if (!outside[i]) continue;
    for (let c = 0; c < 3; c++) bg[c] += rgb[i * 3 + c];
    bgN++;
  }

  // Enclosed gaps, one connected component at a time.
  const seen = new Uint8Array(n);
  let repaired = 0;
  for (let i = 0; i < n; i++) {
    if (solid(i) || outside[i] || seen[i]) continue;
    const comp = [i];
    seen[i] = 1;
    const sum = [0, 0, 0];
    for (let k = 0; k < comp.length; k++) {
      const p = comp[k];
      for (let c = 0; c < 3; c++) sum[c] += rgb[p * 3 + c];
      for (const q of neighbours(p, width, height)) {
        if (!solid(q) && !outside[q] && !seen[q]) {
          seen[q] = 1;
          comp.push(q);
        }
      }
    }
    const m = comp.length;
    const isBackground =
      bgN > 0 && Math.hypot(...sum.map((v, c) => v / m - bg[c] / bgN)) <= HOLE_COLOR_TOLERANCE;
    if (!isBackground) {
      for (const p of comp) alpha[p] = 255;
      repaired += m;
    }
  }
  return { alpha, repaired };
}

function* neighbours(p: number, width: number, height: number) {
  const x = p % width;
  if (x > 0) yield p - 1;
  if (x < width - 1) yield p + 1;
  if (p >= width) yield p - width;
  if (p < width * (height - 1)) yield p + width;
}

function flood(stack: number[], width: number, height: number, visit: (j: number) => boolean) {
  while (stack.length) {
    const p = stack.pop()!;
    for (const q of neighbours(p, width, height)) if (visit(q)) stack.push(q);
  }
}

function countSolid(alpha: Uint8Array) {
  let c = 0;
  for (let i = 0; i < alpha.length; i++) if (alpha[i] >= SOLID) c++;
  return c;
}

function boundingBox(alpha: Uint8Array, width: number, height: number) {
  let [minX, minY, maxX, maxY] = [width, height, -1, -1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] < 16) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
