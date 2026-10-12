import { z } from "zod";
import { ASPECT_RATIOS } from "./options";
import { MAX_VARIANTS, TIER_ORDER } from "@/lib/pricing";

export const createGenerationSchema = z.object({
  sourceAssetId: z.string().uuid(),
  category: z.enum(["clothing", "jewellery"]),
  options: z.record(z.string(), z.string().max(64)).default({}),
  aspectRatio: z.enum(ASPECT_RATIOS.map((a) => a.id) as [string, ...string[]]),
  tier: z.enum(TIER_ORDER as [string, ...string[]]),
  count: z.number().int().min(1).max(MAX_VARIANTS),
  /** Product type id within the category (validated later; unknown ids are ignored). */
  productType: z.string().max(40).nullish(),
  /** User insists on their category/type even if the classifier disagrees. */
  overrideDetection: z.boolean().optional(),
  customNote: z
    .string()
    .max(300)
    .optional()
    .transform((s) => (s ?? "").replace(/[\u0000-\u001f]/g, " ").trim() || undefined),
});

export type CreateGenerationInput = z.infer<typeof createGenerationSchema>;
