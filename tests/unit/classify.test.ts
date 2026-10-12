import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { saveAsset } from "@/lib/assets";
import { aspectRatio, resolveOptions } from "@/lib/catalog/options";
import { classifyProduct, normalizeClassification } from "@/lib/classify/classifier";
import { reconcileProduct, type Classification } from "@/lib/classify/reconcile";
import { getBalance } from "@/lib/credits";
import { db } from "@/lib/db";
import { assets, generations } from "@/lib/db/schema";
import { createGeneration, GenerationError, getGeneration } from "@/lib/generation/service";
import { llmPreview, normalizeUpload } from "@/lib/image/process";
import { SIGNUP_BONUS_CREDITS } from "@/lib/pricing";
import { buildUserMessage, templatePrompts, type PromptRequest } from "@/lib/prompt/shared";
import { makeUser, resetDb } from "./helpers";

const necklace: Classification = {
  category: "jewellery",
  productType: "necklace",
  confidence: 0.94,
  description: "Gold temple necklace with rubies",
  issues: [],
  source: "test",
};

describe("reconcileProduct", () => {
  it("corrects a wrong category and product type when the detection is confident", () => {
    const r = reconcileProduct({ category: "clothing", productType: "saree" }, necklace);
    expect(r).toEqual({
      ok: true,
      category: "jewellery",
      productType: "necklace",
      corrections: [
        { field: "category", from: "clothing", to: "jewellery" },
        { field: "productType", from: null, to: "necklace" },
      ],
    });
  });

  it("corrects only the product type within the right category", () => {
    const r = reconcileProduct({ category: "jewellery", productType: "ring" }, necklace);
    expect(r).toMatchObject({ ok: true, category: "jewellery", productType: "necklace" });
    expect(r.ok && r.corrections).toEqual([{ field: "productType", from: "ring", to: "necklace" }]);
  });

  it("fills in the type silently when the user didn't choose one", () => {
    const r = reconcileProduct({ category: "jewellery" }, necklace);
    expect(r).toMatchObject({ ok: true, productType: "necklace", corrections: [] });
  });

  it("respects an explicit user override", () => {
    const r = reconcileProduct({ category: "clothing", productType: "saree", overrideDetection: true }, necklace);
    expect(r).toMatchObject({ ok: true, category: "clothing", productType: "saree", corrections: [] });
  });

  it("ignores low-confidence detections", () => {
    const r = reconcileProduct({ category: "clothing", productType: "kurta" }, { ...necklace, confidence: 0.5 });
    expect(r).toMatchObject({ ok: true, category: "clothing", productType: "kurta", corrections: [] });
  });

  it("keeps the user's choice when there is no detection, and drops unknown type ids", () => {
    expect(reconcileProduct({ category: "clothing", productType: "<script>" }, null)).toMatchObject({
      ok: true,
      category: "clothing",
      productType: null,
    });
  });

  it("rejects confidently unsupported products unless overridden", () => {
    const shoe: Classification = { ...necklace, category: "other", productType: null, description: "Running shoe" };
    expect(reconcileProduct({ category: "clothing" }, shoe)).toEqual({
      ok: false,
      reason: "unsupported_product",
      description: "Running shoe",
    });
    expect(reconcileProduct({ category: "clothing", overrideDetection: true }, shoe).ok).toBe(true);
  });
});

describe("normalizeClassification", () => {
  it("forces the type into the detected category and lowers confidence on contradictions", () => {
    const n = normalizeClassification(
      { category: "jewellery", product_type: "saree", confidence: 0.9, description: " x ", issues: ["blurry", "blurry"] },
      "gemini",
    );
    expect(n.productType).toBe("other_jewellery");
    expect(n.confidence).toBe(0.5);
    expect(n.issues).toEqual(["blurry"]);
    expect(n.description).toBe("x");
  });

  it("has no product type for unsupported products", () => {
    const n = normalizeClassification(
      { category: "other", product_type: "unknown", confidence: 0.8, description: "Sneaker", issues: [] },
      "groq",
    );
    expect(n).toMatchObject({ category: "other", productType: null, confidence: 0.8 });
  });
});

