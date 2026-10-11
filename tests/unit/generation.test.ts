import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { saveAsset } from "@/lib/assets";
import { getBalance, InsufficientCreditsError } from "@/lib/credits";
import { db } from "@/lib/db";
import { generations } from "@/lib/db/schema";
import {
  createGeneration,
  finalizeGeneration,
  GenerationError,
  getGeneration,
  runGeneration,
  STALE_AFTER_MS,
} from "@/lib/generation/service";
import { normalizeUpload } from "@/lib/image/process";
import { SIGNUP_BONUS_CREDITS, TIERS } from "@/lib/pricing";
import { makeUser, resetDb } from "./helpers";

const fixture = readFileSync("tests/fixtures/product.jpg");

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

beforeEach(() => {
  delete process.env.MOCK_IMAGE_FAIL_PATTERN;
  return resetDb();
});
afterAll(resetDb);

describe("generation lifecycle", () => {
  it("debits, generates every variant at the exact ratio, and stays debited", async () => {
    const { user, asset } = await setup();
    const gen = await createGeneration(user.id, input(asset.id));
    const cost = 2 * TIERS.standard.creditsPerImage;
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS_CREDITS - cost);

    await runGeneration(gen.id);
    const dto = (await getGeneration(user.id, gen.id))!;
    expect(dto.status).toBe("succeeded");
    expect(dto.images.map((i) => i.status)).toEqual(["succeeded", "succeeded"]);
    expect(dto.images[0]).toMatchObject({ width: 1024, height: 1280, provider: "mock" });
    expect(dto.images[0].url).toMatch(/^\/api\/files\//);
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS_CREDITS - cost);

    // Running again is a no-op (job already claimed).
    await runGeneration(gen.id);
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS_CREDITS - cost);
  });

  it("refunds every failed image", async () => {
    process.env.MOCK_IMAGE_FAIL_PATTERN = "FAILME";
    const { user, asset } = await setup();
    const gen = await createGeneration(user.id, input(asset.id, { customNote: "FAILME" }));
    await runGeneration(gen.id);
    const dto = (await getGeneration(user.id, gen.id))!;
    expect(dto.status).toBe("failed");
    expect(dto.refundedCredits).toBe(dto.costCredits);
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS_CREDITS);
  });

  it("rejects batches the user cannot afford without charging", async () => {
    const { user, asset } = await setup();
    await expect(createGeneration(user.id, input(asset.id, { tier: "premium", count: 4 }))).rejects.toBeInstanceOf(
      InsufficientCreditsError,
    );
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS_CREDITS);
    expect(await db().select().from(generations)).toHaveLength(0);
  });

  it("does not let users generate from someone else's photo", async () => {
    const { asset } = await setup();
    const other = await makeUser();
    await expect(createGeneration(other.id, input(asset.id))).rejects.toBeInstanceOf(GenerationError);
    expect(await getGeneration(other.id, asset.id)).toBeNull();
  });

  it("reaps stale jobs and refunds them", async () => {
    const { user, asset } = await setup();
    const gen = await createGeneration(user.id, input(asset.id, { count: 1 }));
    await db()
      .update(generations)
      .set({ status: "running", createdAt: new Date(Date.now() - STALE_AFTER_MS - 1000) })
      .where(eq(generations.id, gen.id));
    const dto = (await getGeneration(user.id, gen.id))!;
    expect(dto.status).toBe("failed");
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS_CREDITS);
    await finalizeGeneration(gen.id); // idempotent
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS_CREDITS);
  });
});
