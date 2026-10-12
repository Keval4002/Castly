import { NextResponse } from "next/server";
import { api, HttpError } from "@/lib/api";
import { getOwnedAsset, uploadDTO } from "@/lib/assets";
import { requireProfile } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Upload status — the studio polls this while the photo is being cleaned. */
export const GET = api(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const profile = await requireProfile();
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) throw new HttpError(404, "Not found", "not_found");
  const asset = await getOwnedAsset(profile.id, id);
  if (!asset || asset.kind !== "upload") throw new HttpError(404, "Not found", "not_found");
  return NextResponse.json({ asset: await uploadDTO(asset) }, { headers: { "cache-control": "no-store" } });
});
