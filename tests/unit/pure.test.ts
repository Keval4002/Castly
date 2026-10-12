import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/redirect";
import { aspectRatio, CATEGORIES, describeSelections, isOnModel, resolveOptions } from "@/lib/catalog/options";
import { createGenerationSchema } from "@/lib/catalog/request";
import { signWebhookBody, verifyCheckoutSignature, verifyWebhookSignature } from "@/lib/payments/razorpay";
import { CREDIT_PACKS, findPack, generationCost, TIERS } from "@/lib/pricing";
import { coercePlan, sampleCastings, sampleDirections, templatePrompts, type PromptRequest } from "@/lib/prompt/shared";
import { createHmac } from "node:crypto";
import sharp from "sharp";
import { MIN_UPLOAD_SIDE, normalizeUpload } from "@/lib/image/process";

describe("pricing", () => {
  it("charges per image by tier", () => {
    expect(generationCost("economy", 4)).toBe(4 * TIERS.economy.creditsPerImage);
    expect(generationCost("premium", 2)).toBe(2 * TIERS.premium.creditsPerImage);
  });
  it("packs are unique and priced", () => {
    expect(new Set(CREDIT_PACKS.map((p) => p.id)).size).toBe(CREDIT_PACKS.length);
    expect(findPack("growth")?.credits).toBeGreaterThan(0);
    expect(findPack("nope")).toBeUndefined();
  });
});

describe("catalog options", () => {
  it("every group default is a valid choice and presets reference real choices", () => {
    for (const cat of Object.values(CATEGORIES)) {
      for (const g of cat.groups) expect(g.choices.map((c) => c.id)).toContain(g.default);
      for (const p of cat.presets) {
        for (const [gid, v] of Object.entries(p.values)) {
          const g = cat.groups.find((x) => x.id === gid);
          expect(g, `${cat.id}/${p.id}/${gid}`).toBeDefined();
          expect(g!.choices.map((c) => c.id)).toContain(v);
        }
      }
    }
  });

  it("drops invalid values and hides model options for flat lays", () => {
    const v = resolveOptions("clothing", { presentation: "flat_lay", model_gender: "man", setting: "<script>" });
    expect(v.presentation).toBe("flat_lay");
    expect(v.model_gender).toBeUndefined();
    expect(v.setting).toBe("studio_white");
    expect(isOnModel("clothing", v)).toBe(false);
  });

  it("keeps model options when on-model", () => {
    const v = resolveOptions("jewellery", { presentation: "on_model_portrait", model_look: "black" });
    expect(v.model_look).toBe("black");
    expect(describeSelections("jewellery", v).some((s) => s.prompt.includes("Black model"))).toBe(true);
  });

  it("falls back to square for unknown ratios", () => {
    expect(aspectRatio("7:3").id).toBe("1:1");
  });
});

describe("request validation", () => {
  const base = {
    sourceAssetId: "3b241101-e2bb-4255-8caf-4136c566a962",
    category: "clothing",
    aspectRatio: "1:1",
    tier: "standard",
    count: 2,
  };
  it("accepts a valid request and strips control chars from the note", () => {
    const r = createGenerationSchema.parse({ ...base, customNote: " hello\u0000world " });
    expect(r.customNote).toBe("hello world");
  });
  it("rejects too many variants / unknown tier", () => {
    expect(() => createGenerationSchema.parse({ ...base, count: 9 })).toThrow();
    expect(() => createGenerationSchema.parse({ ...base, tier: "ultra" })).toThrow();
  });
});

describe("prompt plan", () => {
  const req: PromptRequest = {
    category: "jewellery",
    values: resolveOptions("jewellery", {}),
    aspectRatio: aspectRatio("4:5"),
    count: 3,
    recentPrompts: [],
    directions: sampleDirections("jewellery", 3, () => 0),
  };

  it("samples distinct directions", () => {
    const d = sampleDirections("clothing", 4);
    expect(new Set(d).size).toBe(4);
  });

  it("template produces one product-preserving prompt per variant", () => {
    const prompts = templatePrompts(req);
    expect(prompts).toHaveLength(3);
    for (const p of prompts) expect(p).toMatch(/exactly identical/);
    expect(new Set(prompts).size).toBe(3);
  });

  it("coercePlan pads short LLM output and rejects garbage", () => {
    const plan = coercePlan({ product_summary: "Gold necklace", prompts: ["x".repeat(40)] }, req, "gemini");
    expect(plan?.prompts).toHaveLength(3);
    // The LLM dropped the mandatory framing, so it is added back.
    expect(plan?.prompts[0]).toMatch(new RegExp(`^x{40} Framing: the piece centred`));
    expect(coercePlan({ nope: true }, req, "gemini")).toBeNull();
    expect(coercePlan({ product_summary: "", prompts: ["short"] }, req, "gemini")).toBeNull();
  });
});

describe("razorpay signatures", () => {
  it("verifies checkout signatures", () => {
    const sig = createHmac("sha256", "s3cret").update("order_1|pay_1").digest("hex");
    expect(verifyCheckoutSignature("order_1", "pay_1", sig, "s3cret")).toBe(true);
    expect(verifyCheckoutSignature("order_1", "pay_2", sig, "s3cret")).toBe(false);
    expect(verifyCheckoutSignature("order_1", "pay_1", "bad", "s3cret")).toBe(false);
  });
  it("verifies webhook signatures", () => {
    const body = JSON.stringify({ event: "payment.captured" });
    expect(verifyWebhookSignature(body, signWebhookBody(body, "wh"), "wh")).toBe(true);
    expect(verifyWebhookSignature(body + " ", signWebhookBody(body, "wh"), "wh")).toBe(false);
    expect(verifyWebhookSignature(body, "", "wh")).toBe(false);
  });
});

