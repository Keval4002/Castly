import { NextResponse } from "next/server";
import { z } from "zod";
import { api, HttpError } from "@/lib/api";
import { requireProfile } from "@/lib/auth/session";
import { removeProductPhoto, ProductPhotoError } from "@/lib/product-photos";

export const dynamic = "force-dynamic";

export const DELETE = api(async (_req, ctx: { params: Promise<{ id: string; photoId: string }> }) => {
  const profile = await requireProfile();
  const { id, photoId } = await ctx.params;
  const uuid = z.string().uuid();
  if (!uuid.safeParse(id).success || !uuid.safeParse(photoId).success) {
    throw new HttpError(404, "Photo not found", "not_found");
  }
  try {
    await removeProductPhoto(profile.id, id, photoId);
  } catch (err) {
    if (err instanceof ProductPhotoError) throw new HttpError(err.status, err.message, err.code);
    throw err;
  }
  return NextResponse.json({ ok: true });
});
