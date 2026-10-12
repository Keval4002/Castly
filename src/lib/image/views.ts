import "server-only";
import sharp from "sharp";
import type { ReferenceView } from "@/lib/shots/types";

/**
 * Per-shot product reference views, built from the transparent cut-out of the product.
 *
 * Every shot of a set gets its own presentation of the SAME product pixels (centred hero, off-centre,
 * small and loose, real detail crops, slight tilt) on a white canvas with the OUTPUT aspect ratio, so
 * edit models do not copy one shared layout. Only real product pixels are used (a detail crop is a
 * crop, never invented content) and colours are never altered.
 */

const DEFAULT_LONG_SIDE = 1280;
/** Cloudflare FLUX.2 klein takes reference images below 512px. */
const SMALL_LONG_SIDE = 511;
const SMALL_FILL_BOOST = 0.08;
const MAX_FILL = 0.92;
const ALPHA_EDGE = 16;

interface ViewGeometry {
  /** Share of the canvas (per axis) the product may fill. */
  fill: number;
  /** Centre of the product as a share of canvas width / height. */
  cx: number;
  cy: number;
  /** Which part of the cut-out is used (share along the longer axis), full otherwise. */
  crop?: [number, number];
}

const GEOMETRY: Record<ReferenceView, ViewGeometry> = {
  hero: { fill: 0.78, cx: 0.5, cy: 0.5 },
  offset_left: { fill: 0.58, cx: 0.3, cy: 0.5 },
  offset_right: { fill: 0.58, cx: 0.7, cy: 0.5 },
  loose: { fill: 0.38, cx: 0.5, cy: 0.76 },
  detail_centre: { fill: 0.9, cx: 0.5, cy: 0.5, crop: [0.225, 0.775] },
  detail_upper: { fill: 0.9, cx: 0.5, cy: 0.5, crop: [0, 0.45] },
  detail_lower: { fill: 0.9, cx: 0.5, cy: 0.5, crop: [0.55, 1] },
};

export interface ShotReference {
  /** JPEG, long side `longSide`. */
  data: Buffer;
  mime: "image/jpeg";
  /** JPEG rendered directly with long side <= 511 and the product filling more of the frame. */
  small: Buffer;
  view: ReferenceView;
  /** Product size inside `small`. */
  productPx: { width: number; height: number };
  /** True when a detail crop had to be upscaled by more than 2x to fill the frame. */
  detailLoss: boolean;
}

export async function buildShotReference(args: {
  cutout: Buffer;
  view: ReferenceView;
  tiltDeg?: number;
  aspect: { width: number; height: number };
  longSide?: number;
}): Promise<ShotReference> {
  const geo = GEOMETRY[args.view];
  const base = await prepareBase(args.cutout, geo.crop, args.tiltDeg ?? 0);

  const main = await render(base, geo, args.aspect, args.longSide ?? DEFAULT_LONG_SIDE, 0);
  const small = await render(base, geo, args.aspect, SMALL_LONG_SIDE, SMALL_FILL_BOOST);
  return {
    data: main.jpeg,
    mime: "image/jpeg",
    small: small.jpeg,
    view: args.view,
    productPx: { width: small.width, height: small.height },
    detailLoss: Boolean(geo.crop) && main.scale > 2,
  };
}

interface Base {
  png: Buffer;
  width: number;
  height: number;
}

/** Crop (real pixels only), trim to the product, then tilt with transparent corners. */
async function prepareBase(cutout: Buffer, crop: [number, number] | undefined, tiltDeg: number): Promise<Base> {
  let { data, info } = await sharp(cutout).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let png = sharp(cutout).ensureAlpha();
  if (crop) {
    const vertical = info.height >= info.width;
    const len = vertical ? info.height : info.width;
    const from = Math.round(len * crop[0]);
    const to = Math.max(from + 1, Math.round(len * crop[1]));
    const region = vertical
      ? { left: 0, top: from, width: info.width, height: to - from }
      : { left: from, top: 0, width: to - from, height: info.height };
    const cropped = await png.extract(region).png().toBuffer();
    ({ data, info } = await sharp(cropped).raw().toBuffer({ resolveWithObject: true }));
    // The crop may include transparent margins (a narrow neckline); keep only the product's own pixels.
    const box = alphaBox(data, info.width, info.height);
    png = sharp(cropped);
    if (box) png = png.extract(box);
  }
  let out = await png.png().toBuffer();
  if (tiltDeg) {
    out = await sharp(out)
      .rotate(tiltDeg, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
  }
  const meta = await sharp(out).metadata();
  return { png: out, width: meta.width!, height: meta.height! };
}

function alphaBox(rgba: Buffer, width: number, height: number) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] < ALPHA_EDGE) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

async function render(base: Base, geo: ViewGeometry, aspect: { width: number; height: number }, longSide: number, fillBoost: number) {
  const k = longSide / Math.max(aspect.width, aspect.height);
  const W = Math.max(1, Math.round(aspect.width * k));
  const H = Math.max(1, Math.round(aspect.height * k));
  const fill = Math.min(MAX_FILL, geo.fill + fillBoost);

  const scale = Math.min((fill * W) / base.width, (fill * H) / base.height);
  const w = Math.max(1, Math.min(W, Math.round(base.width * scale)));
  const h = Math.max(1, Math.min(H, Math.round(base.height * scale)));
  // Position the product's centre, then keep it inside the canvas with a small margin.
  const margin = Math.round(0.02 * Math.min(W, H));
  const left = clamp(Math.round(geo.cx * W - w / 2), Math.min(margin, W - w), Math.max(0, W - w - margin));
  const top = clamp(Math.round(geo.cy * H - h / 2), Math.min(margin, H - h), Math.max(0, H - h - margin));

  // lanczos3 on RGBA: libvips premultiplies alpha around the resample, so no dark/light halos.
  const px = await sharp(base.png)
    .resize(w, h, { fit: "fill", kernel: "lanczos3" })
    .ensureAlpha()
    .raw()
    .toBuffer();

  // Composite over white by hand: out = c*a + 255*(1-a). Colours of opaque pixels are untouched.
  const canvas = Buffer.alloc(W * H * 3, 255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const a = px[s + 3];
      if (a === 0) continue;
      const d = ((top + y) * W + left + x) * 3;
      if (a === 255) {
        canvas[d] = px[s];
        canvas[d + 1] = px[s + 1];
        canvas[d + 2] = px[s + 2];
      } else {
        const f = a / 255;
        for (let c = 0; c < 3; c++) canvas[d + c] = Math.round(px[s + c] * f + 255 * (1 - f));
      }
    }
  }
  const jpeg = await sharp(canvas, { raw: { width: W, height: H, channels: 3 } })
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: false })
    .toBuffer();
  return { jpeg, width: w, height: h, scale };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