describe("safeNextPath", () => {
  it("only allows relative paths", () => {
    expect(safeNextPath("/library")).toBe("/library");
    expect(safeNextPath("//evil.com")).toBe("/workspace");
    expect(safeNextPath("https://evil.com")).toBe("/workspace");
    expect(safeNextPath("/\\evil.com")).toBe("/workspace");
    expect(safeNextPath(null)).toBe("/workspace");
  });
});

describe("upload normalisation", () => {
  const png = (width: number, height: number) =>
    sharp({ create: { width, height, channels: 3, background: "#c9a227" } }).png().toBuffer();

  it("upscales small web images instead of rejecting them", async () => {
    const out = await normalizeUpload(await png(225, 225));
    expect(out.width).toBe(1024);
    expect(out.height).toBe(1024);
  });
  it("keeps the aspect ratio and caps large images", async () => {
    const out = await normalizeUpload(await png(4000, 2000));
    expect([out.width, out.height]).toEqual([2048, 1024]);
  });
  it("rejects images too small to see the product", async () => {
    await expect(normalizeUpload(await png(MIN_UPLOAD_SIDE - 1, 100))).rejects.toThrow(/too small/);
  });
});

describe("model casting", () => {
  const base = { category: "clothing" as const, values: { presentation: "on_model_full", model_gender: "woman", model_look: "south_asian" }, productType: "saree", recentPrompts: [] as string[] };

  it("casts a visibly different person for every variant", () => {
    for (let run = 0; run < 20; run++) {
      const castings = sampleCastings({ ...base, count: 4 });
      expect(castings).toHaveLength(4);
      const traits = castings.map((c) => c.split(", "));
      // No two variants share a face, complexion, hair or expression.
      for (let t = 0; t < 4; t++) expect(new Set(traits.map((x) => x[t])).size).toBe(4);
    }
  });
  it("avoids looks used in the seller's recent prompts", () => {
    const first = sampleCastings({ ...base, count: 2 });
    const next = sampleCastings({ ...base, count: 2, recentPrompts: [first.join(" ")] });
    for (const c of next) for (const trait of c.split(", ")) expect(first.join(" ")).not.toContain(trait);
  });
  it("keeps ears and neckline clear for earrings and respects men / kids / hand shots", () => {
    const earrings = sampleCastings({ category: "jewellery", values: { presentation: "on_model_portrait", model_look: "south_asian" }, productType: "earrings", recentPrompts: [], count: 3 });
    for (const c of earrings) expect(c).toMatch(/bun|ponytail|tucked behind the ears|top knot/);
    const man = sampleCastings({ ...base, values: { ...base.values, model_gender: "man" }, count: 2 });
    for (const c of man) expect(c).toMatch(/shaven|stubble|beard/);
    const kid = sampleCastings({ ...base, values: { ...base.values, model_gender: "girl" }, count: 2 });
    for (const c of kid) expect(c).not.toMatch(/makeup|bold lip|beard|stubble|shaven|jaw|cheekbones/);
    const hand = sampleCastings({ category: "jewellery", values: { presentation: "hand_model" }, productType: "ring", recentPrompts: [], count: 2 });
    for (const c of hand) expect(c).toMatch(/nails|manicure/);
  });
  it("casts nobody for product-only shots", () => {
    expect(sampleCastings({ ...base, values: { presentation: "flat_lay" }, count: 3 })).toEqual([]);
  });
  it("puts each casting into its template prompt", () => {
    const castings = sampleCastings({ ...base, count: 2 });
    const req: PromptRequest = { ...base, aspectRatio: aspectRatio("4:5"), count: 2, directions: sampleDirections("clothing", 2), castings };
    const prompts = templatePrompts(req);
    prompts.forEach((p, i) => expect(p).toContain(castings[i]));
  });
});

describe("test database guard", async () => {
  const { assertTestDatabase, databaseName } = await import("./db-guard");

  it("only accepts databases whose name contains 'test'", () => {
    expect(() => assertTestDatabase("postgres://u:p@localhost:5432/dukaanshot_test")).not.toThrow();
    expect(() => assertTestDatabase("postgres://u:p@localhost:5432/dukaanshot_test_agent")).not.toThrow();
    expect(() => assertTestDatabase("postgres://u:p@h:6543/Test_DB?sslmode=require")).not.toThrow();
    expect(() => assertTestDatabase("postgres://u:p@aws-0.pooler.supabase.com:6543/postgres")).toThrow(/Refusing to run tests/);
    expect(() => assertTestDatabase("postgres://u:p@localhost:5432/dukaanshot")).toThrow(/Refusing/);
    expect(() => assertTestDatabase("not a url")).toThrow(/unparseable/);
  });

  it("is not fooled by 'test' in the host, user or password", () => {
    expect(databaseName("postgres://test:test@testhost:5432/prod")).toBe("prod");
    expect(() => assertTestDatabase("postgres://test:test@testhost:5432/prod")).toThrow(/Refusing/);
  });
});
