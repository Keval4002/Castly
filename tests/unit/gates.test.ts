import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { saveAsset } from "@/lib/assets";
import { getBalance } from "@/lib/credits";
import { db } from "@/lib/db";
import { appSettings, generationImages, generations, payments } from "@/lib/db/schema";
import { resetEnvCache } from "@/lib/env";
import {
  createGeneration,
  DEDUPE_WINDOW_MS,
  GenerationError,
  getGeneration,
  HELD_MAX_MS,
  recheckHeldImages,
  runGeneration,
} from "@/lib/generation/service";
import { normalizeUpload } from "@/lib/image/process";
import { createCheckout, fulfillOrder } from "@/lib/payments/service";
import { findPack, SIGNUP_BONUS_CREDITS, TIERS } from "@/lib/pricing";
import { GENERATION_PAUSED_KEY, resetSwitchCache } from "@/lib/switches";
import { makeUser, resetDb } from "./helpers";

const fixture = readFileSync("tests/fixtures/product.jpg");

const verdict = (v: Record<string, unknown> = {}) =>
  JSON.stringify({
    reference_features: ["red body", "gold dots"],
    checks: [
      { feature: "red body", status: "match" },
      { feature: "gold dots", status: "match" },
    ],
    product_prominence: "hero",
    same_product: true,
    score: 0.95,
    differences: [],
    ...v,
  });

async function setup() {
  const user = await makeUser();
  const asset = await saveAsset(user.id, "upload", await normalizeUpload(fixture), "uploads");
  return { user, asset };
}

const input = (assetId: string, extra: Record<string, unknown> = {}) => ({
  sourceAssetId: assetId,
  category: "clothing" as const,
  options: { presentation: "on_model_full" },
  aspectRatio: "4:5",
  tier: "standard",
  count: 2,
  customNote: undefined as string | undefined,
  ...extra,
});

const COST = 2 * TIERS.standard.creditsPerImage;

beforeEach(async () => {
  delete process.env.GENERATION_PAUSED;
  process.env.MOCK_FIDELITY = verdict();
  process.env.FIDELITY_MODE = "enforce";
  resetEnvCache();
  resetSwitchCache();
  await resetDb();
  await db().delete(appSettings);
});
afterAll(async () => {
  delete process.env.GENERATION_PAUSED;
  process.env.FIDELITY_MODE = "enforce";
  resetEnvCache();
  resetSwitchCache();
  await db().delete(appSettings);
  await resetDb();
});

