import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { unzipSync, strFromU8 } from "fflate";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { saveAsset } from "@/lib/assets";
import { moveCredits } from "@/lib/credits";
import { aspectRatio, CATEGORIES, CATEGORY_LIST } from "@/lib/catalog/options";
import { simpleGenerationSchema, toCreateInput } from "@/lib/catalog/request";
import { BACKDROPS, LOOK_IDS, LOOKS, optionsForLook } from "@/lib/catalog/simple";
import { db } from "@/lib/db";
import { generations, products } from "@/lib/db/schema";
import { createGeneration, runGeneration } from "@/lib/generation/service";
import { normalizeUpload } from "@/lib/image/process";
import { buildPromptPlan } from "@/lib/prompt/builder";
import { sampleCastings, sampleDirections } from "@/lib/prompt/shared";
import { ensureProductForAsset, exportCatalogue, listProducts, nameFromFile } from "@/lib/products";
import { makeUser, resetDb } from "./helpers";

const fixture = readFileSync("tests/fixtures/product.jpg");

// The quality gate holds images it can't verify, so give generations a passing verdict.
const PASS = JSON.stringify({
  same_product: true,
  score: 0.95,
  differences: [],
  reference_features: ["red body"],
  checks: [{ feature: "red body", status: "match" }],
  product_prominence: "hero",
});

beforeEach(() => {
  process.env.MOCK_FIDELITY = PASS;
  return resetDb();
});
afterAll(resetDb);

describe("simple looks", () => {
  it("every look × backdrop × product type resolves to valid options and a buildable prompt", async () => {
    for (const cat of CATEGORY_LIST) {
      expect(LOOKS[cat.id].map((l) => l.id)).toEqual(LOOK_IDS);
      for (const look of LOOKS[cat.id]) {
        expect(cat.presets.some((p) => p.id === look.preset)).toBe(true);
        expect(BACKDROPS[cat.id].items.some((b) => b.id === look.backdrop)).toBe(true);
        for (const b of BACKDROPS[cat.id].items) {
          for (const t of [...cat.productTypes.map((t) => t.id), null]) {
            const options = optionsForLook(cat.id, look.id, b.id, t);
            const group = cat.groups.find((g) => g.id === BACKDROPS[cat.id].group)!;
            expect(group.choices.some((c) => c.id === options[group.id])).toBe(true);
            const castingInput = { category: cat.id, values: options, count: 1, productType: t, recentPrompts: [] };
            const plan = await buildPromptPlan({
              ...castingInput,
              aspectRatio: aspectRatio("1:1"),
              directions: sampleDirections(cat.id, 1),
              castings: sampleCastings(castingInput),
            });
            expect(plan.prompts[0]).toBeTruthy();
          }
        }
      }
    }
  });

  it("falls back to the look's backdrop when the requested one is invalid", () => {
    const o = optionsForLook("clothing", "festive", "nope");
    expect(o.setting).toBe("heritage");
    expect(optionsForLook("jewellery", "marketplace", "black_velvet").backdrop).toBe("black_velvet");
  });

  it("never asks for a child model (kidswear is shown without a model)", () => {
    const o = optionsForLook("clothing", "marketplace", null, "kidswear");
    expect(o.presentation).toBe("flat_lay");
    expect(o.model_gender).toBeUndefined();
  });

  it("builds a full generation request with fixed quality and variants, rejecting unknown sizes", () => {
    const parsed = simpleGenerationSchema.parse({
      sourceAssetId: "11111111-1111-4111-8111-111111111111",
      category: "jewellery",
      look: "festive",
      aspectRatio: "4:5",
    });
    const req = toCreateInput(parsed);
    expect(req).toMatchObject({ tier: "standard", count: 2, aspectRatio: "4:5" });
    expect(CATEGORIES.jewellery.groups.some((g) => req.options.backdrop && g.id === "backdrop")).toBe(true);
    expect(() => simpleGenerationSchema.parse({ ...parsed, aspectRatio: "16:9" })).toThrow();
  });
});

describe("catalogue", () => {
  async function setup() {
    const user = await makeUser();
    const asset = await saveAsset(user.id, "upload", await normalizeUpload(fixture), "uploads");
    const product = await ensureProductForAsset(user.id, asset, "Red Saree");
    return { user, asset, product };
  }

  it("names products from filenames", () => {
    expect(nameFromFile("red_saree-01.jpg")).toBe("red saree 01");
    expect(nameFromFile(undefined)).toBe("New product");
  });

  it("creates one product per photo and links generations to it", async () => {
    const { user, asset, product } = await setup();
    const again = await ensureProductForAsset(user.id, asset, "Other name");
    expect(again.id).toBe(product.id);

    const gen = await createGeneration(
      user.id,
      toCreateInput({ sourceAssetId: asset.id, category: "clothing", look: "lifestyle", aspectRatio: "1:1" }),
      { look: "lifestyle" },
    );
    expect(gen.productId).toBe(product.id);
    expect(gen.look).toBe("lifestyle");

    const [dto] = await listProducts(user.id);
    expect(dto.status).toBe("generating");
  });

  it("bulk jobs queue past the active limit and are all processed", async () => {
    const user = await makeUser();
    await moveCredits({ userId: user.id, delta: 100, reason: "admin_adjustment", idempotencyKey: `t:${user.id}` });
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const asset = await saveAsset(user.id, "upload", await normalizeUpload(fixture), "uploads");
      await ensureProductForAsset(user.id, asset, `P${i}`);
      const g = await createGeneration(
        user.id,
        toCreateInput({ sourceAssetId: asset.id, category: "clothing", look: "marketplace", aspectRatio: "1:1" }),
        { look: "marketplace", skipActiveCheck: true },
      );
      ids.push(g.id);
    }
    const { runQueue } = await import("@/lib/generation/service");
    await runQueue(ids);
    const rows = await db().select().from(generations);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.status === "succeeded")).toBe(true);
    const list = await listProducts(user.id);
    expect(list.every((p) => p.status === "ready" && p.imageCount === 2)).toBe(true);
  });

  it("exports a ZIP with images and a manifest, scoped to the owner", async () => {
    const { user, asset, product } = await setup();
    const gen = await createGeneration(
      user.id,
      toCreateInput({ sourceAssetId: asset.id, category: "clothing", look: "marketplace", aspectRatio: "1:1" }),
      { look: "marketplace" },
    );
    await runGeneration(gen.id);
    await db().update(products).set({ sku: "SKU-1" }).where(eq(products.id, product.id));

    const files = unzipSync(await exportCatalogue(user.id, undefined));
    const names = Object.keys(files);
    expect(names).toContain("catalogue.csv");
    expect(names.filter((n) => n.endsWith(".jpg"))).toHaveLength(2);
    expect(names.some((n) => n.startsWith("sku-1_marketplace_"))).toBe(true);
    const csv = strFromU8(files["catalogue.csv"]);
    expect(csv.split("\n")[0]).toBe("product,sku,category,type,look,size,file");
    expect(csv).toContain("Red Saree,SKU-1,clothing");

    const stranger = await makeUser();
    const other = unzipSync(await exportCatalogue(stranger.id, [product.id]));
    expect(Object.keys(other)).toEqual(["catalogue.csv"]);
  });
});
