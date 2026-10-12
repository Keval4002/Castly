import "server-only";
import { env } from "@/lib/env";
import type { TierId } from "@/lib/pricing";
import { falKontext, falSeedream, geminiImage, openaiImage } from "./providers/aisdk";
import { finishProviderCall, startProviderCall } from "./calls";
import { estimateImageCostMicros } from "./costs";
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

export function providersFor(tier: TierId, attempt = 1): ImageProvider[] {
  const mode = env().IMAGE_PROVIDER_MODE;
  if (mode === "mock") return [mockImage];
  // A Premium retry is an automatic second chance, not a second premium charge: it runs on the Studio chain.
  const chainTier: TierId = tier === "premium" && attempt > 1 ? "standard" : tier;
  const chain = mode === "free" ? FREE_CHAIN : TIER_CHAINS[chainTier];
  return chain.filter((p) => p.available());
}

export class NoProviderError extends Error {}

export interface RoutedResult extends ImageResult {
  provider: string;
  attempts: { provider: string; error: string }[];
}

export interface RouteOptions {
  /**
   * Asked before each provider call (including fallbacks); false stops the chain without calling the provider.
   * Used for spend caps, so a shot that has used its budget never pays another vendor.
   */
  allow?: (providerId: string, estCostMicros: number) => Promise<boolean> | boolean;
}

export class BudgetStopError extends Error {}

export async function generateWithFallback(tier: TierId, req: ImageRequest, opts: RouteOptions = {}): Promise<RoutedResult> {
  const chain = providersFor(tier, req.ctx?.attempt ?? 1);
  if (chain.length === 0) throw new NoProviderError(`No image provider configured for tier "${tier}"`);

  const attempts: { provider: string; error: string }[] = [];
  for (const provider of chain) {
    const est = estimateImageCostMicros(provider.id);
    if (opts.allow && !(await opts.allow(provider.id, est))) {
      attempts.push({ provider: provider.id, error: "cost budget reached" });
      throw Object.assign(new BudgetStopError(`Cost budget reached before calling ${provider.id}`), { attempts });
    }
    const t0 = Date.now();
    // Recorded before the call: a worker that dies mid-call has still (probably) been billed.
    const callId = await startProviderCall({ stage: "generate", provider: provider.id, model: provider.model, estCostMicros: est, ctx: req.ctx });
    try {
      const result = await provider.generate(req);
      await finishProviderCall(callId, {
        ok: true,
        model: result.model,
        latencyMs: Date.now() - t0,
        actualCostMicros: result.actualCostMicros,
      });
      return { ...result, provider: provider.id, attempts };
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      attempts.push({ provider: provider.id, error: message });
      // A failed call may still be billed (timeouts, content refusals), so the estimate stays on the row.
      await finishProviderCall(callId, { ok: false, error: message, latencyMs: Date.now() - t0 });
      console.warn(`[image] ${provider.id} failed (variant ${req.variant}): ${message}`);
    }
  }
  const error = new Error(`All providers failed: ${attempts.map((a) => `${a.provider}: ${a.error}`).join(" | ")}`);
  throw Object.assign(error, { attempts });
}

export function isTierAvailable(tier: TierId): boolean {
  return providersFor(tier).length > 0;
}
