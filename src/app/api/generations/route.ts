import { after, NextResponse } from "next/server";
import { api, idempotencyKeyFrom, rateLimit } from "@/lib/api";
import { requireProfile } from "@/lib/auth/session";
import { simpleGenerationSchema, toCreateInput } from "@/lib/catalog/request";
import { getBalance } from "@/lib/credits";
import { createGeneration, getGeneration, listGenerations, runGeneration } from "@/lib/generation/service";

export const dynamic = "force-dynamic";
// The background job runs inside this function's lifetime (via after()).
export const maxDuration = 300;

export const POST = api(async (req) => {
  const profile = await requireProfile();
  rateLimit(`generate:${profile.id}`, 20, 60_000);

  const input = simpleGenerationSchema.parse(await req.json());
  const gen = await createGeneration(profile.id, toCreateInput(input), {
    look: input.look,
    idempotencyKey: idempotencyKeyFrom(req),
  });
  after(() => runGeneration(gen.id));

  const [dto, balance] = await Promise.all([getGeneration(profile.id, gen.id), getBalance(profile.id)]);
  return NextResponse.json({ generation: dto, balance }, { status: 202 });
});

export const GET = api(async (req) => {
  const profile = await requireProfile();
  const beforeParam = new URL(req.url).searchParams.get("before");
  const before = beforeParam ? new Date(beforeParam) : undefined;
  const productId = new URL(req.url).searchParams.get("product") ?? undefined;
  const items = await listGenerations(
    profile.id,
    24,
    before && !isNaN(before.getTime()) ? before : undefined,
    productId && /^[0-9a-f-]{36}$/i.test(productId) ? productId : undefined,
  );
  return NextResponse.json({ generations: items });
});
