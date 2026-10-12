import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { assets, type Asset } from "@/lib/db/schema";
import type { ProcessedImage } from "@/lib/image/process";
import type { Preparation } from "@/lib/image/quality";
import { preparationState } from "@/lib/image/reference";
import { storage } from "@/lib/storage";

export async function saveAsset(
  userId: string,
  kind: "upload" | "output",
  img: ProcessedImage,
  folder: string,
  extra: Pick<Partial<Asset>, "preparation"> = {},
): Promise<Asset> {
  const id = randomUUID();
  const base = `u/${userId}/${folder}/${id}`;
  const storageKey = `${base}.jpg`;
  const thumbKey = `${base}_t.webp`;
  await Promise.all([
    storage().put(storageKey, img.data, img.mime),
    storage().put(thumbKey, img.thumb, "image/webp"),
  ]);
  const [row] = await db()
    .insert(assets)
    .values({
      id,
      userId,
      kind,
      storageKey,
      thumbKey,
      mime: img.mime,
      width: img.width,
      height: img.height,
      bytes: img.data.length,
      ...extra,
    })
    .returning();
  return row;
}

export async function getOwnedAsset(userId: string, id: string): Promise<Asset | null> {
  const [row] = await db()
    .select()
    .from(assets)
    .where(and(eq(assets.id, id), eq(assets.userId, userId)));
  return row ?? null;
}

export interface AssetUrls {
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
}

/** Batch-sign URLs for many assets in one storage round-trip. */
export async function signAssets(ids: string[]): Promise<Map<string, AssetUrls>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db().select().from(assets).where(inArray(assets.id, unique));
  const keys = rows.flatMap((r) => [r.storageKey, r.thumbKey ?? r.storageKey]);
  const urls = await storage().signedUrls(keys);
  const out = new Map<string, AssetUrls>();
  rows.forEach((r, i) => {
    out.set(r.id, { url: urls[i * 2], thumbUrl: urls[i * 2 + 1], width: r.width, height: r.height });
  });
  return out;
}

export interface UploadDTO extends AssetUrls {
  id: string;
  classification: Asset["classification"];
  preparation: { status: Preparation["status"] | "none"; method: Preparation["method"] | null };
  /** The cleaned product photo once ready. */
  clean: { url: string; thumbUrl: string } | null;
}

export async function uploadDTO(asset: Asset): Promise<UploadDTO> {
  const status = preparationState(asset);
  const cleanReady = status === "ready" && asset.cleanKey && asset.cleanThumbKey;
  const [urls, clean] = await Promise.all([
    signAssets([asset.id]).then((m) => m.get(asset.id)!),
    cleanReady ? storage().signedUrls([asset.cleanKey!, asset.cleanThumbKey!]) : null,
  ]);
  return {
    id: asset.id,
    ...urls,
    classification: asset.classification,
    preparation: { status, method: asset.preparation?.method ?? null },
    clean: clean ? { url: clean[0], thumbUrl: clean[1] } : null,
  };
}
