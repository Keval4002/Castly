import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { assets, productPhotos, products, type ProductPhoto } from "@/lib/db/schema";

export const PHOTO_ANGLES = ["front", "back", "side", "detail", "other"] as const;
export const photoAngleSchema = z.enum(PHOTO_ANGLES);
export type PhotoAngle = z.infer<typeof photoAngleSchema>;

/**
 * Angle rules:
 *  - The product's main photo (products.sourceAssetId) is always its 'front' photo; it can't be removed or replaced.
 *  - 'back', 'side' and 'detail' are single-slot: adding one when that angle already exists replaces the old
 *    attachment (the product_photos row is deleted; the asset itself is kept).
 *  - 'front' (extra fronts) and 'other' may have many photos.
 */
const SINGLE_SLOT: ReadonlySet<PhotoAngle> = new Set(["back", "side", "detail"]);

export class ProductPhotoError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const ORDER = new Map(PHOTO_ANGLES.map((a, i) => [a as string, i]));

/** Attach an uploaded asset to a product with an angle. Throws ProductPhotoError (404/409) on ownership or reuse problems. */
export async function addProductPhoto(
  userId: string,
  productId: string,
  assetId: string,
  angle: PhotoAngle,
): Promise<ProductPhoto> {
  photoAngleSchema.parse(angle);
  const d = db();
  const [product] = await d
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.userId, userId)));
  if (!product) throw new ProductPhotoError(404, "not_found", "Product not found");
  const [asset] = await d
    .select()
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.userId, userId), eq(assets.kind, "upload")));
  if (!asset) throw new ProductPhotoError(404, "not_found", "Photo not found");

  const [usedAsSource] = await d.select({ id: products.id }).from(products).where(eq(products.sourceAssetId, assetId));
  const [usedAsPhoto] = await d.select({ id: productPhotos.id }).from(productPhotos).where(eq(productPhotos.assetId, assetId));
  if (usedAsSource || usedAsPhoto) {
    throw new ProductPhotoError(409, "photo_in_use", "That photo is already attached to a product");
  }

  if (SINGLE_SLOT.has(angle)) {
    await d
      .delete(productPhotos)
      .where(and(eq(productPhotos.productId, productId), eq(productPhotos.angle, angle)));
  }
  const [row] = await d.insert(productPhotos).values({ productId, assetId, angle }).returning();
  return row;
}

/** Photos of a product (front first, then back, side, detail, other; oldest first within an angle). */
export async function listProductPhotos(userId: string, productId: string): Promise<ProductPhoto[]> {
  const rows = await db()
    .select({ photo: productPhotos })
    .from(productPhotos)
    .innerJoin(products, eq(products.id, productPhotos.productId))
    .where(and(eq(productPhotos.productId, productId), eq(products.userId, userId)))
    .orderBy(asc(productPhotos.createdAt));
  return rows
    .map((r) => r.photo)
    .sort((a, b) => (ORDER.get(a.angle) ?? 99) - (ORDER.get(b.angle) ?? 99));
}

/** Detach a photo (the asset is kept). The main source photo can't be removed. */
export async function removeProductPhoto(userId: string, productId: string, photoId: string): Promise<void> {
  const d = db();
  const [row] = await d
    .select({ photo: productPhotos, sourceAssetId: products.sourceAssetId })
    .from(productPhotos)
    .innerJoin(products, eq(products.id, productPhotos.productId))
    .where(and(eq(productPhotos.id, photoId), eq(productPhotos.productId, productId), eq(products.userId, userId)));
  if (!row) throw new ProductPhotoError(404, "not_found", "Photo not found");
  if (row.photo.assetId === row.sourceAssetId) {
    throw new ProductPhotoError(400, "main_photo", "The main photo can't be removed");
  }
  await d.delete(productPhotos).where(eq(productPhotos.id, photoId));
}

/**
 * Which angles the seller has supplied for a product. Phase 2's shot planner calls this to enable or
 * skip shots that need unseen information (e.g. a clothing back view needs 'back', a fabric macro needs 'detail').
 * The main photo counts as 'front' even if its product_photos row is missing (pre-backfill products).
 */
export async function availableAngles(productId: string): Promise<Set<PhotoAngle>> {
  const d = db();
  const rows = await d.select({ angle: productPhotos.angle }).from(productPhotos).where(eq(productPhotos.productId, productId));
  const out = new Set<PhotoAngle>();
  for (const r of rows) {
    const p = photoAngleSchema.safeParse(r.angle);
    if (p.success) out.add(p.data);
  }
  const [prod] = await d.select({ id: products.id }).from(products).where(eq(products.id, productId));
  if (prod) out.add("front");
  return out;
}

/** Plain-language reason a shot is skipped for lack of a photo angle, or null if the angle needs no extra photo. */
export function missingAngleHint(angle: PhotoAngle): string | null {
  if (angle === "back") return "A back view needs a back photo — add one to enable it.";
  if (angle === "detail") return "A close-up of fabric or finish needs a detail photo — add one to enable it.";
  if (angle === "side") return "A side view needs a side photo — add one to enable it.";
  return null;
}

