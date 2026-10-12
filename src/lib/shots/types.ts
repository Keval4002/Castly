/**
 * Shared, client-safe contract for the shot-planned pipeline (no server imports, no I/O).
 *
 *   product photo(s) -> product profile + cutout
 *        -> preset (versioned DATA) + profile + what the seller supplied
 *        -> planner: structured ShotSpecs from fixed enumerations, every pair of shots differing on >= N attributes
 *        -> per shot: its own product reference view + a deterministic prompt that LEADS with the shot direction
 *        -> per-shot QA with a prominence rule that fits the shot (a wide styled shot is not a hero close-up)
 */

/** Which photo angles a seller can supply for one product (mirrors src/lib/product-photos.ts). */
export type PhotoAngle = "front" | "back" | "side" | "detail" | "other";

export type CategoryKey = "clothing" | "jewellery";

/** on_model: a person wears it. product_only: flat lay, hanger, mannequin, display stand, surface... */
export type Family = "on_model" | "product_only";

/** The attributes a shot is described by. Two shots "differ" on an axis when their ids differ. */
export const SHOT_AXES = ["framing", "angle", "pose", "background", "lighting", "styling", "hair", "modelSlot", "view"] as const;
export type ShotAxis = (typeof SHOT_AXES)[number];

/** How the product is presented to the image model for this shot (see src/lib/image/views.ts). */
export type ReferenceView =
  | "hero" //          centred, large (marketplace-style); the only view that locks a centred layout
  | "offset_left" //   smaller, left third, room for scene/model on the right
  | "offset_right"
  | "loose" //         small and low in a big frame, for wide / full-scene shots
  | "detail_centre" // a real crop of the middle of the product (close-ups)
  | "detail_upper" //  a real crop of the upper part (collar, chest, pendant)
  | "detail_lower"; //  a real crop of the lower part (hem, border, drop)

/** Minimum acceptable prominence of the product in the OUTPUT, by shot: close-ups need hero/clear, wide shots may be small. */
export type MinProminence = "hero" | "clear" | "small";

export interface ShotSpec {
  presetId: string;
  presetVersion: number;
  family: Family;
  /** Stable id of the shot's purpose, e.g. "chest_closeup". */
  purpose: string;
  /** Plain-words label for the seller, e.g. "Chest & collar close-up". */
  purposeLabel: string;
  /** Axis values: ids from the preset's vocabulary (never free text). */
  framing: string;
  angle: string;
  pose: string;
  background: string;
  lighting: string;
  styling: string;
  hair: string;
  /** Which distinct person (0, 1, 2...) for on-model shots; every shot gets its own unless an internal flag says otherwise. */
  modelSlot: number;
  view: ReferenceView;
  /** Slight rotation of the product reference (degrees), so the layout is not copied exactly. */
  tiltDeg: number;
  minProminence: MinProminence;
  /** Photo angles the seller must have supplied for this shot to run (e.g. ["back"]). */
  requires: PhotoAngle[];
}

export interface SkippedShot {
  purpose: string;
  label: string;
  /** Plain words for the seller, e.g. "A back view needs a back photo — add one to enable it." */
  reason: string;
  needs?: PhotoAngle;
}

export interface PlanResult {
  presetId: string;
  presetVersion: number;
  family: Family;
  specs: ShotSpec[];
  skipped: SkippedShot[];
  /** The smallest number of differing attributes between any two planned shots. */
  minPairwiseDiff: number;
  /** The variety target that was asked for. */
  target: number;
  /** True if the target could not be met (e.g. a locked marketplace background leaves few free axes). */
  relaxed: boolean;
}

/** Measured (not guessed) facts about the product, identical for every shot of a set. */
export interface ProductProfile {
  version: 1;
  category: CategoryKey;
  productType?: string | null;
  /** The classifier's one-line description, if any. */
  description?: string | null;
  /** Dominant colours of the product's own pixels (mask only), most common first. */
  colours: { hex: string; share: number; name: string }[];
  /** Jewellery only. */
  metalTone?: "yellow_gold" | "rose_gold" | "silver" | "oxidised" | "mixed" | "unknown";
  /** Width / height of the cut-out product. */
  aspect: number;
  /** Pixels of the cut-out product at full quality: limits how tight a close-up can honestly be. */
  pixels: { width: number; height: number };
  /** Share of the cut-out that is solid (jewellery with open filigree/chains is low). */
  solidShare: number;
  /** How the profile was measured. "mask" is reliable; "estimate" means no cut-out was available. */
  source: "mask" | "estimate";
}

/** What the planner is told about the seller's choices. All optional: the default flow chooses nothing. */
export interface PlanLocks {
  /** Fixed background id (from the seller's look/backdrop). */
  background?: string;
  lighting?: string;
  /** Fixed styling occasion etc. are not axes; they are passed to the prompt as text. */
}

export interface PlanInput {
  presetId: string;
  family: Family;
  count: number;
  profile: ProductProfile;
  /** Angles the seller supplied for this product ("front" is always there). */
  availableAngles: ReadonlySet<PhotoAngle>;
  locks?: PlanLocks;
  /** Same seed -> same plan (tests, "redo"). */
  seed: number;
  /** Minimum differing attributes between any two shots. Default 3. */
  minDifferences?: number;
  /** Product types that are not wearable the same way etc. live in the preset; the planner gets the type for filtering. */
  productType?: string | null;
}

export const DEFAULT_MIN_DIFFERENCES = 3;
