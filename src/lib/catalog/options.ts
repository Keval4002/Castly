/**
 * The product-category catalogue: every option a user can pick, the prompt
 * fragment it contributes, and one-click presets.
 *
 * Adding a new category (footwear, bags, cosmetics…) = adding an entry here.
 * Both the Studio UI and the prompt builder are driven from this file.
 */

export type CategoryId = "clothing" | "jewellery";

export interface Choice {
  id: string;
  label: string;
  /** Fragment fed to the prompt LLM / template. Empty = no constraint. */
  prompt: string;
  /** Shot types only: mandatory framing that makes the product the hero of the frame. */
  framing?: string;
}

export interface OptionGroup {
  id: string;
  label: string;
  hint?: string;
  choices: Choice[];
  default: string;
  /** Only shown (and only used in prompts) when another group has one of these values. */
  showIf?: { group: string; in: string[] };
  /** Collapsed under "More options" in the UI. */
  advanced?: boolean;
}

export interface Preset {
  id: string;
  label: string;
  description: string;
  values: Record<string, string>;
}

export interface ProductType {
  id: string;
  label: string;
  /** Precise noun used in prompts, e.g. "silk saree". */
  noun: string;
  /** Body area for on-model shots (jewellery), so the model wears it correctly. */
  wornOn?: string;
  /** Display prop that suits this piece (jewellery), e.g. "ring cone holder". */
  display?: string;
}

export interface Category {
  id: CategoryId;
  label: string;
  description: string;
  /** Icon key, rendered by <CategoryIcon> (lucide). */
  icon: "shirt" | "gem";
  groups: OptionGroup[];
  presets: Preset[];
  productTypes: ProductType[];
}

export interface AspectRatio {
  id: "1:1" | "4:5" | "3:4" | "9:16" | "16:9";
  label: string;
  useCase: string;
  width: number;
  height: number;
}

export const ASPECT_RATIOS: AspectRatio[] = [
  { id: "1:1", label: "Square", useCase: "WhatsApp catalogue", width: 1024, height: 1024 },
  { id: "4:5", label: "Portrait", useCase: "Instagram post", width: 1024, height: 1280 },
  { id: "3:4", label: "Catalogue", useCase: "Marketplaces", width: 1024, height: 1365 },
  { id: "9:16", label: "Story", useCase: "Status / Reels", width: 1024, height: 1820 },
  { id: "16:9", label: "Banner", useCase: "Website hero", width: 1820, height: 1024 },
];

export type AspectRatioId = AspectRatio["id"];

export function aspectRatio(id: string): AspectRatio {
  return ASPECT_RATIOS.find((a) => a.id === id) ?? ASPECT_RATIOS[0];
}

const MODEL_LOOK: Choice[] = [
  { id: "south_asian", label: "South Asian", prompt: "a South Asian (Indian) model" },
  { id: "east_asian", label: "East Asian", prompt: "an East Asian model" },
  { id: "black", label: "Black", prompt: "a Black model" },
  { id: "white", label: "White", prompt: "a white / Caucasian model" },
  { id: "latina", label: "Latin", prompt: "a Latin American model" },
  { id: "middle_eastern", label: "Middle Eastern", prompt: "a Middle Eastern model" },
];

const OCCASION: OptionGroup = {
  id: "occasion",
  label: "Theme / occasion",
  advanced: true,
  default: "none",
  choices: [
    { id: "none", label: "None", prompt: "" },
    { id: "diwali", label: "Diwali", prompt: "subtle Diwali festive mood with diyas and warm fairy lights in the background" },
    { id: "wedding", label: "Wedding season", prompt: "Indian wedding season mood with marigold and soft floral décor" },
    { id: "eid", label: "Eid", prompt: "elegant Eid festive mood with lanterns and crescent motifs" },
    { id: "holi", label: "Holi", prompt: "joyful Holi spring mood with soft pastel colour accents (product kept clean)" },
    { id: "christmas", label: "Christmas", prompt: "cosy Christmas mood with soft bokeh lights and evergreen accents" },
    { id: "valentines", label: "Valentine's", prompt: "romantic Valentine's mood with soft red and pink accents" },
    { id: "summer", label: "Summer sale", prompt: "bright, airy summer mood" },
  ],
};