describe("quality gate fails closed", () => {
  it("holds images the judge can't verify: not delivered, never marked passed", async () => {
    process.env.MOCK_FIDELITY = "unavailable";
    const { user, asset } = await setup();
    const gen = await createGeneration(user.id, input(asset.id));
    await runGeneration(gen.id);

    const dto = (await getGeneration(user.id, gen.id))!;
    expect(dto.status).toBe("running"); // waiting for the re-check, not "succeeded"
    expect(dto.images.map((i) => i.status)).toEqual(["held", "held"]);
    expect(dto.images.every((i) => i.url === null && i.thumbUrl === null)).toBe(true);
    expect(dto.images.every((i) => i.fidelity?.passed === false && i.fidelity.verified === false)).toBe(true);
  });

  it("delivers a held image once a re-check verifies it, and keeps the charge", async () => {
    process.env.MOCK_FIDELITY = "unavailable";
    const { user, asset } = await setup();
    const gen = await createGeneration(user.id, input(asset.id));
    await runGeneration(gen.id);

    process.env.MOCK_FIDELITY = verdict(); // the judge is back
    await db().update(generationImages).set({ nextCheckAt: new Date(Date.now() - 1000) }).where(eq(generationImages.generationId, gen.id));
    await recheckHeldImages(gen.id);

    const dto = (await getGeneration(user.id, gen.id))!;
    expect(dto.status).toBe("succeeded");
    expect(dto.images.map((i) => i.status)).toEqual(["succeeded", "succeeded"]);
    expect(dto.images[0].url).toMatch(/^\/api\/files\//);
    expect(dto.images[0].fidelity).toEqual({ verified: true, passed: true, score: 0.95 });
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS_CREDITS - COST);
  });

  it("rejects and refunds a held image whose re-check finds the product changed", async () => {
    process.env.MOCK_FIDELITY = "unavailable";
    const { user, asset } = await setup();
    const gen = await createGeneration(user.id, input(asset.id));
    await runGeneration(gen.id);

    process.env.MOCK_FIDELITY = verdict({ same_product: false, score: 0.3, differences: ["border colour changed"] });
    await db().update(generationImages).set({ nextCheckAt: new Date(Date.now() - 1000) }).where(eq(generationImages.generationId, gen.id));
    const dto = (await getGeneration(user.id, gen.id))!; // polling drives the re-check

    expect(dto.status).toBe("failed");
    expect(dto.images.every((i) => i.status === "failed" && i.url === null)).toBe(true);
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS_CREDITS);
  });

  it("backs off while the judge is still down, and does not re-check before it is due", async () => {
    process.env.MOCK_FIDELITY = "unavailable";
    const { user, asset } = await setup();
    const gen = await createGeneration(user.id, input(asset.id));
    await runGeneration(gen.id);

    await recheckHeldImages(gen.id); // not due yet: untouched
    let rows = await db().select().from(generationImages).where(eq(generationImages.generationId, gen.id));
    expect(rows.map((r) => r.checkCount)).toEqual([0, 0]);

    await db().update(generationImages).set({ nextCheckAt: new Date(Date.now() - 1000) }).where(eq(generationImages.generationId, gen.id));
    await recheckHeldImages(gen.id); // due, judge still down: stays held, next check pushed out
    rows = await db().select().from(generationImages).where(eq(generationImages.generationId, gen.id));
    expect(rows.map((r) => r.status)).toEqual(["held", "held"]);
    expect(rows.every((r) => r.checkCount === 1 && r.nextCheckAt! > new Date())).toBe(true);
  });

  it("gives up after the hold window: failed and fully refunded, never charged for unverified work", async () => {
    process.env.MOCK_FIDELITY = "unavailable";
    const { user, asset } = await setup();
    const gen = await createGeneration(user.id, input(asset.id));
    await runGeneration(gen.id);
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS_CREDITS - COST); // reserved while held

    await db()
      .update(generations)
      .set({ createdAt: new Date(Date.now() - HELD_MAX_MS - 1000) })
      .where(eq(generations.id, gen.id));
    const dto = (await getGeneration(user.id, gen.id))!;

    expect(dto.status).toBe("failed");
    expect(dto.refundedCredits).toBe(COST);
    expect(dto.images.every((i) => i.status === "failed" && i.url === null)).toBe(true);
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS_CREDITS);
    await getGeneration(user.id, gen.id); // settling twice refunds once
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS_CREDITS);
  });

  it("in flag mode still delivers, but marks the image unverified and not passed", async () => {
    process.env.FIDELITY_MODE = "flag";
    resetEnvCache();
    process.env.MOCK_FIDELITY = "unavailable";
    const { user, asset } = await setup();
    const gen = await createGeneration(user.id, input(asset.id));
    await runGeneration(gen.id);
    const dto = (await getGeneration(user.id, gen.id))!;
    expect(dto.status).toBe("succeeded");
    expect(dto.images[0].fidelity).toEqual({ verified: false, passed: false, score: null });
  });
});

describe("generation kill switch", () => {
  it("blocks new jobs via the env flag, without charging", async () => {
    process.env.GENERATION_PAUSED = "true";
    resetEnvCache();
    const { user, asset } = await setup();
    const err = await createGeneration(user.id, input(asset.id)).catch((e) => e);
    expect(err).toBeInstanceOf(GenerationError);
    expect(err).toMatchObject({ status: 503, code: "generation_paused" });
    expect(await db().select().from(generations)).toHaveLength(0);
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS_CREDITS);
  });

  it("flips instantly from the database row, with the operator's message, and flips back", async () => {
    const { user, asset } = await setup();
    await db().insert(appSettings).values({ key: GENERATION_PAUSED_KEY, value: { paused: true, message: "Back at 6pm." } });
    resetSwitchCache();
    const err = await createGeneration(user.id, input(asset.id)).catch((e) => e);
    expect(err).toMatchObject({ status: 503, code: "generation_paused", message: "Back at 6pm." });

    await db().update(appSettings).set({ value: { paused: false } }).where(eq(appSettings.key, GENERATION_PAUSED_KEY));
    resetSwitchCache();
    const gen = await createGeneration(user.id, input(asset.id));
    expect(gen.status).toBe("queued");
  });

  it("refunds a job that was queued before the switch was thrown, without calling any provider", async () => {
    const { user, asset } = await setup();
    const gen = await createGeneration(user.id, input(asset.id));
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS_CREDITS - COST);

    process.env.GENERATION_PAUSED = "true";
    resetEnvCache();
    await runGeneration(gen.id);

    const dto = (await getGeneration(user.id, gen.id))!;
    expect(dto.status).toBe("failed");
    expect(dto.images.every((i) => i.status === "failed")).toBe(true);
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS_CREDITS);
  });
});

