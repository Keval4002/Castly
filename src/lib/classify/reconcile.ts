import { CATEGORIES, productType, type CategoryId } from "@/lib/catalog/options";

/** What the vision classifier saw in an uploaded product photo. */
export interface Classification {
  category: CategoryId | "other";
  /** A ProductType id within `category`, or null when unknown / not a product we support. */
  productType: string | null;
  /** 0–1 */
  confidence: number;
  /** Short human description, e.g. "Red silk saree with gold zari border". */
  description: string;
  /** Photo problems worth telling the seller about. */
  issues: ClassificationIssue[];
  /** Which model produced this (gemini / groq / claude / mock). */
  source: string;
}

export const CLASSIFICATION_ISSUES = {
  multiple_products: "The photo seems to contain several products — results are best with one product per photo.",
  blurry: "The photo looks blurry or low-detail — a sharper photo will give more accurate results.",
  product_cut_off: "Part of the product is cut off — include the whole product in the frame.",
  poor_lighting: "The lighting is very dark or uneven — colours may not be reproduced accurately.",
} as const;

export type ClassificationIssue = keyof typeof CLASSIFICATION_ISSUES;

/** Detection at or above this confidence overrides what the user selected. */
export const CORRECTION_CONFIDENCE = 0.75;

export interface Correction {
  field: "category" | "productType";
  from: string | null;
  to: string;
}

export interface ReconcileInput {
  category: CategoryId;
  productType?: string | null;
  /** User explicitly confirmed their own choice over the detection. */
  overrideDetection?: boolean;
}

export type ReconcileResult =
  | { ok: true; category: CategoryId; productType: string | null; corrections: Correction[] }
  | { ok: false; reason: "unsupported_product"; description: string };

/**
 * Decide the category + product type to generate with. A confident
 * detection wins over a mismatching user selection (and we report the
 * correction); the user can override explicitly. Low-confidence or missing
 * detections leave the user's choice untouched.
 */
export function reconcileProduct(input: ReconcileInput, detected: Classification | null): ReconcileResult {
  const userType = productType(input.category, input.productType)?.id ?? null;
  const keepUser = { ok: true as const, category: input.category, productType: userType, corrections: [] };

  if (!detected || input.overrideDetection || detected.confidence < CORRECTION_CONFIDENCE) {
    // Still use the detected type when the user didn't pick one and categories agree.
    if (detected && !userType && detected.category === input.category && detected.productType) {
      return { ...keepUser, productType: detected.productType };
    }
    return keepUser;
  }

  if (detected.category === "other") {
    return { ok: false, reason: "unsupported_product", description: detected.description };
  }

  const corrections: Correction[] = [];
  const category = detected.category;
  if (category !== input.category) corrections.push({ field: "category", from: input.category, to: category });

  let type = category === input.category ? userType : null;
  const detectedType = productType(category, detected.productType)?.id ?? null;
  if (detectedType && type !== detectedType) {
    if (type || corrections.length) corrections.push({ field: "productType", from: type, to: detectedType });
    type = detectedType;
  }
  return { ok: true, category, productType: type, corrections };
}

export function describeCorrection(c: Correction): string {
  if (c.field === "category") {
    return `Category changed from ${CATEGORIES[c.from as CategoryId]?.label ?? c.from} to ${CATEGORIES[c.to as CategoryId].label}`;
  }
  return `Product type set to ${c.to.replace(/_/g, " ")}${c.from ? ` (you chose ${c.from.replace(/_/g, " ")})` : ""}`;
}