const ON_MODEL_CLOTHING = ["on_model_full", "on_model_half", "on_model_detail"];

/**
 * Generated child models need a human review step before delivery (policy: held, never
 * auto-delivered). Until that flow exists they are off: not offered, and rejected by the server.
 */
export const CHILD_MODELS_ENABLED = false;
export const CHILD_MODEL_IDS = ["girl", "boy"];
export const isChildModelChoice = (v: unknown) => typeof v === "string" && CHILD_MODEL_IDS.includes(v);

const clothing: Category = {
  id: "clothing",
  label: "Clothing",
  description: "Sarees, kurtas, dresses, tops, menswear, kidswear",
  icon: "shirt",
  productTypes: [
    { id: "saree", label: "Saree", noun: "saree" },
    { id: "lehenga", label: "Lehenga", noun: "lehenga choli set" },
    { id: "kurta", label: "Kurta / kurti", noun: "kurta" },
    { id: "ethnic_set", label: "Ethnic set", noun: "ethnic suit set (kurta with bottom and dupatta)" },
    { id: "dress", label: "Dress / gown", noun: "dress" },
    { id: "top", label: "Top / blouse", noun: "top" },
    { id: "shirt", label: "Shirt", noun: "shirt" },
    { id: "tshirt", label: "T-shirt", noun: "t-shirt" },
    { id: "bottoms", label: "Jeans / trousers / skirt", noun: "bottom wear (jeans, trousers or skirt)" },
    { id: "outerwear", label: "Jacket / coat", noun: "jacket" },
    { id: "kidswear", label: "Kidswear", noun: "children's garment" },
    { id: "other_apparel", label: "Other apparel", noun: "garment" },
  ],
  groups: [
    {
      id: "presentation",
      label: "Shot type",
      default: "on_model_full",
      choices: [
        { id: "on_model_full", label: "Model · full body", prompt: "worn by a model, full-body shot showing the entire garment head to toe", framing: "the garment is the hero — model centred, the full outfit filling about 80% of the frame height, sharpest focus on the garment, background kept simple and secondary" },
        { id: "on_model_half", label: "Model · waist up", prompt: "worn by a model, waist-up shot focusing on the garment's upper half", framing: "framed from mid-thigh to just above the head with the garment centred and filling most of the frame, sharpest focus on the garment" },
        { id: "on_model_detail", label: "Model · close-up", prompt: "worn by a model, close-up crop highlighting fabric texture, print and stitching", framing: "tight crop where the garment fills the entire frame; face out of frame or barely visible; fabric, print and stitching in razor-sharp focus" },
        { id: "ghost_mannequin", label: "Ghost mannequin", prompt: "invisible ghost-mannequin e-commerce shot, garment shaped as if worn with no visible person", framing: "garment centred on a plain background, filling about 80% of the frame, every edge visible" },
        { id: "flat_lay", label: "Flat lay", prompt: "neatly styled flat lay photographed from directly above", framing: "garment centred and filling about 70% of the frame, fully visible with even margins, minimal props kept at the edges" },
        { id: "hanger", label: "On hanger", prompt: "hanging on an elegant wooden hanger against a wall", framing: "garment centred and filling most of the frame height, fully visible, background softly out of focus" },
      ],
    },
    {
      id: "model_gender",
      label: "Model",
      default: "woman",
      showIf: { group: "presentation", in: ON_MODEL_CLOTHING },
      choices: [
        { id: "woman", label: "Woman", prompt: "female model" },
        { id: "man", label: "Man", prompt: "male model" },
        ...(CHILD_MODELS_ENABLED
          ? [
              { id: "girl", label: "Girl (kid)", prompt: "young girl child model, age-appropriate natural styling" },
              { id: "boy", label: "Boy (kid)", prompt: "young boy child model, age-appropriate natural styling" },
            ]
          : []),
      ],
    },
    {
      id: "model_look",
      label: "Model look",
      default: "south_asian",
      showIf: { group: "presentation", in: ON_MODEL_CLOTHING },
      choices: MODEL_LOOK,
    },
    {
      id: "model_age",
      label: "Age",
      default: "25_35",
      advanced: true,
      showIf: { group: "model_gender", in: ["woman", "man"] },
      choices: [
        { id: "18_24", label: "18–24", prompt: "aged early twenties" },
        { id: "25_35", label: "25–35", prompt: "aged late twenties to early thirties" },
        { id: "36_50", label: "36–50", prompt: "aged around forty" },
        { id: "50_plus", label: "50+", prompt: "mature model aged mid fifties, graceful" },
      ],
    },
    {
      id: "body_type",
      label: "Body type",
      default: "average",
      advanced: true,
      showIf: { group: "model_gender", in: ["woman", "man"] },
      choices: [
        { id: "slim", label: "Slim", prompt: "slim build" },
        { id: "average", label: "Average", prompt: "average natural build" },
        { id: "athletic", label: "Athletic", prompt: "athletic toned build" },
        { id: "plus_size", label: "Plus size", prompt: "plus-size curvy build, garment fitting naturally" },
        { id: "petite", label: "Petite", prompt: "petite build" },
      ],
    },
    {
      id: "pose",
      label: "Pose",
      default: "standing",
      advanced: true,
      showIf: { group: "presentation", in: ON_MODEL_CLOTHING },
      choices: [
        { id: "standing", label: "Standing", prompt: "relaxed confident standing pose facing camera" },
        { id: "walking", label: "Walking", prompt: "natural mid-stride walking pose with garment movement" },
        { id: "sitting", label: "Sitting", prompt: "elegant seated pose" },
        { id: "candid", label: "Candid", prompt: "candid lifestyle moment, natural expression" },
        { id: "back_view", label: "Back view", prompt: "three-quarter back view showing the back of the garment" },
      ],
    },
    {
      id: "setting",
      label: "Setting",
      default: "studio_white",
      choices: [
        { id: "studio_white", label: "Studio white", prompt: "clean seamless pure white studio background, marketplace-ready" },
        { id: "studio_colour", label: "Studio colour", prompt: "seamless pastel colour studio backdrop that complements the garment" },
        { id: "urban_street", label: "City street", prompt: "stylish urban street with softly blurred background" },
        { id: "cafe", label: "Café", prompt: "warm modern café interior" },
        { id: "home", label: "Home interior", prompt: "bright minimal home interior with natural decor" },
        { id: "garden", label: "Garden", prompt: "lush green garden with soft natural foliage" },
        { id: "beach", label: "Beach", prompt: "sunny beach with soft sand and sea in the background" },
        { id: "heritage", label: "Heritage palace", prompt: "Indian heritage haveli / palace architecture with arches" },
        { id: "luxury", label: "Luxury hotel", prompt: "luxury hotel lobby with marble and warm lighting" },
      ],
    },
    {
      id: "lighting",
      label: "Lighting",
      default: "soft_studio",
      advanced: true,
      choices: [
        { id: "soft_studio", label: "Soft studio", prompt: "soft even studio lighting, true-to-life colours" },
        { id: "daylight", label: "Natural daylight", prompt: "natural diffused daylight" },
        { id: "golden_hour", label: "Golden hour", prompt: "warm golden-hour sunlight" },
        { id: "editorial", label: "Editorial", prompt: "dramatic editorial fashion lighting with defined shadows" },
      ],
    },
    OCCASION,
  ],
  presets: [
    {
      id: "marketplace",
      label: "Marketplace white",
      description: "Clean model shot on white — Amazon / Meesho / WhatsApp ready",
      values: { presentation: "on_model_full", setting: "studio_white", lighting: "soft_studio", pose: "standing" },
    },
    {
      id: "lifestyle",
      label: "Lifestyle street",
      description: "Candid outdoor look for Instagram",
      values: { presentation: "on_model_full", setting: "urban_street", lighting: "daylight", pose: "walking" },
    },
    {
      id: "festive",
      label: "Festive ethnic",
      description: "Heritage backdrop, warm glow — ideal for ethnic wear",
      values: { presentation: "on_model_full", setting: "heritage", lighting: "golden_hour", pose: "standing" },
    },
    {
      id: "flatlay",
      label: "Flat lay",
      description: "Top-down styled product shot, no model",
      values: { presentation: "flat_lay", setting: "studio_colour", lighting: "soft_studio" },
    },
    {
      id: "ghost",
      label: "Ghost mannequin",
      description: "Classic e-commerce cut-out look",
      values: { presentation: "ghost_mannequin", setting: "studio_white", lighting: "soft_studio" },
    },
  ],
};

