import { describe, expect, it } from "vitest";
import {
  ASPECT_RATIOS,
  blockedReason,
  CATEGORIES,
  enforceCompatibility,
  isGroupVisible,
  isOnModel,
  resolveOptions,
  type CategoryId,
} from "@/lib/catalog/options";
import { sampleCastings, sampleDirections, templatePrompts, type PromptRequest } from "@/lib/prompt/shared";

/**
 * Exhaustive audit of the option catalogue: every product type crossed with
 * every interacting option. Each combination must resolve to valid, visible,
 * compatible selections and produce non-contradictory, product-preserving
 * prompts with a distinct model per variant.
 */
const group = (c: CategoryId, id: string) => CATEGORIES[c].groups.find((g) => g.id === id)!;
const ids = (c: CategoryId, id: string) => group(c, id).choices.map((x) => x.id);

function* combos(category: CategoryId): Generator<{ productType: string | null; input: Record<string, string> }> {
  const types = [null, ...CATEGORIES[category].productTypes.map((t) => t.id)];
  if (category === "clothing") {
    for (const productType of types)
      for (const presentation of ids(category, "presentation"))
        for (const model_gender of ids(category, "model_gender"))
          for (const setting of ids(category, "setting"))
            for (const occasion of ids(category, "occasion"))
              yield { productType, input: { presentation, model_gender, setting, occasion, pose: "back_view" } };
  } else {
    for (const productType of types)
      for (const presentation of ids(category, "presentation"))
        for (const model_gender of ids(category, "model_gender"))
          for (const backdrop of ids(category, "backdrop"))
            for (const occasion of ids(category, "occasion"))
              yield { productType, input: { presentation, model_gender, backdrop, occasion, style: "bridal", outfit: "saree" } };
  }
}

function auditPrompts(category: CategoryId, productType: string | null, values: Record<string, string>, count: number) {
  const req: PromptRequest = {
    category,
    values,
    productType,
    aspectRatio: ASPECT_RATIOS[0],
    count,
    recentPrompts: [],
    directions: sampleDirections(category, count),
  };
  req.castings = sampleCastings(req);
  const prompts = templatePrompts(req);
  const noun = CATEGORIES[category].productTypes.find((t) => t.id === productType)?.noun;
  const problems: string[] = [];
  if (prompts.length !== count) problems.push("wrong prompt count");
  if (new Set(prompts).size !== prompts.length) problems.push("duplicate prompts");
  for (const p of prompts) {
    if (/\{|\}|undefined|null|NaN/.test(p)) problems.push(`placeholder leak: ${p.slice(0, 80)}`);
    if (!/exactly identical/.test(p)) problems.push("missing product-preservation clause");
    if (noun && !p.includes(noun)) problems.push(`missing product noun "${noun}"`);
    if (values.setting === "studio_white" && /diya|Diwali|lantern|marigold|Christmas|Holi|Valentine/.test(p)) problems.push("festive theme on marketplace white");
    if (["ring", "bangles", "watch", "anklet"].includes(productType ?? "") && /shoulders-up/.test(p)) problems.push("portrait hides the piece");
    if (productType === "bottoms" && /waist-up/.test(p)) problems.push("waist-up hides bottom wear");
    if (productType === "kidswear" && isOnModel(category, values) && !/child model/.test(p)) problems.push("kidswear on an adult");
    if (/jewellery bust/.test(p) && ["ring", "bangles", "watch", "anklet", "earrings", "nose_ring"].includes(productType ?? "")) problems.push("wrong display prop");
  }
  if (isOnModel(category, values)) {
    if (req.castings.length !== count) problems.push("missing castings");
    if (new Set(req.castings).size !== count) problems.push("repeated model casting");
  } else if (req.castings.length) problems.push("casting for a product-only shot");
  return problems;
}

