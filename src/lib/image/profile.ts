import "server-only";
import sharp from "sharp";
import type { Classification } from "@/lib/classify/reconcile";
import type { CategoryKey, ProductProfile } from "@/lib/shots/types";

/**
 * Measured product profile: colours, metal tone, shape and how much real detail a cut-out has.
 * Everything is computed from the product's OWN pixels (cut-out alpha >= 128), never from the
 * background. Without a cut-out we estimate from a white-background photo.
 */

const ANALYSIS_SIDE = 256;
const SOLID = 128;
const MAX_COLOURS = 4;
/** Lab distance under which two colours count as the same shade and are merged. */
const MERGE_DELTA = 14;
/** Clusters below this share of the product are dropped (noise, edge pixels). */
const MIN_SHARE = 0.03;

/** Indian fashion / jewellery colour names. Nearest in CIELAB wins. */
const NAMES: [string, string][] = [
  ["maroon", "#6d1020"], ["wine", "#5c1a33"], ["burgundy", "#7a1f3d"], ["red", "#c8102e"], ["rust", "#a8421c"],
  ["orange", "#e8761c"], ["saffron", "#f08a1c"], ["peach", "#f6b59b"], ["coral", "#ee6f5b"], ["rani pink", "#d81b78"],
  ["magenta", "#b5127a"], ["pink", "#f08cae"], ["baby pink", "#f8cfd8"], ["mustard", "#d9a21b"], ["yellow", "#f2d230"],
  ["lemon", "#efe66a"], ["gold", "#d4af37"], ["antique gold", "#a8863a"], ["rose gold", "#c58b84"], ["copper", "#b4673b"],
  ["brown", "#5e3a24"], ["tan", "#b58c5e"], ["beige", "#d7c3a1"], ["cream", "#f1e6c8"], ["ivory", "#f7f1e1"],
  ["white", "#fafafa"], ["silver grey", "#b9bbc0"], ["grey", "#808285"], ["charcoal", "#3a3c40"], ["black", "#0f0f10"],
  ["olive", "#6b6b2a"], ["bottle green", "#0b4a2f"], ["emerald", "#0e8a5a"], ["parrot green", "#6fbf3b"], ["mint", "#a6dcc0"],
  ["teal", "#0e6f73"], ["turquoise", "#2bb3b1"], ["sky blue", "#7fbfe6"], ["royal blue", "#1d3fa8"], ["navy", "#14214a"],
  ["lavender", "#b9a6dc"], ["purple", "#5d2a82"], ["mauve", "#9b6b8e"],
];

type Lab = [number, number, number];
type Rgb = { r: number; g: number; b: number };

