import { requireProfile } from "@/lib/auth/session";
import { api, rateLimit } from "@/lib/api";
import { exportCatalogue } from "@/lib/products";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** GET /api/products/export?ids=a,b — ZIP of images + catalogue.csv (all products when ids is omitted). */
export const GET = api(async (req) => {
  const profile = await requireProfile();
  rateLimit(`export:${profile.id}`, 6, 60_000);
  const ids = new URL(req.url).searchParams.get("ids");
  const list = ids ? ids.split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200) : undefined;
  const zip = await exportCatalogue(profile.id, list);
  return new Response(new Uint8Array(zip), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": 'attachment; filename="dukaanshot-catalogue.zip"',
      "cache-control": "private, no-store",
    },
  });
});
