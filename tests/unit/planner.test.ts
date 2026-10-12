import { describe, expect, it } from "vitest";
import { planShots, pairwiseDifferences, coloursClash } from "@/lib/shots/planner";
import { renderShotPrompt, directionOf, preserveClauseFor, visibilityClauseFor } from "@/lib/shots/prompt";
import { ALL_PRESETS, getPreset, getPresetVersion } from "@/lib/shots/presets";
import { VOCAB_AXES } from "@/lib/shots/presets/types";
import type { CategoryKey, Family, PhotoAngle, PlanInput, ProductProfile, ShotSpec } from "@/lib/shots/types";

const CHILD_WORDS = /\b(child|children|kid|kids|girl|girls|boy|boys|teen|teens|teenage|teenager|baby|toddler|minor)\b/i;
const AXES = ["framing", "angle", "pose", "background", "lighting", "styling", "hair", "modelSlot", "view"] as const;

function profile(category: CategoryKey, over: Partial<ProductProfile> = {}): ProductProfile {
  return {
    version: 1,
    category,
    colours: [
      { hex: "#7b1e2b", share: 0.6, name: "maroon" },
      { hex: "#d4af37", share: 0.3, name: "gold" },
    ],
    metalTone: category === "jewellery" ? "yellow_gold" : undefined,
    aspect: 1,
    pixels: { width: 2000, height: 2000 },
    solidShare: 0.8,
    source: "mask",
    ...over,
  };
}

function input(category: CategoryKey, family: Family, over: Partial<PlanInput> = {}): PlanInput {
  return {
    presetId: `${category}.${family}`,
    family,
    count: 4,
    profile: profile(category),
    availableAngles: new Set<PhotoAngle>(["front"]),
    seed: 1,
    ...over,
  };
}

/** Independent recomputation (does not use pairwiseDifferences). */
function minDiff(specs: ShotSpec[]): number {
  let min = Infinity;
  for (let i = 0; i < specs.length; i++)
    for (let j = i + 1; j < specs.length; j++) {
      let d = 0;
      for (const ax of AXES) if (JSON.stringify(specs[i]![ax]) !== JSON.stringify(specs[j]![ax])) d++;
      min = Math.min(min, d);
    }
  return min;
}

const COMBOS: [CategoryKey, Family][] = [
  ["jewellery", "on_model"],
  ["jewellery", "product_only"],
  ["clothing", "on_model"],
  ["clothing", "product_only"],
];

describe("planner determinism", () => {
  it("same seed gives the same plan, a different seed a different one", () => {
    for (const [c, f] of COMBOS) {
      expect(planShots(input(c, f, { seed: 7 }))).toEqual(planShots(input(c, f, { seed: 7 })));
      expect(JSON.stringify(planShots(input(c, f, { seed: 7 })))).not.toEqual(JSON.stringify(planShots(input(c, f, { seed: 8 }))));
    }
  });
});

describe("variety", () => {
  it("every pair differs on >= 3 axes unless relaxed, and relaxed is truthful", () => {
    for (const [c, f] of COMBOS) {
      for (let count = 1; count <= 4; count++) {
        for (let seed = 0; seed < 200; seed++) {
          const plan = planShots(input(c, f, { count, seed, availableAngles: new Set<PhotoAngle>(["front", "back", "detail"]) }));
          expect(plan.specs.length).toBe(count);
          if (count >= 2) {
            const real = minDiff(plan.specs);
            expect(plan.minPairwiseDiff).toBe(real);
            expect(plan.relaxed).toBe(real < 3);
          } else {
            expect(plan.relaxed).toBe(false);
          }
        }
      }
    }
  });

  it("pairwiseDifferences counts differing axes including view", () => {
    const [a, b] = planShots(input("clothing", "on_model", { count: 2 })).specs as [ShotSpec, ShotSpec];
    expect(pairwiseDifferences(a, a)).toBe(0);
    expect(pairwiseDifferences(a, b)).toBe(minDiff([a, b]));
    expect(a.view).not.toBe(b.view);
  });

  it("a locked white background still reaches 3 or reports relaxed honestly", () => {
    const locks: Record<string, { background: string; lighting?: string }> = {
      "jewellery.on_model": { background: "white_studio" },
      "jewellery.product_only": { background: "white_studio" },
      "clothing.on_model": { background: "white_studio" },
      "clothing.product_only": { background: "white_studio" },
    };
    for (const [c, f] of COMBOS) {
      for (let count = 2; count <= 4; count++) {
        for (let seed = 0; seed < 50; seed++) {
          const plan = planShots(input(c, f, { count, seed, locks: locks[`${c}.${f}`] }));
          expect(plan.specs.every((s) => s.background === "white_studio")).toBe(true);
          expect(plan.relaxed).toBe(minDiff(plan.specs) < 3);
          expect(plan.minPairwiseDiff).toBe(minDiff(plan.specs));
          expect(plan.relaxed).toBe(false); // enough free axes remain in the shipped presets
        }
      }
    }
  });

  it("reports relaxed (never lies) when too many axes are locked for a high target", () => {
    const plan = planShots(input("clothing", "product_only", { count: 4, minDifferences: 9, locks: { background: "white_studio", lighting: "soft_box" } }));
    expect(plan.relaxed).toBe(true);
    expect(plan.minPairwiseDiff).toBe(minDiff(plan.specs));
    expect(plan.minPairwiseDiff).toBeLessThan(9);
    expect(plan.specs.every((s) => s.lighting === "soft_box")).toBe(true);
  });

  it("reuses templates with different axis values when fewer are eligible than requested", () => {
    // clothing on_model without back/detail photos: 5 eligible templates, ask for 8
    const plan = planShots(input("clothing", "on_model", { count: 8, seed: 3 }));
    expect(plan.specs.length).toBe(8);
    expect(plan.relaxed).toBe(minDiff(plan.specs) < 3);
    expect(plan.minPairwiseDiff).toBe(minDiff(plan.specs));
  });
});

