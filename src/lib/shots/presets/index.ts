import type { CategoryKey, Family } from "../types";
import { CLOTHING_PRESETS } from "./clothing";
import { JEWELLERY_PRESETS } from "./jewellery";
import type { Preset } from "./types";

export type { Preset, ShotTemplate, VocabAxis, VocabEntry, Vocabulary } from "./types";
export { VOCAB_AXES } from "./types";

/** Every version of every preset. When a preset changes, ADD the new version here; never remove old ones. */
export const ALL_PRESETS: readonly Preset[] = [...JEWELLERY_PRESETS, ...CLOTHING_PRESETS];

/** The latest version of the preset for a category and family. */
export function getPreset(category: CategoryKey, family: Family): Preset {
  const found = latest(ALL_PRESETS.filter((p) => p.category === category && p.family === family));
  if (!found) throw new Error(`No shot preset for ${category}/${family}`);
  return found;
}

/** An exact stored version (so old ShotSpecs can still be rendered). */
export function getPresetVersion(id: string, version: number): Preset | undefined {
  return ALL_PRESETS.find((p) => p.id === id && p.version === version);
}

/** The latest version of a preset by id. */
export function getLatestPresetById(id: string): Preset | undefined {
  return latest(ALL_PRESETS.filter((p) => p.id === id));
}

function latest(list: readonly Preset[]): Preset | undefined {
  return list.reduce<Preset | undefined>((best, p) => (!best || p.version > best.version ? p : best), undefined);
}