const ON_MODEL_JEWELLERY = ["on_model_closeup", "on_model_portrait", "hand_model"];

const jewellery: Category = {
  id: "jewellery",
  label: "Jewellery",
  description: "Necklaces, earrings, rings, bangles, bridal sets",
  icon: "gem",
  productTypes: [
    { id: "necklace", label: "Necklace", noun: "necklace", wornOn: "around the neck", display: "jewellery neck bust" },
    { id: "pendant", label: "Pendant / chain", noun: "pendant on a chain", wornOn: "around the neck", display: "jewellery neck bust" },
    { id: "earrings", label: "Earrings", noun: "pair of earrings", wornOn: "on both ears, hair tucked back", display: "earring display stand" },
    { id: "ring", label: "Ring", noun: "ring", wornOn: "on a finger", display: "ring cone holder" },
    { id: "bangles", label: "Bangles / bracelet", noun: "bangle or bracelet", wornOn: "on the wrist", display: "bangle display stand" },
    {
      id: "jewellery_set",
      label: "Necklace + earrings set",
      noun: "matching necklace and earrings set",
      wornOn: "necklace around the neck and earrings on both ears",
      display: "jewellery bust with the earrings displayed beside it",
    },
    { id: "maang_tikka", label: "Maang tikka", noun: "maang tikka", wornOn: "on the forehead hair parting", display: "display head form" },
    { id: "nose_ring", label: "Nose ring / pin", noun: "nose ring", wornOn: "on the nose", display: "small velvet display pad" },
    { id: "anklet", label: "Anklet", noun: "anklet", wornOn: "on the ankle", display: "low display stand" },
    { id: "watch", label: "Watch", noun: "wristwatch", wornOn: "on the wrist", display: "watch display pillow" },
    { id: "other_jewellery", label: "Other jewellery", noun: "jewellery piece" },
  ],
  groups: [
    {
      id: "presentation",
      label: "Shot type",
      default: "display_stand",
      choices: [
        { id: "display_stand", label: "Display / bust", prompt: "displayed on an elegant {display}", framing: "the piece centred and filling about 60% of the frame, tack-sharp on every detail, stand and backdrop secondary" },
        { id: "surface", label: "On a surface", prompt: "artfully placed on a styled surface", framing: "the piece centred and filling about 50–60% of the frame, tack-sharp; any props small and at the edges" },
        { id: "floating", label: "Hero macro", prompt: "hero macro product shot, piece floating/suspended with crisp focus on every detail", framing: "the piece centred and filling about 70% of the frame, every detail in razor-sharp focus" },
        { id: "box", label: "In gift box", prompt: "presented in an open luxury jewellery box", framing: "the open box centred with the piece filling most of it and about half of the frame, piece in sharpest focus" },
        { id: "on_model_closeup", label: "Model · close-up", prompt: "worn by a model, tight close-up crop on where the piece is worn", framing: "macro crop on the body area where it is worn so the piece sits in the centre and fills about half of the frame; face cropped out or partly out of frame; the piece is the sharpest point" },
        { id: "on_model_portrait", label: "Model · portrait", prompt: "worn by a model, elegant shoulders-up beauty portrait", framing: "framed from just below the collarbones to the top of the head with the piece centred and prominent — it must be the first thing the eye sees and the sharpest point, never hidden by hair or clothing" },
        { id: "hand_model", label: "Hand model", prompt: "worn on a graceful hand / wrist with neat manicure", framing: "hand and piece centred, the piece filling about 40% of the frame and in sharpest focus, background softly blurred" },
      ],
    },
    {
      id: "style",
      label: "Style",
      default: "posh",
      choices: [
        { id: "posh", label: "Posh luxury", prompt: "opulent high-end luxury aesthetic" },
        { id: "minimal", label: "Minimal", prompt: "clean minimal modern aesthetic with lots of negative space" },
        { id: "bridal", label: "Bridal / traditional", prompt: "rich traditional Indian bridal aesthetic" },
        { id: "everyday", label: "Everyday casual", prompt: "relatable everyday casual aesthetic" },
        { id: "nature", label: "Nature / organic", prompt: "organic natural aesthetic with botanical elements" },
        { id: "editorial", label: "Bold editorial", prompt: "bold high-fashion editorial aesthetic" },
      ],
    },
    {
      id: "backdrop",
      label: "Surface / backdrop",
      default: "black_velvet",
      choices: [
        { id: "black_velvet", label: "Black velvet", prompt: "deep black velvet" },
        { id: "white_marble", label: "White marble", prompt: "white Carrara marble" },
        { id: "silk", label: "Silk / satin", prompt: "softly draped champagne silk satin" },
        { id: "stone", label: "Raw stone", prompt: "textured natural stone" },
        { id: "wood", label: "Warm wood", prompt: "warm polished walnut wood" },
        { id: "mirror", label: "Mirror", prompt: "reflective mirror surface with subtle reflection" },
        { id: "pastel", label: "Pastel seamless", prompt: "soft pastel seamless backdrop" },
        { id: "petals", label: "Flowers", prompt: "scattered rose petals and fresh flowers" },
      ],
    },
    {
      id: "model_gender",
      label: "Model",
      default: "woman",
      showIf: { group: "presentation", in: ON_MODEL_JEWELLERY },
      choices: [
        { id: "woman", label: "Woman", prompt: "female model" },
        { id: "man", label: "Man", prompt: "male model" },
      ],
    },
    {
      id: "model_look",
      label: "Model look",
      default: "south_asian",
      showIf: { group: "presentation", in: ON_MODEL_JEWELLERY },
      choices: MODEL_LOOK,
    },
    {
      id: "outfit",
      label: "Model outfit",
      default: "neutral",
      advanced: true,
      showIf: { group: "presentation", in: ["on_model_closeup", "on_model_portrait"] },
      choices: [
        { id: "neutral", label: "Neutral top", prompt: "wearing a simple neutral-toned top that doesn't compete with the jewellery" },
        { id: "off_shoulder", label: "Off-shoulder", prompt: "wearing an off-shoulder outfit exposing neck and collarbones" },
        { id: "saree", label: "Saree / lehenga", prompt: "wearing a coordinated silk saree or lehenga" },
        { id: "black_dress", label: "Black dress", prompt: "wearing an elegant black evening dress" },
      ],
    },
    {
      id: "lighting",
      label: "Lighting",
      default: "soft",
      advanced: true,
      choices: [
        { id: "soft", label: "Soft diffused", prompt: "soft diffused light, accurate metal and stone colours" },
        { id: "spotlight", label: "Spotlight", prompt: "dramatic spotlight with deep shadows" },
        { id: "sparkle", label: "Sparkle", prompt: "high-key sparkle lighting that makes stones glint" },
        { id: "warm", label: "Warm glow", prompt: "warm golden ambient glow" },
      ],
    },
    OCCASION,
  ],
  presets: [
    {
      id: "luxury_velvet",
      label: "Luxury velvet",
      description: "Classic jeweller look on black velvet",
      values: { presentation: "display_stand", style: "posh", backdrop: "black_velvet", lighting: "spotlight" },
    },
    {
      id: "minimal_marble",
      label: "Minimal marble",
      description: "Clean, modern, Instagram-friendly",
      values: { presentation: "surface", style: "minimal", backdrop: "white_marble", lighting: "soft" },
    },
    {
      id: "on_model",
      label: "On model",
      description: "Close-up of the piece worn by a model",
      values: { presentation: "on_model_closeup", style: "posh", backdrop: "pastel", lighting: "soft" },
    },
    {
      id: "bridal",
      label: "Bridal glam",
      description: "Traditional bridal styling with warm glow",
      values: { presentation: "on_model_portrait", style: "bridal", backdrop: "silk", lighting: "warm", outfit: "saree" },
    },
    {
      id: "hand",
      label: "Hand model",
      description: "For rings, bangles and bracelets",
      values: { presentation: "hand_model", style: "minimal", backdrop: "silk", lighting: "soft" },
    },
  ],
};