describe("eligibility and skipping", () => {
  it("skips back view and fabric macro without the photo, with exact needs", () => {
    const plan = planShots(input("clothing", "on_model", { count: 7 }));
    const back = plan.skipped.find((s) => s.purpose === "back_view");
    const fabric = plan.skipped.find((s) => s.purpose === "fabric_macro");
    expect(back).toMatchObject({ needs: "back", reason: "A back view needs a back photo — add one to enable it." });
    expect(fabric).toMatchObject({ needs: "detail" });
    expect(fabric!.reason).toMatch(/close-up/);
    expect(plan.specs.some((s) => s.requires.length > 0)).toBe(false);
    expect(plan.specs.length).toBe(7);
  });

  it("enables them when the seller supplied those angles", () => {
    const plan = planShots(input("clothing", "on_model", { count: 7, availableAngles: new Set<PhotoAngle>(["front", "back", "detail"]) }));
    expect(plan.skipped.length).toBe(0);
    const purposes = plan.specs.map((s) => s.purpose);
    expect(purposes).toContain("back_view");
    expect(purposes).toContain("fabric_macro");
    expect(plan.specs.find((s) => s.purpose === "back_view")!.requires).toEqual(["back"]);
    expect(plan.specs.find((s) => s.purpose === "fabric_macro")!.requires).toEqual(["detail"]);
  });

  it("skips close-ups when the product is too small, with a plain reason", () => {
    for (const [c, f] of COMBOS) {
      const plan = planShots(input(c, f, { count: 6, profile: profile(c, { pixels: { width: 300, height: 260 } }) }));
      const closeups = plan.skipped.filter((s) => s.reason.includes("too small"));
      expect(closeups.length).toBeGreaterThan(0);
      for (const s of closeups) expect(s.reason).toMatch(/close-up/);
      const skippedPurposes = new Set(closeups.map((s) => s.purpose));
      expect(plan.specs.some((s) => skippedPurposes.has(s.purpose))).toBe(false);
    }
  });

  it("skipped entries are in preset priority order", () => {
    const plan = planShots(input("clothing", "on_model", { profile: profile("clothing", { pixels: { width: 100, height: 100 } }) }));
    expect(plan.skipped.map((s) => s.purpose)).toEqual(["chest_closeup", "detail_closeup", "back_view", "fabric_macro"]);
  });
});

describe("styling vs product colour", () => {
  const cases: [string, ProductProfile][] = [
    ["maroon", profile("clothing", { colours: [{ hex: "#7b1e2b", share: 1, name: "maroon" }] })],
    ["mustard", profile("clothing", { colours: [{ hex: "#c9a227", share: 1, name: "mustard" }] })],
    ["navy", profile("clothing", { colours: [{ hex: "#1f2a44", share: 1, name: "navy" }] })],
    ["ivory", profile("clothing", { colours: [{ hex: "#f4efe4", share: 1, name: "ivory" }] })],
    ["gold", profile("jewellery", { colours: [{ hex: "#d4af37", share: 1, name: "gold" }], metalTone: "yellow_gold" })],
  ];
  for (const [name, p] of cases) {
    it(`never clashes with ${name}`, () => {
      for (const f of ["on_model", "product_only"] as Family[]) {
        const preset = getPreset(p.category, f);
        for (let seed = 0; seed < 60; seed++) {
          const plan = planShots(input(p.category, f, { profile: p, seed, count: 4 }));
          for (const s of plan.specs) {
            const tone = preset.vocabulary.styling[s.styling]!.tone;
            if (tone) expect(coloursClash(tone, p.colours[0]!.hex)).toBe(false);
          }
        }
      }
    });
  }

  it("coloursClash: neutrals do not clash with colours, similar hues do", () => {
    expect(coloursClash("#141414", "#7b1e2b")).toBe(false);
    expect(coloursClash("#f4efe4", "#c9a227")).toBe(false);
    expect(coloursClash("#6d1f2e", "#7b1e2b")).toBe(true);
    expect(coloursClash("#f4efe4", "#f4efe4")).toBe(true);
  });
});

