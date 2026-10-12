import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { dHash, deltaE76, hammingDistance, maskedColourDistance, percentile, rgbToLab, setDiversity, summarise } from "@/lib/eval/metrics";

async function gradient(flip = false, colour = [200, 50, 50]): Promise<Buffer> {
  const w = 64,
    h = 64;
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = Math.round(((flip ? w - 1 - x : x) / (w - 1)) * 255);
      raw.set([(v * colour[0]) / 255, (v * colour[1]) / 255, (v * colour[2]) / 255], (y * w + x) * 3);
    }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

describe("eval metrics", () => {
  it("dHash: identical -> 0, different -> >0", async () => {
    const a = await gradient();
    expect(hammingDistance(await dHash(a), await dHash(a))).toBe(0);
    expect(hammingDistance(await dHash(a), await dHash(await gradient(true)))).toBeGreaterThan(0);
  });
  it("deltaE76", async () => {
    const l = rgbToLab(120, 80, 40);
    expect(deltaE76(l, l)).toBe(0);
    expect(deltaE76(rgbToLab(255, 255, 255), rgbToLab(0, 0, 0))).toBeCloseTo(100, 0);
    const flat = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#c83232" } }).png().toBuffer();
    expect(await maskedColourDistance(flat, flat)).toBeCloseTo(0, 5);
    const a = await gradient();
    expect((await maskedColourDistance(a, await gradient(false, [20, 20, 220])))!).toBeGreaterThan(10);
  });
  it("setDiversity: identical set is 0, different set is larger", async () => {
    const a = await gradient();
    expect((await setDiversity([a, a]))!.pairwiseMin).toBe(0);
    const d = (await setDiversity([a, await gradient(true, [20, 20, 220])]))!;
    expect(d.pairwiseMean).toBeGreaterThan(0);
    expect(await setDiversity([a])).toBeNull();
  });
  it("summarise", () => {
    const s = summarise([
      { ok: true, retried: false, accepted: true, costMicros: 40_000, latencyMs: 1000 },
      { ok: true, retried: true, accepted: false, costMicros: 40_000, latencyMs: 3000 },
      { ok: false, retried: true, accepted: false, costMicros: 0, latencyMs: 500 },
      { ok: true, retried: false, accepted: true, costMicros: 40_000, latencyMs: 2000 },
    ]);
    expect(s.failureRate).toBe(0.25);
    expect(s.retryRate).toBe(0.5);
    expect(s.accepted).toBe(2);
    expect(s.costPerAcceptedUsd).toBeCloseTo(0.06);
    expect(s.latencyP50Ms).toBe(2000);
    expect(s.latencyP95Ms).toBe(3000);
    expect(summarise([]).costPerAcceptedUsd).toBeNull();
    expect(percentile([], 50)).toBeNull();
  });
});