describe("idempotent job creation", () => {
  it("a double click creates one job and one charge", async () => {
    const { user, asset } = await setup();
    const a = await createGeneration(user.id, input(asset.id));
    const b = await createGeneration(user.id, input(asset.id));
    expect(b.id).toBe(a.id);
    expect(await db().select().from(generations)).toHaveLength(1);
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS_CREDITS - COST);
  });

  it("concurrent identical requests still create exactly one job", async () => {
    const { user, asset } = await setup();
    const results = await Promise.all(Array.from({ length: 5 }, () => createGeneration(user.id, input(asset.id)).catch((e) => e)));
    const ids = new Set(results.filter((r) => !(r instanceof Error)).map((r) => r.id));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => r instanceof Error)).toEqual([]);
    expect(await db().select().from(generations)).toHaveLength(1);
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS_CREDITS - COST);
  });

  it("an explicit Idempotency-Key returns the original job even if the request differs", async () => {
    const { user, asset } = await setup();
    const a = await createGeneration(user.id, input(asset.id), { idempotencyKey: "click-1234567" });
    const b = await createGeneration(user.id, input(asset.id, { count: 1 }), { idempotencyKey: "click-1234567" });
    const c = await createGeneration(user.id, input(asset.id), { idempotencyKey: "click-7654321" });
    expect(b.id).toBe(a.id);
    expect(c.id).not.toBe(a.id);
    expect(await db().select().from(generations)).toHaveLength(2);
  });

  it("once a job has finished, the same request again is a new job (\"Generate again\")", async () => {
    const { user, asset } = await setup();
    const a = await createGeneration(user.id, input(asset.id, { count: 1 }));
    await runGeneration(a.id);
    expect((await getGeneration(user.id, a.id))!.status).toBe("succeeded");
    const again = await createGeneration(user.id, input(asset.id, { count: 1 }));
    expect(again.id).not.toBe(a.id);
    // ...but a client-supplied key keeps returning the original, finished or not.
    const k1 = await createGeneration(user.id, input(asset.id, { count: 1 }), { idempotencyKey: "retry-key-1" });
    await runGeneration(k1.id);
    const k2 = await createGeneration(user.id, input(asset.id, { count: 1 }), { idempotencyKey: "retry-key-1" });
    expect(k2.id).toBe(k1.id);
  });

  it("every field that changes the result changes the fingerprint (override, category, look)", async () => {
    const { user, asset } = await setup();
    const base = input(asset.id, { count: 1 });
    const a = await createGeneration(user.id, base, { skipActiveCheck: true });
    const overridden = await createGeneration(user.id, { ...base, overrideDetection: true }, { skipActiveCheck: true });
    expect(overridden.id).not.toBe(a.id); // "I'm sure, use my selection" is a different request
    const jewellery = await createGeneration(user.id, { ...base, category: "jewellery" as never }, { skipActiveCheck: true });
    expect(jewellery.id).not.toBe(a.id);
    const look = await createGeneration(user.id, base, { look: "festive", skipActiveCheck: true });
    expect(look.id).not.toBe(a.id);
  });

  it("keys are per user", async () => {
    const one = await setup();
    const two = await setup();
    const a = await createGeneration(one.user.id, input(one.asset.id), { idempotencyKey: "shared-key-1" });
    const b = await createGeneration(two.user.id, input(two.asset.id), { idempotencyKey: "shared-key-1" });
    expect(b.id).not.toBe(a.id);
  });

  it("a deliberate repeat after the window, or with different settings, is a new job", async () => {
    const { user, asset } = await setup();
    const a = await createGeneration(user.id, input(asset.id, { count: 1 }));
    const other = await createGeneration(user.id, input(asset.id, { count: 1, options: { presentation: "flat_lay" } }));
    expect(other.id).not.toBe(a.id);

    // Age the first job's key out of the window.
    await db()
      .update(generations)
      .set({ idempotencyKey: `auto:old:${Math.floor(Date.now() / DEDUPE_WINDOW_MS) - 5}` })
      .where(eq(generations.id, a.id));
    const again = await createGeneration(user.id, input(asset.id, { count: 1 }));
    expect(again.id).not.toBe(a.id);
  });
});

describe("idempotent payment orders", () => {
  it("a double click reuses the open order instead of creating a second one", async () => {
    const u = await makeUser();
    const pack = findPack("starter")!;
    const [a, b] = [await createCheckout(u, pack.id), await createCheckout(u, pack.id)];
    expect(b.orderId).toBe(a.orderId);
    expect(b.amount).toBe(a.amount);
    expect(await db().select().from(payments)).toHaveLength(1);
  });

  it("different packs get different orders, and a paid order is never reused", async () => {
    const u = await makeUser();
    const starter = findPack("starter")!;
    const a = await createCheckout(u, starter.id);
    const g = await createCheckout(u, "growth");
    expect(g.orderId).not.toBe(a.orderId);

    await fulfillOrder(a.orderId, "pay_1");
    const next = await createCheckout(u, starter.id);
    expect(next.orderId).not.toBe(a.orderId);
    expect(await getBalance(u.id)).toBe(SIGNUP_BONUS_CREDITS + starter.credits);
  });

  it("orders are per user", async () => {
    const [u1, u2] = [await makeUser(), await makeUser()];
    const a = await createCheckout(u1, "starter");
    const b = await createCheckout(u2, "starter");
    expect(b.orderId).not.toBe(a.orderId);
  });
});