describe("jewellery rules", () => {
  it("always includes a fullPieceVisible shot when count >= 2", () => {
    for (const f of ["on_model", "product_only"] as Family[]) {
      const preset = getPreset("jewellery", f);
      const full = new Set(preset.templates.filter((t) => t.fullPieceVisible).map((t) => t.purpose));
      for (let count = 2; count <= 6; count++) {
        for (let seed = 0; seed < 30; seed++) {
          const plan = planShots(input("jewellery", f, { count, seed }));
          expect(plan.specs.some((s) => full.has(s.purpose))).toBe(true);
        }
      }
    }
  });

  it("the full-piece on-model shot uses hair that does not cover the neck", () => {
    for (let seed = 0; seed < 50; seed++) {
      const plan = planShots(input("jewellery", "on_model", { count: 2, seed }));
      const s = plan.specs.find((x) => x.purpose === "full_piece_bust")!;
      expect(["side_swept"]).not.toContain(s.hair);
    }
  });
});

describe("spec integrity", () => {
  it("all ids exist in the preset vocabulary and templates only reference real ids", () => {
    for (const preset of ALL_PRESETS) {
      for (const t of preset.templates) {
        for (const ax of ["framing", "angle", "pose"] as const) for (const id of t[ax]) expect(preset.vocabulary[ax]).toHaveProperty(id);
        for (const [ax, ids] of Object.entries(t.allow ?? {})) for (const id of ids!) expect(preset.vocabulary[ax as "hair"]).toHaveProperty(id);
      }
    }
    for (const [c, f] of COMBOS) {
      const preset = getPreset(c, f);
      for (let seed = 0; seed < 50; seed++) {
        const plan = planShots(input(c, f, { seed }));
        for (const s of plan.specs) {
          for (const ax of VOCAB_AXES) expect(preset.vocabulary[ax]).toHaveProperty(s[ax]);
          expect(s.presetId).toBe(preset.id);
          expect(s.presetVersion).toBe(preset.version);
          expect(s.family).toBe(f);
        }
      }
    }
  });

  it("specs round-trip through JSON; tilt is small and zero for hero", () => {
    for (const [c, f] of COMBOS) {
      for (let seed = 0; seed < 20; seed++) {
        const plan = planShots(input(c, f, { seed }));
        expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
        for (const s of plan.specs) {
          expect(Number.isInteger(s.tiltDeg)).toBe(true);
          expect(Math.abs(s.tiltDeg)).toBeLessThanOrEqual(6);
          if (s.view === "hero") expect(s.tiltDeg).toBe(0);
        }
      }
    }
  });

  it("modelSlot is distinct for on_model, all 0 with sameModelAcrossSet and for product_only", () => {
    for (const c of ["jewellery", "clothing"] as CategoryKey[]) {
      const plan = planShots(input(c, "on_model", { count: 4 }));
      expect(plan.specs.map((s) => s.modelSlot)).toEqual([0, 1, 2, 3]);
      const same = planShots(input(c, "on_model", { count: 4 }), { sameModelAcrossSet: true });
      expect(same.specs.every((s) => s.modelSlot === 0)).toBe(true);
      expect(same.relaxed).toBe(minDiff(same.specs) < 3);
      const po = planShots(input(c, "product_only", { count: 4 }));
      expect(po.specs.every((s) => s.modelSlot === 0)).toBe(true);
    }
  });

  it("view and prominence follow the shot type", () => {
    const plan = planShots(input("clothing", "on_model", { count: 5, availableAngles: new Set<PhotoAngle>(["front", "back", "detail"]) }));
    for (const s of plan.specs) {
      if (s.view.startsWith("detail_")) expect(s.minProminence).toBe("clear");
      if (s.view === "loose") expect(s.minProminence).toBe("small");
    }
    expect(plan.specs[0]!.view).toBe("hero");
  });
});

