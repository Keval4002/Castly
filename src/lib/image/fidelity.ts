import "server-only";
import { generateText, Output } from "ai";
import sharp from "sharp";
import { z } from "zod";
import { judgeModels } from "@/lib/prompt/llm";
import type { Verdict } from "./quality";

/**
 * Product-fidelity judge: a vision LLM compares the generated catalogue photo
 * with the seller's (cleaned) product photo.
 *
 * Holistic "does it look the same?" judgements pass simplified copies, so the
 * judge must first list the product's distinctive features from the original,
 * then check each one in the output. The score is capped by that checklist,
 * and the judge also rates how prominent the product is in the frame.
 */
const JUDGE_TIMEOUT_MS = 15_000;
/** The product photo is already cropped to the product; outputs need more pixels for small details. */
const REFERENCE_SIDE = 640;
const OUTPUT_SIDE = 896;

const verdictSchema = z.object({
  reference_features: z.array(z.string()).max(10),
  checks: z
    .array(z.object({ feature: z.string(), status: z.enum(["match", "changed", "missing", "not_visible"]) }))
    .max(10),
  product_prominence: z.enum(["hero", "clear", "small", "not_visible"]),
  same_product: z.boolean(),
  score: z.number().min(0).max(1),
  differences: z.array(z.string()).max(6),
});

export const JUDGE_PROMPT = `You are a strict e-commerce quality inspector protecting shoppers from receiving something different from what they saw. Image 1 is the seller's real product. Image 2 is an AI-generated catalogue photo that must show exactly that same product.

Step 1 — "reference_features": list 4–8 distinctive, checkable features of the product in image 1 (overall shape and proportions, colours, pattern/print and its scale, motifs, number and arrangement of repeated elements such as beads, drops, stones or buttons, borders, the largest/centre element, closures, texture).
Step 2 — "checks": for each feature, inspect image 2 closely and mark "match", "changed" (present but different: smaller, simplified, recoloured, rearranged, different count), "missing", or "not_visible" (hidden by pose or angle).
Be strict: a simplified, smaller or "inspired by" version is NOT a match. Ignore background, props, lighting mood, camera angle, crop, the model's face/body/pose, and natural changes from being worn (drape, folds, perspective).
Step 3 — "product_prominence": how the product sits in image 2 — "hero" (centred, large, the clear focal point), "clear" (easy to see in detail but not dominant), "small" (a minor part of the frame; details hard to judge), "not_visible".
Step 4 — "same_product": true only if a shopper would receive exactly this item. "score": 0–1 fidelity (1 identical; 0.8 only negligible differences; below 0.6 clearly altered). "differences": short concrete differences (empty if none).

Respond with JSON only.`;

async function preview(img: Buffer, side: number) {
  return sharp(img).resize({ width: side, height: side, fit: "inside" }).jpeg({ quality: 85 }).toBuffer();
}

/** Combine the model's own score with its checklist so a lenient overall score can't hide changed features. */
export function scoreVerdict(v: z.infer<typeof verdictSchema>): Pick<Verdict, "sameProduct" | "score" | "differences" | "prominence"> {
  const judged = v.checks.filter((c) => c.status !== "not_visible");
  const matched = judged.filter((c) => c.status === "match").length;
  const failed = judged.filter((c) => c.status !== "match");
  const checklist = judged.length ? matched / judged.length : v.score;
  const differences = [...v.differences, ...failed.map((c) => `${c.feature} (${c.status})`)].map((d) => d.trim()).filter(Boolean);
  return {
    sameProduct: v.same_product && failed.length === 0,
    score: Math.round(Math.min(v.score, checklist) * 100) / 100,
    differences: [...new Set(differences)].slice(0, 6),
    prominence: v.product_prominence,
  };
}

/** Returns null when no LLM is configured or every judge failed (the image is then unverified). */
export async function judgeFidelity(product: Buffer, output: Buffer, productLabel?: string): Promise<Verdict | null> {
  // Tests / e2e: MOCK_FIDELITY (JSON verdict) overrides the judge.
  if (process.env.MOCK_FIDELITY === "unavailable") return null; // simulate every judge erroring
  if (process.env.MOCK_FIDELITY) {
    return { ...scoreVerdict(verdictSchema.parse(JSON.parse(process.env.MOCK_FIDELITY))), judge: "mock" };
  }
  const [a, b] = await Promise.all([preview(product, REFERENCE_SIDE), preview(output, OUTPUT_SIDE)]);
  for (const judge of judgeModels()) {
    try {
      const { output: v } = await generateText({
        model: judge.instance,
        system: JUDGE_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: `Image 1 — the product${productLabel ? ` (${productLabel})` : ""}:` },
              { type: "file", data: a, mediaType: "image/jpeg" },
              { type: "text", text: "Image 2 — the generated catalogue photo:" },
              { type: "file", data: b, mediaType: "image/jpeg" },
              { type: "text", text: "Inspect the product in image 2 against image 1. Respond in JSON." },
            ],
          },
        ],
        output: Output.object({ schema: verdictSchema }),
        temperature: judge.claude ? undefined : 0,
        maxOutputTokens: 700,
        // A rate-limited judge should hand over to the next one immediately.
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
        providerOptions: judge.providerOptions,
      });
      return { ...scoreVerdict(v), judge: judge.id };
    } catch (err) {
      console.warn(`[fidelity] ${judge.id} failed: ${(err as Error).message}`);
    }
  }
  return null;
}
