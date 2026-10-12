import "server-only";
import { generateText, Output } from "ai";
import sharp from "sharp";
import { z } from "zod";
import { CATEGORIES, type CategoryId } from "@/lib/catalog/options";
import { env } from "@/lib/env";
import { languageModel, llmOrder } from "@/lib/prompt/llm";
import { CLASSIFICATION_ISSUES, type Classification, type ClassificationIssue } from "./reconcile";

const CLASSIFY_TIMEOUT_MS = 8_000;

const ALL_TYPES: [string, ...string[]] = [
  "unknown",
  ...CATEGORIES.clothing.productTypes.map((t) => t.id),
  ...CATEGORIES.jewellery.productTypes.map((t) => t.id),
];

const ISSUE_IDS = Object.keys(CLASSIFICATION_ISSUES) as [ClassificationIssue, ...ClassificationIssue[]];

export const classifierSchema = z.object({
  category: z.enum(["clothing", "jewellery", "other"]),
  product_type: z.enum(ALL_TYPES),
  confidence: z.number().min(0).max(1),
  description: z.string(),
  issues: z.array(z.enum(ISSUE_IDS)),
});

const typeList = (c: CategoryId) => CATEGORIES[c].productTypes.map((t) => `${t.id} (${t.label})`).join(", ");

export const CLASSIFIER_PROMPT = `You classify product photos uploaded by small online sellers before AI catalogue photography.

Identify the single main product being sold in the photo and answer with JSON only:
- "category": "clothing" for any garment or apparel (even if shown on a hanger, folded, on a mannequin or worn by a person); "jewellery" for jewellery or watches; "other" for anything else (shoes, bags, cosmetics, food, electronics, people with no clear product, screenshots…).
- "product_type": for clothing one of: ${typeList("clothing")}; for jewellery one of: ${typeList("jewellery")}; otherwise "unknown".
- "confidence": 0–1, how sure you are about category AND product_type together. Use below 0.6 when the photo is ambiguous.
- "description": one short line naming the product precisely (colour, material, key details), e.g. "Maroon silk saree with gold zari border".
- "issues": zero or more of ${ISSUE_IDS.join(", ")} — only when clearly true.

When a person is wearing jewellery and clothing, choose the item that is the obvious focus of the photo.`;

type RawClassification = z.infer<typeof classifierSchema>;

/** Make the model's answer internally consistent (type must belong to category). */
export function normalizeClassification(raw: RawClassification, source: string): Classification {
  const category = raw.category;
  let type: string | null = null;
  if (category !== "other") {
    const types = CATEGORIES[category].productTypes;
    type = types.some((t) => t.id === raw.product_type) ? raw.product_type : types[types.length - 1].id;
  }
  // A type that contradicts the category means the model is unsure.
  const consistent = category === "other" || raw.product_type === type;
  return {
    category,
    productType: type,
    confidence: Math.round((consistent ? raw.confidence : Math.min(raw.confidence, 0.5)) * 100) / 100,
    description: raw.description.trim().slice(0, 200),
    issues: [...new Set(raw.issues)],
    source,
  };
}

/**
 * Deterministic offline classifier for dev/e2e (CLASSIFIER_MODE=mock):
 * dark photos → jewellery ring, everything else → clothing dress.
 * MOCK_CLASSIFICATION (JSON) overrides the result.
 */
async function mockClassify(image: Buffer): Promise<Classification> {
  if (process.env.MOCK_CLASSIFICATION) {
    return normalizeClassification(classifierSchema.parse(JSON.parse(process.env.MOCK_CLASSIFICATION)), "mock");
  }
  const { channels } = await sharp(image).stats();
  const luminance = channels.slice(0, 3).reduce((s, c) => s + c.mean, 0) / 3;
  const raw: RawClassification =
    luminance < 80
      ? { category: "jewellery", product_type: "ring", confidence: 0.92, description: "Gold ring", issues: [] }
      : { category: "clothing", product_type: "dress", confidence: 0.93, description: "Red dress", issues: [] };
  return normalizeClassification(raw, "mock");
}

/**
 * Classify a product photo with the first available vision LLM (same
 * preference order as prompt writing). Returns null when classification is
 * off, no LLM is configured, or every LLM fails — callers must treat null as
 * "unknown" and never block on it.
 */
export async function classifyProduct(preview: Buffer): Promise<Classification | null> {
  const mode = env().CLASSIFIER_MODE;
  if (mode === "off") return null;
  if (mode === "mock") return mockClassify(preview);

  for (const id of llmOrder()) {
    const lm = languageModel(id);
    if (!lm) continue;
    try {
      const { output } = await generateText({
        model: lm.instance,
        system: CLASSIFIER_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              { type: "file", data: preview, mediaType: "image/jpeg" },
              { type: "text", text: "Classify this product photo. Respond in JSON." },
            ],
          },
        ],
        output: Output.object({ schema: classifierSchema }),
        temperature: id === "claude" ? undefined : 0,
        maxOutputTokens: 400,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(CLASSIFY_TIMEOUT_MS),
        providerOptions: lm.providerOptions,
      });
      return normalizeClassification(output, id);
    } catch (err) {
      console.warn(`[classify] ${id} failed: ${(err as Error).message}`);
    }
  }
  return null;
}
