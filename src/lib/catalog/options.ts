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

export interface Category {
  id: CategoryId;
  label: string;
  description: string;
  emoji: string;
  groups: OptionGroup[];
  presets: Preset[];
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

const clothing: Category = {
  id: "clothing",
  label: "Clothing",
  description: "Sarees, kurtas, dresses, tops, menswear, kidswear",
  emoji: "👗",
  groups: [
    {
      id: "presentation",
      label: "Shot type",
      default: "on_model_full",
      choices: [
        { id: "on_model_full", label: "Model · full body", prompt: "worn by a model, full-body shot showing the entire garment head to toe" },
        { id: "on_model_half", label: "Model · waist up", prompt: "worn by a model, waist-up shot focusing on the garment's upper half" },
        { id: "on_model_detail", label: "Model · close-up", prompt: "worn by a model, close-up crop highlighting fabric texture, print and stitching" },
        { id: "ghost_mannequin", label: "Ghost mannequin", prompt: "invisible ghost-mannequin e-commerce shot, garment shaped as if worn with no visible person" },
        { id: "flat_lay", label: "Flat lay", prompt: "neatly styled flat lay photographed from directly above" },
        { id: "hanger", label: "On hanger", prompt: "hanging on an elegant wooden hanger against a wall" },
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
        { id: "girl", label: "Girl (kid)", prompt: "young girl child model, age-appropriate natural styling" },
        { id: "boy", label: "Boy (kid)", prompt: "young boy child model, age-appropriate natural styling" },
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
  emoji: "💍",
  groups: [
    {
      id: "presentation",
      label: "Shot type",
      default: "display_stand",
      choices: [
        { id: "display_stand", label: "Display / bust", prompt: "displayed on an elegant jewellery bust or stand" },
        { id: "surface", label: "On a surface", prompt: "artfully placed on a styled surface" },
        { id: "floating", label: "Hero macro", prompt: "hero macro product shot, piece floating/suspended with crisp focus on every detail" },
        { id: "box", label: "In gift box", prompt: "presented in an open luxury jewellery box" },
        { id: "on_model_closeup", label: "Model · close-up", prompt: "worn by a model, tight close-up crop on where the piece is worn (neck, ear or wrist)" },
        { id: "on_model_portrait", label: "Model · portrait", prompt: "worn by a model, elegant shoulders-up beauty portrait" },
        { id: "hand_model", label: "Hand model", prompt: "worn on a graceful hand / wrist with neat manicure" },
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
export function resolveOptions(category: CategoryId, input: Record<string, unknown>): Record<string, string> {
  const cat = CATEGORIES[category];
  const values: Record<string, string> = {};
  for (const g of cat.groups) {
    const v = input[g.id];
    values[g.id] = typeof v === "string" && g.choices.some((c) => c.id === v) ? v : g.default;
  }
  for (const g of cat.groups) {
    if (!isGroupVisible(g, values)) delete values[g.id];
  }
  return values;
}

/** Ordered list of {label, fragment} for the visible, non-empty selections. */
export function describeSelections(category: CategoryId, values: Record<string, string>) {
  const out: { group: string; label: string; choice: string; prompt: string }[] = [];
  for (const g of CATEGORIES[category].groups) {
    const v = values[g.id];
    if (!v) continue;
    const c = g.choices.find((x) => x.id === v);
    if (!c || !c.prompt) continue;
    out.push({ group: g.id, label: g.label, choice: c.label, prompt: c.prompt });
  }
  return out;
}

export function isOnModel(category: CategoryId, values: Record<string, string>): boolean {
  const p = values.presentation ?? "";
  return category === "clothing" ? ON_MODEL_CLOTHING.includes(p) : ON_MODEL_JEWELLERY.includes(p);
}
