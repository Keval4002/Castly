import { after, NextResponse } from "next/server";
import { api, rateLimit } from "@/lib/api";
import { requireProfile } from "@/lib/auth/session";
import { createGenerationSchema } from "@/lib/catalog/request";
import { getBalance } from "@/lib/credits";
import { createGeneration, getGeneration, listGenerations, runGeneration } from "@/lib/generation/service";

export const dynamic = "force-dynamic";
// The background job runs inside this function's lifetime (via after()).
export const maxDuration = 300;

export const POST = api(async (req) => {
  const profile = await requireProfile();
  rateLimit(`generate:${profile.id}`, 20, 60_000);

  const input = createGenerationSchema.parse(await req.json());
  const gen = await createGeneration(profile.id, input);
  after(() => runGeneration(gen.id));

  const [dto, balance] = await Promise.all([getGeneration(profile.id, gen.id), getBalance(profile.id)]);
  return NextResponse.json({ generation: dto, balance }, { status: 202 });
});

export const GET = api(async (req) => {
  const profile = await requireProfile();
  const beforeParam = new URL(req.url).searchParams.get("before");
  const before = beforeParam ? new Date(beforeParam) : undefined;
  const items = await listGenerations(profile.id, 24, before && !isNaN(before.getTime()) ? before : undefined);
  return NextResponse.json({ generations: items });
});
