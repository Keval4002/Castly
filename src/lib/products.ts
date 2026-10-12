import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { zipSync, strToU8 } from "fflate";
import { signAssets } from "@/lib/assets";
import type { CategoryId } from "@/lib/catalog/options";
import { LOOKS } from "@/lib/catalog/simple";
import { db } from "@/lib/db";
import { assets, generationImages, generations, productPhotos, products, type Asset, type Product } from "@/lib/db/schema";
import { storage } from "@/lib/storage";

export interface ProductDTO {
  id: string;
  name: string;
  sku: string | null;
  category: CategoryId;
  productType: string | null;
  createdAt: string;
  /** Original photo thumbnail. */
  thumbUrl: string | null;
  /** Newest generated image thumbnail, if any. */
  latestUrl: string | null;
  imageCount: number;
  status: "new" | "generating" | "ready";
}

export function nameFromFile(filename: string | undefined): string {
  const base = (filename ?? "").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return (base || "New product").slice(0, 80);
}

/** One catalogue product per uploaded photo (idempotent). */
export async function ensureProductForAsset(userId: string, asset: Asset, name: string): Promise<Product> {
  const cls = asset.classification;
  const category: CategoryId = cls && cls.category !== "other" ? cls.category : "clothing";
  await db()
    .insert(products)
    .values({ userId, name, category, productType: cls?.productType ?? null, sourceAssetId: asset.id })
    .onConflictDoNothing();
  const [row] = await db().select().from(products).where(eq(products.sourceAssetId, asset.id));
  await db().insert(productPhotos).values({ productId: row.id, assetId: asset.id, angle: "front" }).onConflictDoNothing();
  return row;
}

export async function listProducts(userId: string, productIds?: string[]): Promise<ProductDTO[]> {
  const d = db();
  const rows = await d
    .select()
    .from(products)
    .where(and(eq(products.userId, userId), productIds ? inArray(products.id, productIds) : undefined))
    .orderBy(desc(products.createdAt));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [active, counts, latest] = await Promise.all([
    d
      .selectDistinct({ productId: generations.productId })
      .from(generations)
      .where(and(inArray(generations.productId, ids), inArray(generations.status, ["queued", "running"]))),
    d
      .select({ productId: generations.productId, n: sql<number>`count(*)::int` })
      .from(generationImages)
      .innerJoin(generations, eq(generations.id, generationImages.generationId))
      .where(and(inArray(generations.productId, ids), eq(generationImages.status, "succeeded")))
      .groupBy(generations.productId),
    d
      .selectDistinctOn([generations.productId], { productId: generations.productId, assetId: generationImages.assetId })
      .from(generationImages)
      .innerJoin(generations, eq(generations.id, generationImages.generationId))
      .where(and(inArray(generations.productId, ids), eq(generationImages.status, "succeeded")))
      .orderBy(generations.productId, desc(generationImages.createdAt)),
  ]);
  const activeSet = new Set(active.map((a) => a.productId));
  const countMap = new Map(counts.map((c) => [c.productId, c.n]));
  const latestMap = new Map(latest.map((l) => [l.productId, l.assetId]));
  const urls = await signAssets([...rows.map((r) => r.sourceAssetId), ...[...latestMap.values()].filter((x): x is string => !!x)]);

  return rows.map((r) => {
    const imageCount = countMap.get(r.id) ?? 0;
    const latestAsset = latestMap.get(r.id);
    return {
      id: r.id,
      name: r.name,
      sku: r.sku,
      category: r.category as CategoryId,
      productType: r.productType,
      createdAt: r.createdAt.toISOString(),
      thumbUrl: urls.get(r.sourceAssetId)?.thumbUrl ?? null,
      latestUrl: (latestAsset && urls.get(latestAsset)?.thumbUrl) || null,
      imageCount,
      status: activeSet.has(r.id) ? "generating" : imageCount > 0 ? "ready" : "new",
    };
  });
}

export async function getOwnedProduct(userId: string, id: string): Promise<Product | null> {
  const [row] = await db()
    .select()
    .from(products)
    .where(and(eq(products.id, id), eq(products.userId, userId)));
  return row ?? null;
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "product";
}

function csvCell(v: string | number | null) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** ZIP of every delivered image for the given products, plus a catalogue.csv manifest. */
export async function exportCatalogue(userId: string, productIds: string[] | undefined): Promise<Uint8Array> {
  const d = db();
  const rows = await d
    .select()
    .from(products)
    .where(and(eq(products.userId, userId), productIds?.length ? inArray(products.id, productIds) : undefined))
    .orderBy(products.createdAt);
  const files: Record<string, Uint8Array> = {};
  const manifest: string[] = ["product,sku,category,type,look,size,file"];
  const used = new Set<string>();

  for (const p of rows) {
    const imgs = await d
      .select({ idx: generationImages.idx, key: assets.storageKey, look: generations.look, ar: generations.aspectRatio, gid: generations.id })
      .from(generationImages)
      .innerJoin(generations, eq(generations.id, generationImages.generationId))
      .innerJoin(assets, eq(assets.id, generationImages.assetId))
      .where(and(eq(generations.productId, p.id), eq(generationImages.status, "succeeded")))
      .orderBy(generations.createdAt, generationImages.idx);
    let n = 0;
    for (const img of imgs) {
      let filename = `${slug(p.sku || p.name)}_${img.look ?? "photo"}_${++n}.jpg`;
      while (used.has(filename)) filename = `${slug(p.id)}_${filename}`;
      used.add(filename);
      files[filename] = new Uint8Array(await storage().get(img.key));
      const lookLabel = LOOKS[p.category as CategoryId]?.find((l) => l.id === img.look)?.label ?? img.look ?? "";
      manifest.push([p.name, p.sku, p.category, p.productType, lookLabel, img.ar, filename].map(csvCell).join(","));
    }
  }
  files["catalogue.csv"] = strToU8(manifest.join("\n") + "\n");
  // JPEGs are already compressed.
  return zipSync(files, { level: 0 });
}
