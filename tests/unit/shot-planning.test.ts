import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveAsset } from "@/lib/assets";
import { getBalance } from "@/lib/credits";
import { db } from "@/lib/db";
import { assets, generationImages, generations } from "@/lib/db/schema";
import { resetEnvCache } from "@/lib/env";
import { createGeneration, getGeneration, runGeneration } from "@/lib/generation/service";
import { computeProductProfile } from "@/lib/image/profile";
import { normalizeUpload } from "@/lib/image/process";
import { mockImage } from "@/lib/image/providers/mock";
import { SIGNUP_BONUS_CREDITS, TIERS } from "@/lib/pricing";
import { addProductPhoto } from "@/lib/product-photos";
import { ensureProductForAsset } from "@/lib/products";
import { storage } from "@/lib/storage";
import { directionOf } from "@/lib/shots/prompt";
import { pairwiseDifferences } from "@/lib/shots/planner";
import { makeUser, resetDb } from "./helpers";

const fixture = readFileSync("tests/fixtures/product.jpg");

const verdict = (prominence: string) =>
  JSON.stringify({
    reference_features: ["body"],
    checks: [{ feature: "body", status: "match" }],
    product_prominence: prominence,
    same_product: true,
    score: 0.95,
    differences: [],
  });

async function setup(opts: { cutout?: boolean } = {}) {
  const user = await makeUser();
  const asset = await saveAsset(user.id, "upload", await normalizeUpload(fixture), "uploads");
  if (opts.cutout) await attachCutout(user.id, asset.id);
  const [fresh] = await db().select().from(assets).where(eq(assets.id, asset.id));
  return { user, asset: fresh };
}

/** What photo preparation stores: a transparent cut-out of the product, a measured profile, status ready. */
async function attachCutout(userId: string, assetId: string) {
  const mask = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800"><ellipse cx="320" cy="400" rx="310" ry="390" fill="#fff"/></svg>');
  const cutout = await sharp(fixture)
    .resize(640, 800, { fit: "cover" })
    .ensureAlpha()
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
  const key = `u/${userId}/uploads/${randomUUID()}_cutout.png`;
  await storage().put(key, cutout, "image/png");
  const [row] = await db().select().from(assets).where(eq(assets.id, assetId));
  const profile = await computeProductProfile({ cutoutPng: cutout, classification: row.classification });
  await db()
    .update(assets)
    .set({ cutoutKey: key, cleanKey: row.storageKey, profile, preparation: { status: "ready", method: "basic", startedAt: new Date().toISOString() } })
    .where(eq(assets.id, assetId));
}

const input = (assetId: string, extra: Record<string, unknown> = {}) => ({
  sourceAssetId: assetId,
  category: "clothing" as const,
  options: { presentation: "on_model_full" },
  aspectRatio: "4:5",
  tier: "standard",
  count: 3,
  customNote: undefined as string | undefined,
  ...extra,
});

const shots = (genId: string) =>
  db().select().from(generationImages).where(eq(generationImages.generationId, genId)).orderBy(generationImages.idx);

beforeEach(async () => {
  delete process.env.SHOT_PLANNER;
  process.env.MOCK_FIDELITY = verdict("hero");
  resetEnvCache();
  await resetDb();
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  delete process.env.SHOT_PLANNER;
  resetEnvCache();
  await resetDb();
});