export const CATEGORIES: Record<CategoryId, Category> = { clothing, jewellery };
export const CATEGORY_LIST: Category[] = [clothing, jewellery];

export function isGroupVisible(group: OptionGroup, values: Record<string, string>): boolean {
  if (!group.showIf) return true;
  return group.showIf.in.includes(values[group.showIf.group]);
}

export function defaultValues(category: CategoryId): Record<string, string> {
  return Object.fromEntries(CATEGORIES[category].groups.map((g) => [g.id, g.default]));
}

/**
 * Normalise user-submitted option values: unknown groups dropped, invalid
 * choices replaced with defaults, hidden groups removed.
 */
export function resolveOptions(
  category: CategoryId,
  input: Record<string, unknown>,
  productTypeId?: string | null,
): Record<string, string> {
  const cat = CATEGORIES[category];
  let values: Record<string, string> = {};
  for (const g of cat.groups) {
    const v = input[g.id];
    values[g.id] = typeof v === "string" && g.choices.some((c) => c.id === v) ? v : g.default;
  }
  values = enforceCompatibility(category, productTypeId, values).values;
  for (const g of cat.groups) {
    if (!isGroupVisible(g, values)) delete values[g.id];
  }
  return values;
}

/** Ordered list of {label, fragment} for the visible, non-empty selections. */
export function describeSelections(category: CategoryId, values: Record<string, string>, productTypeId?: string | null) {
  const display = productType(category, productTypeId)?.display ?? "jewellery display stand";
  const out: { group: string; label: string; choice: string; prompt: string }[] = [];
  for (const g of CATEGORIES[category].groups) {
    const v = values[g.id];
    if (!v) continue;
    const c = g.choices.find((x) => x.id === v);
    if (!c || !c.prompt) continue;
    out.push({ group: g.id, label: g.label, choice: c.label, prompt: c.prompt.replace("{display}", display) });
  }
  return out;
}

