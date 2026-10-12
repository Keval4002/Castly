/**
 * Preset = versioned DATA describing how one kind of product is shot (no logic, no I/O).
 * When a preset changes, add a NEW version object and register it; old versions stay importable so stored
 * ShotSpecs (which carry presetId + presetVersion) can always be rendered again.
 */
import type { CategoryKey, Family, MinProminence, PhotoAngle, ReferenceView } from "../types";

export const VOCAB_AXES = ["framing", "angle", "pose", "background", "lighting", "styling", "hair"] as const;
export type VocabAxis = (typeof VOCAB_AXES)[number];

export interface VocabEntry {
  /** Phrase used verbatim in prompts. Adult-only wording, no full stops. */
  text: string;
  /** styling entries only: the colour of the outfit / neckline / prop, used to avoid clashing with the product. */
  tone?: string;
}

/** axis -> id -> entry. Ids are the only values a ShotSpec may carry. */
export type Vocabulary = Record<VocabAxis, Record<string, VocabEntry>>;

export interface ShotTemplate {
  /** Stable id of the purpose, e.g. "chest_closeup". */
  purpose: string;
  /** Plain words for the seller. */
  label: string;
  /** Allowed vocabulary ids for the axes every template constrains. */
  framing: readonly string[];
  angle: readonly string[];
  pose: readonly string[];
  /** Optional narrowing of the remaining free axes (defaults to the whole vocabulary). */
  allow?: Partial<Record<"background" | "lighting" | "styling" | "hair", readonly string[]>>;
  view: ReferenceView;
  minProminence: MinProminence;
  /** Photo angles the seller must have supplied ("front" is always present). */
  requires: readonly PhotoAngle[];
  /** Plain-words reason shown when `requires` is not met. */
  needsMessage?: string;
  /** Close-ups: the cut-out's longest side must be at least this many pixels or the shot is skipped. */
  minProductPixels?: number;
  /** Jewellery: the whole piece is visible with no occlusion by hair, hands or collar. */
  fullPieceVisible?: boolean;
  /** If set, the shot only runs for product types containing one of these words (case-insensitive). */
  productTypes?: readonly string[];
  /** Lower = preferred first. */
  priority: number;
}

export interface Preset {
  id: string;
  version: number;
  category: CategoryKey;
  family: Family;
  vocabulary: Vocabulary;
  templates: readonly ShotTemplate[];
}