describe("planner v1 through the job engine", () => {
  it("gives every shot its own stored spec and a prompt that leads with that shot's direction", async () => {
    const { user, asset } = await setup({ cutout: true });
    const gen = await createGeneration(user.id, input(asset.id, { count: 3 }));
    await runGeneration(gen.id);

    const rows = await shots(gen.id);
    expect(rows).toHaveLength(3);
    const specs = rows.map((r) => r.spec!);
    expect(specs.every(Boolean)).toBe(true);
    expect(new Set(specs.map((s) => s.purpose)).size).toBe(3);
    expect(new Set(specs.map((s) => s.modelSlot)).size).toBe(3); // a different person in every shot
    for (let i = 0; i < specs.length; i++) {
      expect(rows[i].prompt!.startsWith(directionOf(specs[i]))).toBe(true);
      for (let j = i + 1; j < specs.length; j++) expect(pairwiseDifferences(specs[i], specs[j])).toBeGreaterThanOrEqual(3);
    }
    expect(new Set(rows.map((r) => r.prompt)).size).toBe(3);

    const [g] = await db().select().from(generations).where(eq(generations.id, gen.id));
    expect(g.promptSource).toBe("planner-v1");
    expect(g.plan).toMatchObject({ planner: "v1", relaxed: false });
    expect(g.plan!.minPairwiseDiff).toBeGreaterThanOrEqual(3);

    const dto = (await getGeneration(user.id, gen.id))!;
    expect(dto.status).toBe("succeeded");
    expect(dto.images.map((i) => i.purpose)).toEqual(specs.map((s) => s.purposeLabel));
  });

  it("skips a back view when there is no back photo, says why, and runs it once a back photo exists", async () => {
    const { user, asset } = await setup({ cutout: true });
    await ensureProductForAsset(user.id, asset, "Kurta");
    const without = await createGeneration(user.id, input(asset.id, { count: 4, tier: "economy" }), { skipActiveCheck: true });
    await runGeneration(without.id);
    const w = (await getGeneration(user.id, without.id))!;
    expect(w.images).toHaveLength(4); // still four images: the skipped shots are replaced, not left blank
    expect((await shots(without.id)).some((r) => r.spec!.purpose === "back_view")).toBe(false);
    const back = w.skippedShots.find((k) => k.needs === "back");
    expect(back?.reason).toMatch(/back photo/i);

    // The seller adds a back photo: that shot is no longer skipped.
    const backAsset = await saveAsset(user.id, "upload", await normalizeUpload(fixture), "uploads");
    const [product] = await db().query.products.findMany({ where: (p, { eq: e }) => e(p.userId, user.id) });
    await addProductPhoto(user.id, product.id, backAsset.id, "back");
    const withBack = await createGeneration(user.id, input(asset.id, { count: 4, tier: "economy" }), { skipActiveCheck: true, idempotencyKey: "second-run-1" });
    await runGeneration(withBack.id);
    const wb = (await getGeneration(user.id, withBack.id))!;
    expect(wb.skippedShots.some((k) => k.needs === "back")).toBe(false);
  });

  it("shows the image model a different view of the product in each shot, within Cloudflare's 512px limit", async () => {
    const seen: { hash: string; small?: Buffer }[] = [];
    const real = mockImage.generate.bind(mockImage);
    vi.spyOn(mockImage, "generate").mockImplementation(async (req) => {
      seen.push({ hash: createHash("sha1").update(req.image.data).digest("hex"), small: req.image.small });
      return real(req);
    });
    const { user, asset } = await setup({ cutout: true });
    const gen = await createGeneration(user.id, input(asset.id, { count: 3 }));
    await runGeneration(gen.id);

    expect(seen).toHaveLength(3);
    expect(new Set(seen.map((s) => s.hash)).size).toBeGreaterThanOrEqual(2); // not one layout-locked cutout for all
    for (const s of seen) {
      const meta = await sharp(s.small!).metadata();
      expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(511);
    }
  });

  it("without a cut-out every shot falls back to the one shared reference (and says nothing false)", async () => {
    const seen: string[] = [];
    const real = mockImage.generate.bind(mockImage);
    vi.spyOn(mockImage, "generate").mockImplementation(async (req) => {
      seen.push(createHash("sha1").update(req.image.data).digest("hex"));
      return real(req);
    });
    const { user, asset } = await setup({ cutout: false });
    const gen = await createGeneration(user.id, input(asset.id, { count: 3 }));
    await runGeneration(gen.id);
    expect(new Set(seen).size).toBe(1);
    expect((await getGeneration(user.id, gen.id))!.status).toBe("succeeded"); // still works
  });

  it("relaxed prominence: a wide styled shot may show the product small, a hero shot may not", async () => {
    process.env.MOCK_FIDELITY = verdict("small");
    const { user, asset } = await setup({ cutout: true });
    const gen = await createGeneration(user.id, input(asset.id, { count: 4 }));
    await runGeneration(gen.id);

    const rows = await shots(gen.id);
    const lenient = rows.filter((r) => r.spec!.minProminence === "small");
    const strict = rows.filter((r) => r.spec!.minProminence !== "small");
    expect(lenient.length).toBeGreaterThan(0);
    expect(strict.length).toBeGreaterThan(0);
    expect(lenient.every((r) => r.status === "succeeded")).toBe(true);
    expect(strict.every((r) => r.status === "failed")).toBe(true);
    // Failed shots are refunded; only accepted shots are charged.
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS_CREDITS - lenient.length * TIERS.standard.creditsPerImage);
  });

  it("a product hidden in the frame fails even the most lenient shot", async () => {
    process.env.MOCK_FIDELITY = verdict("not_visible");
    const { user, asset } = await setup({ cutout: true });
    const gen = await createGeneration(user.id, input(asset.id, { count: 2 }));
    await runGeneration(gen.id);
    expect((await getGeneration(user.id, gen.id))!.status).toBe("failed");
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS_CREDITS);
  });

  it("SHOT_PLANNER=off keeps the legacy flow: no specs, no plan, every shot the shared reference", async () => {
    process.env.SHOT_PLANNER = "off";
    resetEnvCache();
    const { user, asset } = await setup({ cutout: true });
    const gen = await createGeneration(user.id, input(asset.id, { count: 2 }));
    await runGeneration(gen.id);
    const rows = await shots(gen.id);
    expect(rows.every((r) => r.spec === null)).toBe(true);
    const [g] = await db().select().from(generations).where(eq(generations.id, gen.id));
    expect(g.plan).toBeNull();
    expect((await getGeneration(user.id, gen.id))!.skippedShots).toEqual([]);
  });

  it("the seller's plain-white marketplace backdrop stays white in every shot", async () => {
    const { user, asset } = await setup({ cutout: true });
    const gen = await createGeneration(user.id, input(asset.id, { count: 3, options: { presentation: "on_model_full", setting: "studio_white" } }));
    await runGeneration(gen.id);
    const rows = await shots(gen.id);
    expect(rows.every((r) => r.spec!.background === "white_studio")).toBe(true);
    // ...and the variety comes from the other attributes instead.
    const [g] = await db().select().from(generations).where(eq(generations.id, gen.id));
    expect(g.plan!.minPairwiseDiff).toBeGreaterThanOrEqual(3);
  });
});
