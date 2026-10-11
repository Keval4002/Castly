import { NextResponse } from "next/server";
import { api, HttpError, rateLimit } from "@/lib/api";
import { saveAsset, signAssets } from "@/lib/assets";
import { requireProfile } from "@/lib/auth/session";
import { normalizeUpload } from "@/lib/image/process";

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
  const asset = await saveAsset(profile.id, "upload", processed, "uploads");
  const urls = (await signAssets([asset.id])).get(asset.id)!;
  return NextResponse.json({ asset: { id: asset.id, ...urls } }, { status: 201 });
});
