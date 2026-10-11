import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/redirect";
import { aspectRatio, CATEGORIES, describeSelections, isOnModel, resolveOptions } from "@/lib/catalog/options";
import { createGenerationSchema } from "@/lib/catalog/request";
import { signWebhookBody, verifyCheckoutSignature, verifyWebhookSignature } from "@/lib/payments/razorpay";
import { CREDIT_PACKS, findPack, generationCost, TIERS } from "@/lib/pricing";
import { coercePlan, sampleDirections, templatePrompts, type PromptRequest } from "@/lib/prompt/shared";
import { createHmac } from "node:crypto";

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
    expect(plan?.prompts[0]).toBe("x".repeat(40));
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
    expect(safeNextPath("//evil.com")).toBe("/studio");
    expect(safeNextPath("https://evil.com")).toBe("/studio");
    expect(safeNextPath("/\\evil.com")).toBe("/studio");
    expect(safeNextPath(null)).toBe("/studio");
  });
});
