import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import { env } from "@/lib/env";

/** Emergency stop for paid image generation. */
export const GENERATION_PAUSED_KEY = "generation_paused";
export const DEFAULT_PAUSE_MESSAGE = "Image generation is paused for a short while. Please try again soon — you haven't been charged.";

export interface PauseState {
  paused: boolean;
  message: string;
}

interface PausedValue {
  paused?: boolean;
  message?: string;
}

// A short cache keeps this off the hot path; a flip takes effect within seconds on every instance.
const CACHE_MS = 5_000;
let cache: { at: number; state: PauseState } | null = null;

export function resetSwitchCache() {
  cache = null;
}

/**
 * Paused when GENERATION_PAUSED=true (needs a restart/redeploy) or when the `generation_paused`
 * row in app_settings says so (instant; see scripts/kill-switch.ts). If the database can't be read
 * the switch is treated as off, so an outage of the settings table never blocks paying users.
 */
export async function generationPause(): Promise<PauseState> {
  if (env().GENERATION_PAUSED) return { paused: true, message: DEFAULT_PAUSE_MESSAGE };
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.state;
  let state: PauseState = { paused: false, message: DEFAULT_PAUSE_MESSAGE };
  try {
    const [row] = await db().select().from(appSettings).where(eq(appSettings.key, GENERATION_PAUSED_KEY));
    const v = row?.value as PausedValue | undefined;
    if (v?.paused) state = { paused: true, message: v.message?.trim() || DEFAULT_PAUSE_MESSAGE };
  } catch (err) {
    console.error("[switches] could not read generation_paused:", (err as Error).message);
  }
  cache = { at: Date.now(), state };
  return state;
}