function srgbToLab(r: number, g: number, b: number): Lab {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const [fx, fy, fz] = [f(X), f(Y), f(Z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const dist = (a: Lab, b: Lab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const hexToRgb = (h: string): [number, number, number] =>
  [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
const NAMED = NAMES.map(([name, hex]) => ({ name, lab: srgbToLab(...hexToRgb(hex)) }));

export function colourName(r: number, g: number, b: number): string {
  const lab = srgbToLab(r, g, b);
  let best = NAMED[0];
  let bestD = Infinity;
  for (const n of NAMED) {
    const d = dist(lab, n.lab);
    if (d < bestD) {
      best = n;
      bestD = d;
    }
  }
  return best.name;
}

const toHex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

export function dominantColours(px: Rgb[]): ProductProfile["colours"] {
  if (!px.length) return [];
  // 4-bit-per-channel buckets.
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (const p of px) {
    const key = ((p.r >> 4) << 8) | ((p.g >> 4) << 4) | (p.b >> 4);
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++;
    e.r += p.r;
    e.g += p.g;
    e.b += p.b;
    buckets.set(key, e);
  }
  const list = [...buckets.entries()]
    .map(([key, e]) => ({ key, ...e, rgb: [e.r / e.n, e.g / e.n, e.b / e.n] as [number, number, number] }))
    .sort((a, b) => b.n - a.n || a.key - b.key);
  const labs = list.map((e) => srgbToLab(...e.rgb));
  const used = new Array<boolean>(list.length).fill(false);
  const clusters: { n: number; r: number; g: number; b: number }[] = [];
  for (let i = 0; i < list.length && clusters.length < 8; i++) {
    if (used[i]) continue;
    const c = { n: 0, r: 0, g: 0, b: 0 };
    for (let j = i; j < list.length; j++) {
      if (used[j] || dist(labs[i], labs[j]) > MERGE_DELTA) continue;
      used[j] = true;
      c.n += list[j].n;
      c.r += list[j].r;
      c.g += list[j].g;
      c.b += list[j].b;
    }
    clusters.push(c);
  }
  // Leftover (unmerged tail) pixels are folded into the nearest cluster so shares stay honest.
  const centres = clusters.map((c) => srgbToLab(c.r / c.n, c.g / c.n, c.b / c.n));
  for (let j = 0; j < list.length; j++) {
    if (used[j]) continue;
    let k = 0;
    for (let c = 1; c < centres.length; c++) if (dist(labs[j], centres[c]) < dist(labs[j], centres[k])) k = c;
    clusters[k].n += list[j].n;
    clusters[k].r += list[j].r;
    clusters[k].g += list[j].g;
    clusters[k].b += list[j].b;
  }
  clusters.sort((a, b) => b.n - a.n);
  const total = px.length;
  const kept = clusters.slice(0, MAX_COLOURS).filter((c, i) => i === 0 || c.n / total >= MIN_SHARE);
  const keptTotal = kept.reduce((s, c) => s + c.n, 0);
  return kept.map((c) => {
    const [r, g, b] = [c.r / c.n, c.g / c.n, c.b / c.n];
    return { hex: toHex(r, g, b), share: Math.round((c.n / keptTotal) * 1000) / 1000, name: colourName(r, g, b) };
  });
}

function hsv(r: number, g: number, b: number) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d + 6) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: h * 60, s: mx ? d / mx : 0, v: mx / 255 };
}

/**
 * Metal tone from the metallic-looking pixels. Thresholds (hue in degrees, S/V in 0-1):
 *   yellow gold: hue 28-62, S >= 0.28, V >= 0.4
 *   rose gold:   hue <= 28 or >= 340, S 0.12-0.5, V >= 0.5  (pinker/paler than a ruby, which is S > 0.5)
 *   silver:      S < 0.12, V >= 0.45
 *   oxidised:    S < 0.25, V 0.12-0.45 (dark grey / blackened metal)
 * Other hues (red/green/blue stones) are not counted as metal. With fewer than 5% metal-looking
 * pixels the tone is "unknown"; one tone holding >= 75% of the metal pixels wins, a second tone
 * holding >= 25% makes it "mixed".
 */
function metalToneOf(px: Rgb[]): NonNullable<ProductProfile["metalTone"]> {
  const counts = { yellow_gold: 0, rose_gold: 0, silver: 0, oxidised: 0 };
  for (const { r, g, b } of px) {
    const { h, s, v } = hsv(r, g, b);
    if (s < 0.12 && v >= 0.45) counts.silver++;
    else if (s < 0.25 && v >= 0.12 && v < 0.45) counts.oxidised++;
    else if (h >= 28 && h <= 62 && s >= 0.28 && v >= 0.4) counts.yellow_gold++;
    else if ((h <= 28 || h >= 340) && s >= 0.12 && s <= 0.5 && v >= 0.5) counts.rose_gold++;
  }
  const metal = counts.yellow_gold + counts.rose_gold + counts.silver + counts.oxidised;
  if (!px.length || metal / px.length < 0.05) return "unknown";
  const sorted = (Object.entries(counts) as [keyof typeof counts, number][]).sort((a, b) => b[1] - a[1]);
  if (sorted[0][1] / metal >= 0.75) return sorted[0][0];
  if (sorted[1][1] / metal >= 0.25) return "mixed";
  return sorted[0][0];
}

export async function computeProductProfile(args: {
  cutoutPng?: Buffer;
  fallbackImage?: Buffer;
  classification?: Classification | null;
}): Promise<ProductProfile> {
  const { classification } = args;
  const category: CategoryKey = classification?.category === "jewellery" ? "jewellery" : "clothing";
  const base = {
    version: 1 as const,
    category,
    productType: classification?.productType ?? null,
    description: classification?.description ?? null,
  };

  const px: Rgb[] = [];
  let aspect = 1;
  let pixels = { width: 0, height: 0 };
  let solidShare = 1;
  let source: ProductProfile["source"] = "estimate";

  if (args.cutoutPng) {
    source = "mask";
    const meta = await sharp(args.cutoutPng).metadata();
    pixels = { width: meta.width ?? 0, height: meta.height ?? 0 };
    const { data, info } = await sharp(args.cutoutPng)
      .ensureAlpha()
      .resize({ width: ANALYSIS_SIDE, height: ANALYSIS_SIDE, fit: "inside", withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
    let solid = 0;
    for (let i = 0; i < info.width * info.height; i++) {
      if (data[i * 4 + 3] < SOLID) continue;
      solid++;
      px.push({ r: data[i * 4], g: data[i * 4 + 1], b: data[i * 4 + 2] });
    }
    solidShare = solid / Math.max(1, info.width * info.height);
    aspect = pixels.height ? pixels.width / pixels.height : 1;
  } else if (args.fallbackImage) {
    const meta = await sharp(args.fallbackImage).metadata();
    const { data, info } = await sharp(args.fallbackImage)
      .flatten({ background: "#ffffff" })
      .resize({ width: ANALYSIS_SIDE, height: ANALYSIS_SIDE, fit: "inside", withoutEnlargement: true })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    // Product = pixels that are not (near-)white.
    let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
    const flags = new Uint8Array(info.width * info.height);
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * 3;
        if (255 - Math.min(data[i], data[i + 1], data[i + 2]) <= 24) continue;
        flags[y * info.width + x] = 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    const scale = (meta.width ?? info.width) / info.width;
    if (maxX >= 0) {
      const bw = maxX - minX + 1, bh = maxY - minY + 1;
      let count = 0;
      for (let y = minY; y <= maxY; y++)
        for (let x = minX; x <= maxX; x++)
          if (flags[y * info.width + x]) {
            count++;
            const i = (y * info.width + x) * 3;
            px.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
          }
      solidShare = count / (bw * bh);
      aspect = bw / bh;
      pixels = { width: Math.round(bw * scale), height: Math.round(bh * scale) };
    } else {
      // Nothing but white: use the whole frame so the profile still has something to say.
      for (let i = 0; i < info.width * info.height; i++) px.push({ r: data[i * 3], g: data[i * 3 + 1], b: data[i * 3 + 2] });
      aspect = info.width / info.height;
      pixels = { width: meta.width ?? info.width, height: meta.height ?? info.height };
    }
  } else {
    throw new Error("computeProductProfile needs a cut-out or a fallback image");
  }

  return {
    ...base,
    colours: dominantColours(px),
    metalTone: category === "jewellery" ? metalToneOf(px) : undefined,
    aspect: Math.round(aspect * 1000) / 1000,
    pixels,
    solidShare: Math.round(solidShare * 1000) / 1000,
    source,
  };
}
