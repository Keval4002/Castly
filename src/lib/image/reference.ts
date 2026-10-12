import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { assets, type Asset } from "@/lib/db/schema";
import { storage } from "@/lib/storage";
import type { ReferenceView } from "@/lib/shots/types";
import { prepareProduct } from "./prepare";
import { computeProductProfile } from "./profile";
import { buildShotReference } from "./views";
import type { Preparation } from "./quality";

/** A cleaning job that hasn't finished by now is considered dead. */
const PREPARATION_STALE_MS = 3 * 60 * 1000;
/**
 * How long a generation waits for an in-flight cleaning job. Sellers usually
 * spend longer choosing settings; if not, the untouched upload is used so
 * latency never balloons (the product is identical either way).
 */
const REFERENCE_WAIT_MS = 6_000;

export function pendingPreparation(): Preparation {
  return { status: "pending", startedAt: new Date().toISOString() };
}

/** Clean an uploaded product photo. Runs after the upload response (via after()). Never throws. */
export async function runPreparation(assetId: string): Promise<void> {
  const d = db();
  const [asset] = await d.select().from(assets).where(eq(assets.id, assetId));
  if (!asset || asset.kind !== "upload") return;
  const started = Date.now();
  const startedAt = asset.preparation?.startedAt ?? new Date().toISOString();
  try {
    const original = await storage().get(asset.storageKey);
    const prepared = await prepareProduct(original);
    const base = asset.storageKey.replace(/\.jpg$/, "");
    const cleanKey = `${base}_clean.jpg`;
    const cleanThumbKey = `${base}_clean_t.webp`;
    await Promise.all([
      storage().put(cleanKey, prepared.clean.data, prepared.clean.mime),
      storage().put(cleanThumbKey, prepared.clean.thumb, "image/webp"),
    ]);
    const preparation: Preparation = {
      status: "ready",
      method: prepared.method,
      coverage: prepared.coverage,
      repairedPixels: prepared.repairedPixels,
      ms: Date.now() - started,
      startedAt,
    };
    // Transparent cut-out + measured profile power per-shot reference views. Never fatal.
    let cutoutKey: string | null = null;
    if (prepared.cutout) {
      try {
        const key = `${base}_cutout.png`;
        await storage().put(key, prepared.cutout.data, "image/png");
        cutoutKey = key;
      } catch (err) {
        console.warn(`[prepare] ${asset.id} cut-out not stored: ${(err as Error).message}`);
      }
    }
    let profile: Awaited<ReturnType<typeof computeProductProfile>> | null = null;
    try {
      profile = await computeProductProfile({
        cutoutPng: prepared.cutout?.data,
        fallbackImage: prepared.cutout ? undefined : prepared.clean.data,
        classification: asset.classification,
      });
    } catch (err) {
      console.warn(`[prepare] ${asset.id} profile failed: ${(err as Error).message}`);
    }
    await d
      .update(assets)
      .set({ cleanKey, cleanThumbKey, preparation, ...(cutoutKey ? { cutoutKey } : {}), ...(profile ? { profile } : {}) })
      .where(eq(assets.id, asset.id));
    console.info(`[prepare] ${asset.id} ${prepared.method} in ${preparation.ms}ms (repaired ${prepared.repairedPixels}px)`);
  } catch (err) {
    console.error(`[prepare] ${asset.id} failed:`, (err as Error).message);
    const preparation: Preparation = { status: "failed", error: "Cleaning failed", ms: Date.now() - started, startedAt };
    await d.update(assets).set({ preparation }).where(eq(assets.id, asset.id));
  }
}

export function preparationState(asset: Pick<Asset, "preparation">): Preparation["status"] | "none" {
  const p = asset.preparation;
  if (!p) return "none";
  if (p.status === "pending" && Date.now() - new Date(p.startedAt).getTime() > PREPARATION_STALE_MS) return "failed";
  return p.status;
}

/**
 * The product reference for image models: the cleaned photo when ready,
 * otherwise the original upload (waiting briefly for an in-flight job).
 */
export async function productReference(asset: Asset): Promise<{ data: Buffer; mime: string; cleaned: boolean }> {
  const current = await settledAsset(asset);
  if (preparationState(current) === "ready" && current.cleanKey) {
    return { data: await storage().get(current.cleanKey), mime: "image/jpeg", cleaned: true };
  }
  return { data: await storage().get(asset.storageKey), mime: asset.mime, cleaned: false };
}

/**
 * A reference for ONE shot: the product's cut-out presented in that shot's own view (position, scale,
 * tilt, detail crop) on the output aspect. Falls back to the shared cleaned reference without a cut-out.
 */
export async function shotReferenceFor(
  asset: Asset,
  opts: { view: ReferenceView; tiltDeg?: number; aspect: { width: number; height: number } },
): Promise<{ data: Buffer; mime: string; small?: Buffer; cleaned: boolean; varied: boolean; detailLoss?: boolean }> {
  const current = await settledAsset(asset);
  if (current.cutoutKey && preparationState(current) === "ready") {
    try {
      const r = await buildShotReference({
        cutout: await storage().get(current.cutoutKey),
        view: opts.view,
        tiltDeg: opts.tiltDeg,
        aspect: opts.aspect,
      });
      return { data: r.data, mime: r.mime, small: r.small, cleaned: true, varied: true, detailLoss: r.detailLoss };
    } catch (err) {
      console.warn(`[reference] ${asset.id} view ${opts.view} failed, using shared reference: ${(err as Error).message}`);
    }
  }
  return { ...(await productReference(current)), varied: false };
}

/** Waits (briefly) for an in-flight preparation and returns the freshest row. */
async function settledAsset(asset: Asset): Promise<Asset> {
  let current = asset;
  const deadline = Date.now() + REFERENCE_WAIT_MS;
  while (preparationState(current) === "pending" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    const [row] = await db().select().from(assets).where(eq(assets.id, asset.id));
    if (!row) break;
    current = row;
  }
  return current;
}
