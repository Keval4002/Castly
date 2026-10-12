import type { Metadata } from "next";
import { requireProfile } from "@/lib/auth/session";
import { listGenerations } from "@/lib/generation/service";
import { isTierAvailable } from "@/lib/image/router";
import { TIER_ORDER, type TierId } from "@/lib/pricing";
import { StudioClient } from "./StudioClient";

export const metadata: Metadata = { title: "Studio" };

export default async function StudioPage() {
  const profile = await requireProfile();
  const recent = await listGenerations(profile.id, 6);
  const tiers = Object.fromEntries(TIER_ORDER.map((t) => [t, isTierAvailable(t)])) as Record<TierId, boolean>;
  return <StudioClient tierAvailability={tiers} initial={recent} />;
}
