import sharp from "sharp";

/**
 * Cheap PROXY metrics for the eval harness. They are NOT proof of product
 * fidelity: a perceptual hash only says two frames look structurally alike, a
 * colour distance only says average colours are close, and neither can see
 * stones, patterns, text or anatomy. Use them to (a) spot obvious regressions
 * and (b) compare providers on the same cases; human ratings stay the ground
 * truth (see eval/README.md).
 */

// ---------- perceptual hash ----------

/** 64-bit difference hash (9x8 greyscale, left>right), returned as 16 hex chars. */
export async function dHash(buf: Buffer): Promise<string> {
  const px = await sharp(buf).rotate().greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let bits = "";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += px[y * 9 + x] > px[y * 9 + x + 1] ? "1" : "0";
  let hex = "";
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

/** Number of differing bits between two equal-length hex hashes (0..64 for dHash). */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) throw new Error("hash length mismatch");
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

// ---------- colour ----------

export type Lab = [number, number, number];

/** sRGB (0-255) -> CIELAB (D65). */
export function rgbToLab(r: number, g: number, b: number): Lab {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const X = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const Z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const [fx, fy, fz] = [f(X), f(Y), f(Z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 colour difference (Euclidean in Lab). ~2.3 is a just-noticeable difference. */
export function deltaE76(a: Lab, b: Lab): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

const SIDE = 64;

async function rgbPixels(buf: Buffer): Promise<Buffer> {
  return sharp(buf).rotate().flatten({ background: "#ffffff" }).removeAlpha().resize(SIDE, SIDE, { fit: "fill" }).raw().toBuffer();
}

function meanLab(px: Buffer, keep: (i: number) => boolean): { lab: Lab; n: number } {
  let L = 0,
    A = 0,
    B = 0,
    n = 0;
  for (let i = 0; i < SIDE * SIDE; i++) {
    if (!keep(i)) continue;
    const [l, a, b] = rgbToLab(px[i * 3], px[i * 3 + 1], px[i * 3 + 2]);
    L += l;
    A += a;
    B += b;
    n++;
  }
  return n ? { lab: [L / n, A / n, B / n], n } : { lab: [0, 0, 0], n: 0 };
}

/**
 * Mean-colour distance (deltaE76) between the product and the generated output.
 * Product side: pixels where the optional mask is > 127 (else all pixels).
 * Output side: the central 50% of the frame (where the hero product usually sits),
 * because the product's position in the output is unknown without segmentation.
 * Crude: a coloured backdrop, props or a model's skin will contaminate it. Returns
 * null when the mask selects no pixels.
 */
export async function maskedColourDistance(productBuf: Buffer, outputBuf: Buffer, maskBuf?: Buffer): Promise<number | null> {
  const [p, o] = await Promise.all([rgbPixels(productBuf), rgbPixels(outputBuf)]);
  let mask: Buffer | null = null;
  if (maskBuf) mask = await sharp(maskBuf).rotate().greyscale().resize(SIDE, SIDE, { fit: "fill" }).raw().toBuffer();
  const a = meanLab(p, (i) => (mask ? mask[i] > 127 : true));
  if (a.n === 0) return null;
  const q = SIDE / 4;
  const b = meanLab(o, (i) => {
    const x = i % SIDE,
      y = Math.floor(i / SIDE);
    return x >= q && x < SIDE - q && y >= q && y < SIDE - q;
  });
  return deltaE76(a.lab, b.lab);
}

/** Normalised 4x4x4 RGB histogram (sums to 1). Captures overall colour/background mix. */
export async function colourHistogram(buf: Buffer): Promise<number[]> {
  const px = await rgbPixels(buf);
  const h = new Array<number>(64).fill(0);
  for (let i = 0; i < SIDE * SIDE; i++) h[(px[i * 3] >> 6) * 16 + (px[i * 3 + 1] >> 6) * 4 + (px[i * 3 + 2] >> 6)]++;
  return h.map((v) => v / (SIDE * SIDE));
}

/** Half the L1 distance between histograms: 0 identical .. 1 disjoint. */
export function histogramDistance(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / 2;
}

// ---------- set diversity ----------

export interface Diversity {
  /** Combined score 0..1 (0 = identical, 1 = very different): 0.5*hash/64 + 0.5*histogram. */
  pairwiseMin: number;
  pairwiseMean: number;
  hashMin: number;
  hashMean: number;
  colourMin: number;
  colourMean: number;
  pairs: number;
}

/** How different the shots of one case are from each other. Needs >= 2 images, else null. */
export async function setDiversity(images: Buffer[]): Promise<Diversity | null> {
  if (images.length < 2) return null;
  const [hashes, hists] = await Promise.all([Promise.all(images.map(dHash)), Promise.all(images.map(colourHistogram))]);
  const hs: number[] = [],
    cs: number[] = [],
    combined: number[] = [];
  for (let i = 0; i < images.length; i++)
    for (let j = i + 1; j < images.length; j++) {
      const h = hammingDistance(hashes[i], hashes[j]);
      const c = histogramDistance(hists[i], hists[j]);
      hs.push(h);
      cs.push(c);
      combined.push(0.5 * (h / 64) + 0.5 * c);
    }
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  return {
    pairwiseMin: Math.min(...combined),
    pairwiseMean: mean(combined),
    hashMin: Math.min(...hs),
    hashMean: mean(hs),
    colourMin: Math.min(...cs),
    colourMean: mean(cs),
    pairs: combined.length,
  };
}

// ---------- run summary ----------

export interface RunRecord {
  /** The provider chain returned an image. */
  ok: boolean;
  /** Needed a fallback provider (earlier provider(s) in the chain failed). */
  retried: boolean;
  /** Passed the automated gate (judge verdict passes). */
  accepted: boolean;
  /** Estimated provider cost for this shot, micro-USD (counts spend even when not accepted). */
  costMicros: number;
  latencyMs: number;
}

export interface Summary {
  runs: number;
  failureRate: number;
  retryRate: number;
  accepted: number;
  /** Total estimated spend / accepted images, USD; null when nothing was accepted. */
  costPerAcceptedUsd: number | null;
  totalCostUsd: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
}

/** Nearest-rank percentile (p in 0..100) of a numeric list; null if empty. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

export function summarise(runs: RunRecord[]): Summary {
  const n = runs.length;
  const accepted = runs.filter((r) => r.accepted).length;
  const totalMicros = runs.reduce((s, r) => s + r.costMicros, 0);
  const lat = runs.filter((r) => r.ok).map((r) => r.latencyMs);
  return {
    runs: n,
    failureRate: n ? runs.filter((r) => !r.ok).length / n : 0,
    retryRate: n ? runs.filter((r) => r.retried).length / n : 0,
    accepted,
    costPerAcceptedUsd: accepted ? totalMicros / 1_000_000 / accepted : null,
    totalCostUsd: totalMicros / 1_000_000,
    latencyP50Ms: percentile(lat, 50),
    latencyP95Ms: percentile(lat, 95),
  };
}