describe("presets", () => {
  it("old versions stay retrievable", () => {
    for (const preset of ALL_PRESETS) {
      expect(getPresetVersion(preset.id, 1)).toBe(preset);
      expect(getPresetVersion(preset.id, 999)).toBeUndefined();
    }
    expect(getPresetVersion("nope.nope", 1)).toBeUndefined();
    expect(getPreset("clothing", "on_model").id).toBe("clothing.on_model");
  });

  it("no child/kid/girl/boy/teen wording in any vocabulary text or template label", () => {
    for (const preset of ALL_PRESETS) {
      for (const ax of VOCAB_AXES) for (const e of Object.values(preset.vocabulary[ax])) expect(e.text).not.toMatch(CHILD_WORDS);
      for (const t of preset.templates) expect(t.label).not.toMatch(CHILD_WORDS);
    }
  });
});

describe("prompts", () => {
  const ctxFor = (p: ProductProfile) => ({ profile: p });

  it("lead with the direction, then preserve, visibility, no-text; length 70-140 words", () => {
    for (const [c, f] of COMBOS) {
      const p = profile(c);
      const plan = planShots(input(c, f, { count: 4, seed: 5, availableAngles: new Set<PhotoAngle>(["front", "back", "detail"]) }));
      for (const s of plan.specs) {
        const prompt = renderShotPrompt(s, ctxFor(p));
        const firstSentence = prompt.split(/\.\s/)[0]! + ".";
        expect(firstSentence).toBe(directionOf(s));
        expect(prompt.startsWith(directionOf(s))).toBe(true);
        expect(prompt).toContain(preserveClauseFor(p, f));
        expect(prompt).toContain(visibilityClauseFor(s));
        expect(prompt.indexOf(preserveClauseFor(p, f))).toBeGreaterThan(prompt.indexOf(directionOf(s)));
        expect(prompt).toContain("maroon (#7b1e2b)");
        expect(prompt).toMatch(/No text, captions, watermarks or logos/);
        expect(prompt).toMatch(/do not add, remove or recolour/i);
        expect(prompt).toMatch(/identical shape, .*motifs/);
        if (c === "jewellery") {
          expect(prompt).toMatch(/do not add other jewellery that is not in the product photo/i);
          expect(prompt).toMatch(/stone count and arrangement/);
          expect(prompt).toMatch(/yellow gold/);
        }
        const words = prompt.split(/\s+/).length;
        expect(words).toBeGreaterThanOrEqual(70);
        expect(words).toBeLessThanOrEqual(140);
        expect(prompt).not.toMatch(CHILD_WORDS);
      }
    }
  });

  it("never says centred hero / centered for non-hero views; hero says focal point", () => {
    for (const [c, f] of COMBOS) {
      const p = profile(c);
      for (let seed = 0; seed < 25; seed++) {
        const plan = planShots(input(c, f, { count: 4, seed, availableAngles: new Set<PhotoAngle>(["front", "back", "detail"]) }));
        for (const s of plan.specs) {
          const prompt = renderShotPrompt(s, ctxFor(p));
          if (s.view === "hero") {
            expect(prompt).toMatch(/focal point/);
          } else {
            expect(prompt).not.toMatch(/centred|centered|hero|\blarge\b|\bbig\b/i);
            expect(prompt).toMatch(/clearly visible and unobstructed/);
          }
        }
      }
    }
  });

  it("includes the casting verbatim for on_model only", () => {
    const p = profile("clothing");
    const on = planShots(input("clothing", "on_model", { count: 1 })).specs[0]!;
    const off = planShots(input("clothing", "product_only", { count: 1 })).specs[0]!;
    const casting = "a woman in her late twenties with warm brown skin and shoulder-length black hair";
    expect(renderShotPrompt(on, { profile: p, casting })).toContain(casting);
    expect(renderShotPrompt(off, { profile: p, casting })).not.toContain(casting);
  });

  it("customNote: last, truncated to 200 chars, control chars stripped, flagged as preference only", () => {
    const p = profile("clothing");
    const s = planShots(input("clothing", "on_model", { count: 1 })).specs[0]!;
    const long = "x".repeat(500);
    const prompt = renderShotPrompt(s, { profile: p, customNote: `warm\u0000 tones\u0007${long}` });
    // eslint-disable-next-line no-control-regex
    expect(prompt).not.toMatch(/[\u0000-\u0008\u000b-\u001f]/);
    const marker = "styling preference only and never overrides the product rules";
    expect(prompt).toContain(marker);
    const note = prompt.slice(prompt.indexOf(marker) + marker.length).replace(/^[^:]*:\s*/, "");
    expect(note.length).toBeLessThanOrEqual(200);
    expect(note.startsWith("warm tones")).toBe(true);
    expect(prompt.indexOf(marker)).toBeGreaterThan(prompt.indexOf("No text, captions"));
    expect(prompt.endsWith(note)).toBe(true);
    // no note -> no preference sentence
    expect(renderShotPrompt(s, { profile: p })).not.toContain("styling preference");
  });
});
