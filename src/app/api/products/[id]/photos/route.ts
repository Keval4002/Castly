import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { api, HttpError, rateLimit } from "@/lib/api";
import { saveAsset, uploadDTO } from "@/lib/assets";
import { requireProfile } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { assets, products } from "@/lib/db/schema";
import { normalizeUpload } from "@/lib/image/process";
import { addProductPhoto, listProductPhotos, photoAngleSchema, ProductPhotoError } from "@/lib/product-photos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 8 * 1024 * 1024;
type Ctx = { params: Promise<{ id: string }> };

async function ownedProductOr404(userId: string, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new HttpError(404, "Product not found", "not_found");
  const [row] = await db()
    .select({ id: products.id, sourceAssetId: products.sourceAssetId })
    .from(products)
    .where(and(eq(products.id, id), eq(products.userId, userId)));
  if (!row) throw new HttpError(404, "Product not found", "not_found");
  return row;
}

async function photoDTOs(userId: string, product: { id: string; sourceAssetId: string }) {
  const photos = await listProductPhotos(userId, product.id);
  const rows = photos.length
    ? await db().select().from(assets).where(and(eq(assets.userId, userId), inArray(assets.id, photos.map((p) => p.assetId))))
    : [];
  const byId = new Map(rows.map((a) => [a.id, a]));
  return Promise.all(
    photos.map(async (p) => {
      const asset = byId.get(p.assetId);
      return {
        id: p.id,
        angle: p.angle,
        isMain: p.assetId === product.sourceAssetId,
        asset: asset ? await uploadDTO(asset) : null,
      };
    }),
  );
}

export const GET = api(async (_req, ctx: Ctx) => {
  const profile = await requireProfile();
  const product = await ownedProductOr404(profile.id, (await ctx.params).id);
  return NextResponse.json({ photos: await photoDTOs(profile.id, product) });
});

export const POST = api(async (req, ctx: Ctx) => {
  const profile = await requireProfile();
  const product = await ownedProductOr404(profile.id, (await ctx.params).id);
  rateLimit(`upload:${profile.id}`, 30, 60_000);

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Attach a product photo as 'file'", "invalid_request");
  if (file.size > MAX_BYTES) throw new HttpError(413, "Image is larger than 8 MB", "too_large");
  const angle = photoAngleSchema.parse(form?.get("angle") ?? "other");

  const processed = await normalizeUpload(Buffer.from(await file.arrayBuffer()));
  const asset = await saveAsset(profile.id, "upload", processed, "uploads");
  try {
    const photo = await addProductPhoto(profile.id, product.id, asset.id, angle);
    return NextResponse.json(
      { photo: { id: photo.id, angle: photo.angle, isMain: false, asset: await uploadDTO(asset) } },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof ProductPhotoError) throw new HttpError(err.status, err.message, err.code);
    throw err;
  }
});
