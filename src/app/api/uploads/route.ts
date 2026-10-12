import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { api, HttpError, rateLimit } from "@/lib/api";
import { saveAsset, signAssets } from "@/lib/assets";
import { requireProfile } from "@/lib/auth/session";
import { classifyProduct } from "@/lib/classify/classifier";
import { db } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import { llmPreview, normalizeUpload } from "@/lib/image/process";

export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;

export const POST = api(async (req) => {
  const profile = await requireProfile();
  rateLimit(`upload:${profile.id}`, 30, 60_000);

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Attach a product photo as 'file'", "invalid_request");
  if (file.size > MAX_BYTES) throw new HttpError(413, "Image is larger than 8 MB", "too_large");

  const processed = await normalizeUpload(Buffer.from(await file.arrayBuffer()));
  // Classify while the image is being stored — detection adds no extra latency.
  const [asset, classification] = await Promise.all([
    saveAsset(profile.id, "upload", processed, "uploads"),
    llmPreview(processed.data)
      .then(classifyProduct)
      .catch((err) => {
        console.warn("[upload] classification failed", err);
        return null;
      }),
  ]);
  if (classification) await db().update(assets).set({ classification }).where(eq(assets.id, asset.id));

  const urls = (await signAssets([asset.id])).get(asset.id)!;
  return NextResponse.json({ asset: { id: asset.id, ...urls, classification } }, { status: 201 });
});