// ---------- compatibility rules ----------

/**
 * Combinations that can't produce a good catalogue photo. The Studio disables
 * blocked choices (showing the reason) and the server applies the same
 * fallbacks, so a request can never ask for e.g. a ring in a shoulders-up portrait.
 */
export interface CompatibilityRule {
  group: string;
  block: string[];
  reason: string;
  /** Replacement choice; per product type where it differs. */
  fallback: string | Record<string, string>;
  /** Applies to these product types (any when omitted). */
  productTypes?: string[];
  /** Applies only while another group has one of these values. */
  when?: { group: string; in: string[] };
}

const NOT_ON_HAND = ["necklace", "pendant", "earrings", "jewellery_set", "maang_tikka", "nose_ring", "anklet"];
const NOT_IN_PORTRAIT = ["ring", "bangles", "watch", "anklet"];

export const COMPATIBILITY: Record<CategoryId, CompatibilityRule[]> = {
  clothing: [
    CHILD_MODELS_ENABLED
      ? {
          group: "model_gender",
          block: ["woman", "man"],
          productTypes: ["kidswear"],
          fallback: "girl",
          reason: "Kidswear is shown on a child model",
        }
      : {
          // No child models yet, and an adult model would misrepresent size and fit.
          group: "presentation",
          block: ON_MODEL_CLOTHING,
          productTypes: ["kidswear"],
          fallback: "flat_lay",
          reason: "Kidswear can’t be shown on a model yet — showing it as a flat lay",
        },
    {
      group: "presentation",
      block: ["on_model_half"],
      productTypes: ["bottoms"],
      fallback: "on_model_full",
      reason: "A waist-up shot would hide bottom wear",
    },
    {
      group: "presentation",
      block: ["ghost_mannequin"],
      productTypes: ["saree"],
      fallback: "flat_lay",
      reason: "An unstitched saree can’t hold a ghost-mannequin shape",
    },
    {
      group: "occasion",
      block: OCCASION.choices.map((c) => c.id).filter((id) => id !== "none"),
      when: { group: "setting", in: ["studio_white"] },
      fallback: "none",
      reason: "Marketplace white stays plain white — pick another setting for a festive theme",
    },
  ],
  jewellery: [
    {
      group: "presentation",
      block: ["hand_model"],
      productTypes: NOT_ON_HAND,
      fallback: "on_model_closeup",
      reason: "This piece isn’t worn on the hand",
    },
    {
      group: "presentation",
      block: ["on_model_portrait"],
      productTypes: NOT_IN_PORTRAIT,
      fallback: { ring: "hand_model", bangles: "hand_model", watch: "hand_model", anklet: "on_model_closeup" },
      reason: "A shoulders-up portrait wouldn’t show this piece",
    },
  ],
};

