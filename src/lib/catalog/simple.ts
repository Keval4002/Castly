/**
 * The simple Studio surface: three looks, a handful of backdrops and three
 * sizes. Everything else (shot type, model, lighting, quality, variants) is
 * decided here so the seller never has to.
 */
import { CATEGORIES, CHILD_MODELS_ENABLED, resolveOptions, type CategoryId } from "./options";

export type LookId = "marketplace" | "lifestyle" | "festive";
export const LOOK_IDS: LookId[] = ["marketplace", "lifestyle", "festive"];

export interface Look {
  id: LookId;
  label: string;
  description: string;
  /** Underlying preset id in the category's `presets`. */
  preset: string;
  /** Backdrop used unless the seller picks another. */
  backdrop: string;
}

export const LOOKS: Record<CategoryId, Look[]> = {
  clothing: [
    { id: "marketplace", label: "Marketplace", description: "Clean white background. Amazon, Meesho, WhatsApp.", preset: "marketplace", backdrop: "studio_white" },
    { id: "lifestyle", label: "Lifestyle", description: "Real-life outdoor look for Instagram.", preset: "lifestyle", backdrop: "urban_street" },
    { id: "festive", label: "Festive", description: "Rich, warm heritage glow for festive wear.", preset: "festive", backdrop: "heritage" },
  ],
  jewellery: [
    { id: "marketplace", label: "Marketplace", description: "Clean, bright and modern on marble.", preset: "minimal_marble", backdrop: "white_marble" },
    { id: "lifestyle", label: "Lifestyle", description: "Worn by a model, close up.", preset: "on_model", backdrop: "pastel" },
    { id: "festive", label: "Festive", description: "Bridal styling with a warm glow.", preset: "bridal", backdrop: "silk" },
  ],
};

export interface Backdrop {
  id: string;
  label: string;
  /** CSS colour(s) for the swatch. */
  swatch: string;
}

/** Curated backdrops, written to the group each category uses for backgrounds. */
export const BACKDROPS: Record<CategoryId, { group: string; items: Backdrop[] }> = {
  clothing: {
    group: "setting",
    items: [
      { id: "studio_white", label: "White", swatch: "#ffffff" },
      { id: "studio_colour", label: "Pastel", swatch: "#f3d9d4" },
      { id: "urban_street", label: "Street", swatch: "linear-gradient(135deg,#8a8f98,#c9ccd1)" },
      { id: "garden", label: "Garden", swatch: "linear-gradient(135deg,#6f9a5b,#cfe3b8)" },
      { id: "home", label: "Home", swatch: "linear-gradient(135deg,#e8dccb,#f7f1e7)" },
      { id: "heritage", label: "Heritage", swatch: "linear-gradient(135deg,#c9743a,#f0c27a)" },
    ],
  },
  jewellery: {
    group: "backdrop",
    items: [
      { id: "white_marble", label: "Marble", swatch: "linear-gradient(135deg,#f4f4f4,#d9d9d9)" },
      { id: "black_velvet", label: "Velvet", swatch: "#17151a" },
      { id: "silk", label: "Silk", swatch: "linear-gradient(135deg,#e9d3a4,#f7ead0)" },
      { id: "pastel", label: "Pastel", swatch: "#f3d9d4" },
      { id: "wood", label: "Wood", swatch: "linear-gradient(135deg,#8a5a34,#b98558)" },
      { id: "petals", label: "Flowers", swatch: "linear-gradient(135deg,#e88aa0,#f7c6d2)" },
    ],
  },
};

export interface Size {
  id: "1:1" | "4:5" | "9:16";
  label: string;
  use: string;
}

export const SIZES: Size[] = [
  { id: "1:1", label: "Square", use: "WhatsApp, marketplaces" },
  { id: "4:5", label: "Portrait", use: "Instagram post" },
  { id: "9:16", label: "Story", use: "Reels, status" },
];

export const DEFAULT_COUNT = 2;
export const SELLS = ["clothing", "jewellery", "both"] as const;
export const PURPOSES = ["marketplace", "social", "website"] as const;
export type Purpose = (typeof PURPOSES)[number];

/** What a seller said they mainly use photos for → starting look and size. */
export const PURPOSE_DEFAULTS: Record<Purpose, { look: LookId; size: Size["id"] }> = {
  marketplace: { look: "marketplace", size: "1:1" },
  social: { look: "lifestyle", size: "4:5" },
  website: { look: "marketplace", size: "4:5" },
};

export function getLook(category: CategoryId, id: string | null | undefined): Look {
  const looks = LOOKS[category];
  return looks.find((l) => l.id === id) ?? looks[0];
}

export function validBackdrop(category: CategoryId, id: string | null | undefined): string | undefined {
  return BACKDROPS[category].items.find((b) => b.id === id)?.id;
}

/** Full option values for a look (+ optional backdrop) in a category. */
export function optionsForLook(
  category: CategoryId,
  lookId: string | null | undefined,
  backdropId?: string | null,
  productTypeId?: string | null,
): Record<string, string> {
  const look = getLook(category, lookId);
  const preset = CATEGORIES[category].presets.find((p) => p.id === look.preset)!;
  const values: Record<string, string> = { ...preset.values };
  values[BACKDROPS[category].group] = validBackdrop(category, backdropId) ?? look.backdrop;
  // Kidswear can't be shown on a generated child model yet, so show it without a model.
  if (category === "clothing" && productTypeId === "kidswear" && !CHILD_MODELS_ENABLED) values.presentation = "flat_lay";
  return resolveOptions(category, values, productTypeId);
}
