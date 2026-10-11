import "server-only";
import { env } from "@/lib/env";
import type { TierId } from "@/lib/pricing";
import { falKontext, falSeedream, geminiImage, openaiImage } from "./providers/aisdk";
import { cloudflareFlux } from "./providers/cloudflare";
import { mockImage } from "./providers/mock";
import type { ImageProvider, ImageRequest, ImageResult } from "./types";

/**
 * Provider preference per quality tier (IMAGE_PROVIDER_MODE=live). The first
 * available provider is used; on failure we fall through to the next so one
 * vendor outage never blocks a catalogue run.
 */
export const TIER_CHAINS: Record<TierId, ImageProvider[]> = {
  // Cheapest per image; good product retention for bulk drafts.
  economy: [falSeedream, geminiImage, falKontext],
  // Best accuracy/latency/cost balance.
  standard: [geminiImage, falKontext, falSeedream],
  // Highest fidelity; slower and pricier.
  premium: [openaiImage, geminiImage, falKontext],
};

/**
 * IMAGE_PROVIDER_MODE=free: zero-cost models for testing. Every tier uses the
 * same chain — Cloudflare's free FLUX.2 allocation first, then Gemini (which
 * works on a free-tier key when Google grants image quota).
 */
export const FREE_CHAIN: ImageProvider[] = [cloudflareFlux, geminiImage];

export function providersFor(tier: TierId): ImageProvider[] {
  const mode = env().IMAGE_PROVIDER_MODE;
  if (mode === "mock") return [mockImage];
  const chain = mode === "free" ? FREE_CHAIN : TIER_CHAINS[tier];
  return chain.filter((p) => p.available());
}

export class NoProviderError extends Error {}

export interface RoutedResult extends ImageResult {
  provider: string;
  attempts: { provider: string; error: string }[];
}

export async function generateWithFallback(tier: TierId, req: ImageRequest): Promise<RoutedResult> {
  const chain = providersFor(tier);
  if (chain.length === 0) throw new NoProviderError(`No image provider configured for tier "${tier}"`);

  const attempts: { provider: string; error: string }[] = [];
  for (const provider of chain) {
    try {
      const result = await provider.generate(req);
      return { ...result, provider: provider.id, attempts };
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      attempts.push({ provider: provider.id, error: message });
      console.warn(`[image] ${provider.id} failed (variant ${req.variant}): ${message}`);
    }
  }
  const error = new Error(`All providers failed: ${attempts.map((a) => `${a.provider}: ${a.error}`).join(" | ")}`);
  throw Object.assign(error, { attempts });
}

export function isTierAvailable(tier: TierId): boolean {
  return providersFor(tier).length > 0;
}
