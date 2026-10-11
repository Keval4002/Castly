import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { assets, type Asset } from "@/lib/db/schema";
import type { ProcessedImage } from "@/lib/image/process";
import { storage } from "@/lib/storage";

export async function saveAsset(
  userId: string,
  kind: "upload" | "output",
  img: ProcessedImage,
  folder: string,
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
