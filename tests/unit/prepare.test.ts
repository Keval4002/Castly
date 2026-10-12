import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { saveAsset } from "@/lib/assets";
import { db } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import { composeWithMask, repairMask } from "@/lib/image/prepare";
import { normalizeUpload } from "@/lib/image/process";
import { pendingPreparation, productReference, runPreparation } from "@/lib/image/reference";
import { makeUser, resetDb } from "./helpers";

/** 40×40 white photo with a red 20×20 product holding a gold dot; a ring-like white hole in a second product. */
function scene() {
  const w = 40, h = 40;
  const rgb = new Uint8Array(w * h * 3).fill(255);
  const alpha = new Uint8Array(w * h);
  const set = (x: number, y: number, c: [number, number, number], a: number) => {
    const i = y * w + x;
    rgb.set(c, i * 3);
    alpha[i] = a;
  };
  for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) set(x, y, [200, 20, 20], 255);
  // Gold dot the segmenter wrongly cut out (alpha 0, product colour).
  for (let y = 14; y < 17; y++) for (let x = 14; x < 17; x++) set(x, y, [230, 190, 60], 0);
  // Genuine see-through gap: background white showing through (alpha 0).
  for (let y = 22; y < 26; y++) for (let x = 22; x < 26; x++) set(x, y, [255, 255, 255], 0);
  return { w, h, rgb, alpha };
}

describe("mask repair", () => {
  it("restores product details the segmenter cut out but keeps real see-through gaps", () => {
    const { w, h, rgb, alpha } = scene();
    const { alpha: out, repaired } = repairMask(alpha, rgb, w, h);
    expect(out[15 * w + 15]).toBe(255); // gold dot restored
    expect(out[23 * w + 23]).toBe(0); // background gap kept
    expect(out[2 * w + 2]).toBe(0); // outside stays background
    expect(repaired).toBe(9);
  });

  it("places the product on white, cropped with padding, without touching product pixels", async () => {
    const { w, h, rgb, alpha } = scene();
    const photo = await sharp(Buffer.from(rgb), { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
    const out = (await composeWithMask(photo, { data: Buffer.from(alpha), width: w, height: h, method: "local-birefnet" }))!;
    expect(out.method).toBe("local-birefnet");
    // 20px product + 8% padding each side → 23–24px square.
    expect(out.clean.width).toBeGreaterThanOrEqual(23);
    expect(out.clean.width).toBeLessThanOrEqual(24);
    const { data } = await sharp(out.clean.data).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => [...data.subarray((y * out.clean.width + x) * 3, (y * out.clean.width + x) * 3 + 3)];
    expect(px(0, 0).every((v) => v > 240)).toBe(true); // white padding
    const [r, g] = px(Math.floor(out.clean.width / 2) - 4, Math.floor(out.clean.width / 2) + 4);
    expect(r).toBeGreaterThan(150); // red product body intact
    expect(g).toBeLessThan(80);
  });

  it("rejects implausible masks (nothing found)", async () => {
    const { w, h, rgb } = scene();
    const photo = await sharp(Buffer.from(rgb), { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
    expect(await composeWithMask(photo, { data: Buffer.alloc(w * h), width: w, height: h, method: "fal-birefnet" })).toBeNull();
  });
});

beforeEach(resetDb);
afterAll(resetDb);

describe("photo cleaning job", () => {
  it("cleans the upload and generation uses the cleaned reference", async () => {
    const user = await makeUser();
    const asset = await saveAsset(user.id, "upload", await normalizeUpload(readFileSync("tests/fixtures/product.jpg")), "uploads", {
      preparation: pendingPreparation(),
    });
    await runPreparation(asset.id);
    const [row] = await db().select().from(assets).where(eq(assets.id, asset.id));
    expect(row.preparation).toMatchObject({ status: "ready", method: "basic" });
    expect(row.cleanKey).toMatch(/_clean\.jpg$/);
    const ref = await productReference(row);
    expect(ref.cleaned).toBe(true);
  });

  it("falls back to the original upload when cleaning failed", async () => {
    const user = await makeUser();
    const asset = await saveAsset(user.id, "upload", await normalizeUpload(readFileSync("tests/fixtures/product.jpg")), "uploads", {
      preparation: { status: "failed", startedAt: new Date().toISOString() },
    });
    const ref = await productReference(asset);
    expect(ref.cleaned).toBe(false);
    expect(ref.data.length).toBe(asset.bytes);
  });
});