describe("mock classifier (CLASSIFIER_MODE=mock)", () => {
  it("tells the fixtures apart", async () => {
    const dress = await classifyProduct(await llmPreview(readFileSync("tests/fixtures/product.jpg")));
    const ring = await classifyProduct(await llmPreview(readFileSync("tests/fixtures/ring.jpg")));
    expect(dress).toMatchObject({ category: "clothing", productType: "dress" });
    expect(ring).toMatchObject({ category: "jewellery", productType: "ring" });
  });
});

describe("prompts use the product type", () => {
  const req = (presentation: string): PromptRequest => ({
    category: "jewellery",
    values: resolveOptions("jewellery", { presentation }),
    aspectRatio: aspectRatio("1:1"),
    count: 1,
    productType: "earrings",
    detectedDescription: "Silver jhumka earrings",
    recentPrompts: [],
    directions: ["centred"],
  });

  it("tells the LLM what the product is and where it's worn", () => {
    const msg = buildUserMessage(req("on_model_closeup"));
    expect(msg).toContain("Product type: pair of earrings.");
    expect(msg).toContain("on both ears");
    expect(msg).toContain("Silver jhumka earrings");
    expect(buildUserMessage(req("surface"))).not.toContain("on both ears");
  });

  it("uses the precise noun in template prompts", () => {
    const [p] = templatePrompts(req("on_model_portrait"));
    expect(p).toContain("this exact pair of earrings");
    expect(p).toContain("The model wears it on both ears");
  });
});

describe("generation applies corrections", () => {
  beforeEach(resetDb);
  afterAll(resetDb);

  async function uploadAs(classification: Classification | null) {
    const user = await makeUser();
    const asset = await saveAsset(user.id, "upload", await normalizeUpload(readFileSync("tests/fixtures/product.jpg")), "uploads");
    await db().update(assets).set({ classification }).where(eq(assets.id, asset.id));
    return { user, asset };
  }

  const base = (assetId: string, extra: Record<string, unknown> = {}) => ({
    sourceAssetId: assetId,
    category: "clothing" as const,
    options: { presentation: "flat_lay" },
    aspectRatio: "1:1",
    tier: "economy",
    count: 1,
    customNote: undefined,
    ...extra,
  });

  it("generates a necklace even if the seller picked clothing, and records why", async () => {
    const { user, asset } = await uploadAs(necklace);
    const gen = await createGeneration(user.id, base(asset.id, { productType: "saree" }));
    expect(gen.category).toBe("jewellery");
    expect(gen.productType).toBe("necklace");
    // Clothing options don't carry over to jewellery.
    expect(gen.options.presentation).toBe("display_stand");
    const dto = await getGeneration(user.id, gen.id);
    expect(dto?.corrections.map((c) => c.field)).toEqual(["category", "productType"]);
  });

  it("honours the override", async () => {
    const { user, asset } = await uploadAs(necklace);
    const gen = await createGeneration(user.id, base(asset.id, { productType: "saree", overrideDetection: true }));
    expect(gen).toMatchObject({ category: "clothing", productType: "saree", corrections: [] });
  });

  it("refuses unsupported products without charging", async () => {
    const { user, asset } = await uploadAs({ ...necklace, category: "other", productType: null, description: "Sneaker" });
    await expect(createGeneration(user.id, base(asset.id))).rejects.toMatchObject({
      status: 422,
      code: "unsupported_product",
    } satisfies Partial<GenerationError>);
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS_CREDITS);
    expect(await db().select().from(generations)).toHaveLength(0);
  });

  it("works unchanged when classification is unavailable", async () => {
    const { user, asset } = await uploadAs(null);
    const gen = await createGeneration(user.id, base(asset.id, { productType: "kurta" }));
    expect(gen).toMatchObject({ category: "clothing", productType: "kurta", corrections: [] });
  });
});
