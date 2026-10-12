import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { buildShotReference } from "@/lib/image/views";
import type { ReferenceView } from "@/lib/shots/types";

type RGB = [number, number, number];

/** RGBA cut-out from a per-pixel function; return null for transparent. */
async function cutout(w: number, h: number, fn: (x: number, y: number) => RGB | null) {
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = fn(x, y);
      const i = (y * w + x) * 4;
      if (c) buf.set([...c, 255], i);
    }
  return sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

/** Tall garment-like rectangle: red upper half over blue lower half. */
const garment = () => cutout(400, 800, (_x, y) => (y < 400 ? [200, 20, 20] : [20, 20, 200]));
const ring = () =>
  cutout(600, 600, (x, y) => {
    const d = Math.hypot(x - 300, y - 300);
    return d < 280 && d > 150 ? [212, 175, 55] : null;
  });

async function measure(jpeg: Buffer) {
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, minY = info.height, maxX = -1, maxY = -1, sx = 0, sy = 0, n = 0;
  let red = 0, blue = 0;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 3;
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      if (r > 235 && g > 235 && b > 235) continue;
      n++;
      sx += x;
      sy += y;
      if (r > 150 && b < 100) red++;
      if (b > 150 && r < 100) blue++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  return {
    W: info.width, H: info.height, bw, bh, minX, minY, maxX, maxY, red, blue,
    fillW: bw / info.width, fillH: bh / info.height,
    cx: sx / n / info.width, cy: sy / n / info.height,
  };
}

const A45 = { width: 4, height: 5 };

async function view(v: ReferenceView, cut: Buffer, extra: { tiltDeg?: number; aspect?: { width: number; height: number } } = {}) {
  return buildShotReference({ cutout: cut, view: v, aspect: extra.aspect ?? A45, tiltDeg: extra.tiltDeg });
}

describe("buildShotReference geometry", () => {
  it("hero fills ~78% of the limiting axis and is centred", async () => {
    const r = await view("hero", await garment());
    const m = await measure(r.data);
    expect(r.mime).toBe("image/jpeg");
    expect(m.fillH).toBeGreaterThan(0.75);
    expect(m.fillH).toBeLessThan(0.81);
    expect(Math.abs(m.cx - 0.5)).toBeLessThan(0.02);
    expect(Math.abs(m.cy - 0.5)).toBeLessThan(0.02);
  });

  it("canvas has the requested aspect ratio", async () => {
    for (const aspect of [{ width: 1, height: 1 }, { width: 4, height: 5 }, { width: 9, height: 16 }, { width: 16, height: 9 }]) {
      const r = await view("hero", await garment(), { aspect });
      const meta = await sharp(r.data).metadata();
      expect(meta.width! / meta.height!).toBeCloseTo(aspect.width / aspect.height, 2);
      expect(Math.max(meta.width!, meta.height!)).toBe(1280);
      const s = await sharp(r.small).metadata();
      expect(s.width! / s.height!).toBeCloseTo(aspect.width / aspect.height, 1);
    }
  });

  it("offset views sit in the left / right third", async () => {
    const cut = await ring();
    const l = await measure((await view("offset_left", cut)).data);
    const r = await measure((await view("offset_right", cut)).data);
    expect(l.cx).toBeLessThan(1 / 3);
    expect(r.cx).toBeGreaterThan(2 / 3);
    expect(Math.max(l.fillW, l.fillH)).toBeGreaterThan(0.54);
    expect(Math.max(l.fillW, l.fillH)).toBeLessThan(0.62);
    expect(Math.abs(l.cy - 0.5)).toBeLessThan(0.03);
  });

  it("loose is small and low", async () => {
    const m = await measure((await view("loose", await garment())).data);
    expect(m.fillH).toBeLessThan(0.42);
    expect(m.fillH).toBeGreaterThan(0.34);
    expect(m.cy).toBeGreaterThan(2 / 3);
    expect(Math.abs(m.cx - 0.5)).toBeLessThan(0.02);
  });

  it("detail crops contain only the intended region of the cut-out", async () => {
    const cut = await garment();
    const upper = await measure((await view("detail_upper", cut)).data);
    expect(upper.red).toBeGreaterThan(1000);
    expect(upper.blue).toBe(0);
    const lower = await measure((await view("detail_lower", cut)).data);
    expect(lower.blue).toBeGreaterThan(1000);
    expect(lower.red).toBe(0);
    const mid = await measure((await view("detail_centre", cut)).data);
    expect(mid.red).toBeGreaterThan(500);
    expect(mid.blue).toBeGreaterThan(500);
    expect(Math.abs(mid.red - mid.blue) / (mid.red + mid.blue)).toBeLessThan(0.06); // symmetric around the middle
    // Fills ~90% of the canvas on the limiting axis.
    expect(Math.max(upper.fillW, upper.fillH)).toBeGreaterThan(0.86);
  });

  it("small is <= 511px, rendered directly, with a larger product share", async () => {
    for (const v of ["hero", "offset_left", "loose", "detail_upper"] as ReferenceView[]) {
      const r = await view(v, await garment());
      const big = await measure(r.data);
      const small = await measure(r.small);
      expect(Math.max(small.W, small.H)).toBeLessThanOrEqual(511);
      const share = (m: typeof big) => Math.max(m.fillW, m.fillH);
      expect(share(small)).toBeGreaterThan(share(big) + (v === "detail_upper" ? 0.005 : 0.04)); // detail is clamped at 0.92
      expect(Math.abs(r.productPx.height - small.bh)).toBeLessThanOrEqual(6);
    }
  });

  it("is deterministic", async () => {
    const cut = await ring();
    const a = await buildShotReference({ cutout: cut, view: "offset_right", tiltDeg: 4, aspect: A45 });
    const b = await buildShotReference({ cutout: cut, view: "offset_right", tiltDeg: 4, aspect: A45 });
    expect(a.data.equals(b.data)).toBe(true);
    expect(a.small.equals(b.small)).toBe(true);
  });

  it("tilt changes pixels but not the product colours", async () => {
    const cut = await ring();
    const flat = await view("hero", cut);
    const tilted = await view("hero", cut, { tiltDeg: 5 });
    expect(flat.data.equals(tilted.data)).toBe(false);
    const gold = async (jpeg: Buffer) => {
      const { data } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
      let n = 0;
      const sum = [0, 0, 0];
      for (let i = 0; i < data.length; i += 3) {
        // Core gold pixels only (skip anti-aliased edges).
        if (Math.abs(data[i] - 212) < 12 && Math.abs(data[i + 1] - 175) < 12 && Math.abs(data[i + 2] - 55) < 20) {
          n++;
          for (let c = 0; c < 3; c++) sum[c] += data[i + c];
        }
      }
      return { n, mean: sum.map((v) => v / n) };
    };
    const [f, t] = [await gold(flat.data), await gold(tilted.data)];
    expect(t.n).toBeGreaterThan(f.n * 0.8);
    for (let c = 0; c < 3; c++) expect(Math.abs(t.mean[c] - f.mean[c])).toBeLessThan(3);
  });

  it("flags detail crops that are upscaled by more than 2x", async () => {
    const tiny = await cutout(120, 240, (_x, y) => (y < 120 ? [200, 20, 20] : [20, 20, 200]));
    expect((await view("detail_upper", tiny)).detailLoss).toBe(true);
    expect((await view("hero", tiny)).detailLoss).toBe(false); // only detail crops are flagged
    expect((await view("detail_upper", await cutout(2400, 4800, () => [200, 20, 20]))).detailLoss).toBe(false);
  });
});