function ruleApplies(rule: CompatibilityRule, productTypeId: string | null | undefined, values: Record<string, string>) {
  if (rule.productTypes && !(productTypeId && rule.productTypes.includes(productTypeId))) return false;
  if (rule.when && !rule.when.in.includes(values[rule.when.group])) return false;
  return true;
}

/** Why a choice can't be used with the current product and selections, or null. */
export function blockedReason(
  category: CategoryId,
  productTypeId: string | null | undefined,
  values: Record<string, string>,
  group: string,
  choice: string,
): string | null {
  for (const rule of COMPATIBILITY[category]) {
    if (rule.group === group && rule.block.includes(choice) && ruleApplies(rule, productTypeId, values)) return rule.reason;
  }
  return null;
}

export interface Adjustment {
  group: string;
  from: string;
  to: string;
  reason: string;
}

/** Replace blocked selections with their fallbacks (idempotent). */
export function enforceCompatibility(
  category: CategoryId,
  productTypeId: string | null | undefined,
  input: Record<string, string>,
): { values: Record<string, string>; adjustments: Adjustment[] } {
  const values = { ...input };
  const adjustments: Adjustment[] = [];
  // A fix can switch other rules on or off, so settle in a few passes.
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const rule of COMPATIBILITY[category]) {
      const current = values[rule.group];
      if (!current || !rule.block.includes(current) || !ruleApplies(rule, productTypeId, values)) continue;
      const to =
        typeof rule.fallback === "string" ? rule.fallback : (rule.fallback[productTypeId ?? ""] ?? Object.values(rule.fallback)[0]);
      values[rule.group] = to;
      adjustments.push({ group: rule.group, from: current, to, reason: rule.reason });
      changed = true;
    }
    if (!changed) break;
  }
  return { values, adjustments };
}

/** Mandatory hero framing for the selected shot type. */
export function framingFor(category: CategoryId, values: Record<string, string>): string | undefined {
  return CATEGORIES[category].groups.find((g) => g.id === "presentation")?.choices.find((c) => c.id === values.presentation)?.framing;
}

export function productType(category: CategoryId, id: string | null | undefined): ProductType | undefined {
  return id ? CATEGORIES[category].productTypes.find((t) => t.id === id) : undefined;
}

export function isOnModel(category: CategoryId, values: Record<string, string>): boolean {
  const p = values.presentation ?? "";
  return category === "clothing" ? ON_MODEL_CLOTHING.includes(p) : ON_MODEL_JEWELLERY.includes(p);
}
