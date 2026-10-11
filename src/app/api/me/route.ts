import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { requireProfile } from "@/lib/auth/session";
import { isTierAvailable } from "@/lib/image/router";
import { TIER_ORDER } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export const GET = api(async () => {
  const p = await requireProfile();
  return NextResponse.json({
    profile: { id: p.id, email: p.email, name: p.name, credits: p.credits },
    tiers: Object.fromEntries(TIER_ORDER.map((t) => [t, isTierAvailable(t)])),
  });
});
