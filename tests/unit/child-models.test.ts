import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { saveAsset } from "@/lib/assets";
import { getBalance } from "@/lib/credits";
import { db } from "@/lib/db";
import { generations } from "@/lib/db/schema";
import { CATEGORIES, CHILD_MODELS_ENABLED, resolveOptions } from "@/lib/catalog/options";
import { createGeneration, GenerationError } from "@/lib/generation/service";
import { normalizeUpload } from "@/lib/image/process";
import { SIGNUP_BONUS_CREDITS } from "@/lib/pricing";
import { makeUser, resetDb } from "./helpers";

const fixture = readFileSync("tests/fixtures/product.jpg");

beforeEach(resetDb);
afterAll(resetDb);

describe("child models are blocked until review exists", () => {
  it("is switched off, and the options don't offer them", () => {
    expect(CHILD_MODELS_ENABLED).toBe(false);
    const gender = CATEGORIES.clothing.groups.find((g) => g.id === "model_gender")!;
    expect(gender.choices.map((c) => c.id)).toEqual(["woman", "man"]);
  });

  it("shows kidswear without any model instead of on an adult", () => {
    for (const presentation of ["on_model_full", "on_model_half", "on_model_detail"]) {
      const v = resolveOptions("clothing", { presentation }, "kidswear");
      expect(v.presentation).toBe("flat_lay");
    }
    expect(resolveOptions("clothing", { presentation: "hanger" }, "kidswear").presentation).toBe("hanger");
  });

  it("rejects a child model on the server, without creating a job or charging", async () => {
    const user = await makeUser();
    const asset = await saveAsset(user.id, "upload", await normalizeUpload(fixture), "uploads");
    for (const model_gender of ["girl", "boy"]) {
      const err = await createGeneration(user.id, {
        sourceAssetId: asset.id,
        category: "clothing",
        options: { presentation: "on_model_full", model_gender },
        aspectRatio: "4:5",
        tier: "standard",
        count: 1,
        customNote: undefined,
      }).catch((e) => e);
      expect(err).toBeInstanceOf(GenerationError);
      expect(err).toMatchObject({ status: 422, code: "child_models_unavailable" });
    }
    expect(await db().select().from(generations)).toHaveLength(0);
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS_CREDITS);
  });
});
