import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { Classification } from "@/lib/classify/reconcile";
import { computeProductProfile } from "@/lib/image/profile";

type RGB = [number, number, number];

async function cutout(w: number, h: number, fn: (x: number, y: number) => RGB | null) {
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = fn(x, y);
      if (c) buf.set([...c, 255], (y * w + x) * 4);
    }
  return sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}
const solid = (c: RGB) => cutout(200, 300, () => c);
const cls = (category: Classification["category"]): Classification => ({
  category, productType: category === "jewellery" ? "ring" : "kurta", confidence: 0.9, description: "a thing", issues: [], source: "mock",
});

describe("computeProductProfile colours", () => {
  it.each([
    ["maroon", [110, 16, 32]],
    ["mustard", [217, 162, 27]],
    ["navy", [20, 33, 74]],
    ["teal", [14, 111, 115]],
  ] as [string, RGB][])("names a %s garment", async (name, rgb) => {
    const p = await computeProductProfile({ cutoutPng: await solid(rgb), classification: cls("clothing") });
    expect(p.colours[0].name).toBe(name);
    expect(p.colours[0].hex).toBe("#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join(""));
    expect(p.source).toBe("mask");
    expect(p.metalTone).toBeUndefined();
    expect(p.category).toBe("clothing");
    expect(p.aspect).toBeCloseTo(200 / 300, 2);
    expect(p.pixels).toEqual({ width: 200, height: 300 });
    expect(p.solidShare).toBe(1);
  });

  it("finds several colours, ordered, with shares summing to ~1, ignoring transparent pixels", async () => {
    const cut = await cutout(300, 300, (x, y) => (x > 250 ? null : y < 150 ? (x < 125 ? [110, 16, 32] : [217, 162, 27]) : [20, 33, 74]));
    const p = await computeProductProfile({ cutoutPng: cut, classification: null });
    expect(p.category).toBe("clothing"); // missing classification -> clothing
    expect(p.colours.map((c) => c.name).sort()).toEqual(["maroon", "mustard", "navy"]);
    expect(p.colours[0].name).toBe("navy");
    expect(p.colours.length).toBeLessThanOrEqual(4);
    expect(p.colours.reduce((s, c) => s + c.share, 0)).toBeCloseTo(1, 1);
    expect(p.colours[0].share).toBeGreaterThan(0.4);
  });

  it("treats category other as clothing and merges near-duplicate shades", async () => {
    const cut = await cutout(200, 200, (x) => (x < 100 ? [110, 16, 32] : [114, 18, 34]));
    const p = await computeProductProfile({ cutoutPng: cut, classification: cls("other") });
    expect(p.category).toBe("clothing");
    expect(p.colours).toHaveLength(1);
    expect(p.productType).toBe("kurta");
    expect(p.description).toBe("a thing");
  });
});

describe("computeProductProfile metal tone", () => {
  it.each([
    ["yellow_gold", [212, 175, 55]],
    ["silver", [192, 192, 192]],
    ["rose_gold", [230, 160, 140]],
    ["oxidised", [70, 70, 70]],
  ] as [string, RGB][])("detects %s", async (tone, rgb) => {
    const p = await computeProductProfile({ cutoutPng: await solid(rgb), classification: cls("jewellery") });
    expect(p.metalTone).toBe(tone);
  });

  it("says mixed for two-tone and ignores stones", async () => {
    const two = await cutout(200, 200, (x) => (x < 100 ? [212, 175, 55] : [192, 192, 192]));
    expect((await computeProductProfile({ cutoutPng: two, classification: cls("jewellery") })).metalTone).toBe("mixed");
    // Mostly a green stone with a little gold: stones are not metal, gold wins.
    const stone = await cutout(200, 200, (x) => (x < 150 ? [14, 138, 90] : [212, 175, 55]));
    expect((await computeProductProfile({ cutoutPng: stone, classification: cls("jewellery") })).metalTone).toBe("yellow_gold");
    const onlyStone = await solid([14, 138, 90]);
    expect((await computeProductProfile({ cutoutPng: onlyStone, classification: cls("jewellery") })).metalTone).toBe("unknown");
  });
});

describe("computeProductProfile shape and estimates", () => {
  it("solidShare of a ring with a hole is below 1", async () => {
    const ring = await cutout(400, 400, (x, y) => {
      const d = Math.hypot(x - 200, y - 200);
      return d < 195 && d > 110 ? [212, 175, 55] : null;
    });
    const p = await computeProductProfile({ cutoutPng: ring, classification: cls("jewellery") });
    expect(p.solidShare).toBeLessThan(0.7);
    expect(p.solidShare).toBeGreaterThan(0.3);
  });

  it("estimates from a white-background photo when there is no cut-out", async () => {
    for (const f of ["product.jpg", "ring.jpg"]) {
      const p = await computeProductProfile({ fallbackImage: readFileSync(`tests/fixtures/${f}`), classification: cls("clothing") });
      expect(p.source).toBe("estimate");
      expect(p.colours.length).toBeGreaterThan(0);
      expect(p.colours.reduce((s, c) => s + c.share, 0)).toBeCloseTo(1, 1);
      expect(p.aspect).toBeGreaterThan(0.1);
      expect(p.aspect).toBeLessThan(10);
      expect(p.pixels.width).toBeGreaterThan(0);
      expect(p.solidShare).toBeGreaterThan(0);
      expect(p.solidShare).toBeLessThanOrEqual(1);
    }
  });

  it("estimates colour from a synthetic white-background JPEG", async () => {
    const jpg = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#ffffff" } })
      .composite([{ input: { create: { width: 100, height: 120, channels: 3, background: "#6d1020" } }, left: 50, top: 40 }])
      .jpeg()
      .toBuffer();
    const p = await computeProductProfile({ fallbackImage: jpg });
    expect(p.source).toBe("estimate");
    expect(p.colours[0].name).toBe("maroon");
    expect(p.aspect).toBeCloseTo(100 / 120, 1);
  });
});