describe.each(["clothing", "jewellery"] as const)("%s option catalogue", (category) => {
  it("every combination resolves to valid, visible, compatible selections with sound prompts", () => {
    const failures = new Map<string, string>();
    let checked = 0;
    for (const { productType, input } of combos(category)) {
      checked++;
      const values = resolveOptions(category, input, productType);
      const key = `${productType}:${JSON.stringify(input)}`;
      for (const g of CATEGORIES[category].groups) {
        const visible = isGroupVisible(g, values);
        if (visible && !g.choices.some((c) => c.id === values[g.id])) failures.set(key, `${g.id} invalid`);
        if (!visible && g.id in values) failures.set(key, `${g.id} hidden but set`);
      }
      for (const [g, v] of Object.entries(values)) {
        const reason = blockedReason(category, productType, values, g, v);
        if (reason) failures.set(key, `blocked choice kept: ${g}=${v}`);
      }
      // Idempotent: resolving again changes nothing.
      expect(enforceCompatibility(category, productType, values).adjustments).toEqual([]);
      const problems = auditPrompts(category, productType, values, 3);
      if (problems.length) failures.set(key, problems.join("; "));
    }
    expect(checked).toBeGreaterThan(5000);
    expect([...failures].slice(0, 10)).toEqual([]);
  });

  it("every preset works for every product type", () => {
    for (const preset of CATEGORIES[category].presets) {
      for (const t of [null, ...CATEGORIES[category].productTypes.map((x) => x.id)]) {
        const values = resolveOptions(category, preset.values, t);
        expect(auditPrompts(category, t, values, 4), `${preset.id} × ${t}`).toEqual([]);
      }
    }
  });

  it("every blocked choice has a valid, unblocked fallback", () => {
    for (const t of CATEGORIES[category].productTypes) {
      for (const g of CATEGORIES[category].groups) {
        for (const c of g.choices) {
          const { values } = enforceCompatibility(category, t.id, { ...resolveOptions(category, {}), [g.id]: c.id, setting: "studio_white" });
          expect(g.choices.some((x) => x.id === values[g.id]), `${t.id} ${g.id}=${c.id}`).toBe(true);
          expect(blockedReason(category, t.id, values, g.id, values[g.id])).toBeNull();
        }
      }
    }
  });
});

describe("specific edge cases", () => {
  it("routes pieces to shots that actually show them", () => {
    expect(resolveOptions("jewellery", { presentation: "on_model_portrait" }, "ring").presentation).toBe("hand_model");
    expect(resolveOptions("jewellery", { presentation: "on_model_portrait" }, "anklet").presentation).toBe("on_model_closeup");
    expect(resolveOptions("jewellery", { presentation: "hand_model" }, "earrings").presentation).toBe("on_model_closeup");
    expect(resolveOptions("clothing", { presentation: "on_model_half" }, "bottoms").presentation).toBe("on_model_full");
    expect(resolveOptions("clothing", { presentation: "ghost_mannequin" }, "saree").presentation).toBe("flat_lay");
    // Child models are off until a review flow exists: kidswear is shown without a model.
    const kids = resolveOptions("clothing", { model_gender: "man" }, "kidswear");
    expect(kids.presentation).toBe("flat_lay");
    expect(kids.model_gender).toBeUndefined();
  });
  it("keeps marketplace white plain and allows themes elsewhere", () => {
    expect(resolveOptions("clothing", { setting: "studio_white", occasion: "diwali" }).occasion).toBe("none");
    expect(resolveOptions("clothing", { setting: "heritage", occasion: "diwali" }).occasion).toBe("diwali");
  });
  it("lets jewellery be modelled by men (watches, rings)", () => {
    const v = resolveOptions("jewellery", { presentation: "hand_model", model_gender: "man" }, "watch");
    expect(v.model_gender).toBe("man");
    expect(templatePrompts({ category: "jewellery", values: v, productType: "watch", aspectRatio: ASPECT_RATIOS[0], count: 1, recentPrompts: [], directions: ["x"] })[0]).toContain("male model");
  });
  it("uses the right display prop per piece", () => {
    const p = (t: string) =>
      templatePrompts({ category: "jewellery", values: resolveOptions("jewellery", { presentation: "display_stand" }, t), productType: t, aspectRatio: ASPECT_RATIOS[0], count: 1, recentPrompts: [], directions: ["x"] })[0];
    expect(p("ring")).toContain("ring cone holder");
    expect(p("watch")).toContain("watch display pillow");
    expect(p("necklace")).toContain("neck bust");
  });
});
