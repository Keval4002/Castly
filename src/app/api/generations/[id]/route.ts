import { NextResponse } from "next/server";
import { api, HttpError } from "@/lib/api";
import { requireProfile } from "@/lib/auth/session";
import { getBalance } from "@/lib/credits";
import { getGeneration } from "@/lib/generation/service";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = api(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const profile = await requireProfile();
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) throw new HttpError(404, "Not found", "not_found");
  const gen = await getGeneration(profile.id, id);
  if (!gen) throw new HttpError(404, "Not found", "not_found");
  const done = !["queued", "running"].includes(gen.status);
  return NextResponse.json(
    { generation: gen, balance: done ? await getBalance(profile.id) : undefined },
    { headers: { "cache-control": "no-store" } },
  );
});
