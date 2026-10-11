import type { Metadata } from "next";
import { requireProfile } from "@/lib/auth/session";
import { listLedger } from "@/lib/credits";
import { env } from "@/lib/env";
import { paymentsConfigured } from "@/lib/payments/razorpay";
import { CreditsClient } from "./CreditsClient";

export const metadata: Metadata = { title: "Credits" };

export default async function CreditsPage() {
  const profile = await requireProfile();
  const ledger = await listLedger(profile.id, 30);
  return (
    <CreditsClient
      email={profile.email}
      paymentsEnabled={paymentsConfigured()}
      mock={env().PAYMENTS_MOCK}
      ledger={ledger.map((l) => ({
        id: l.id,
        delta: l.delta,
        balanceAfter: l.balanceAfter,
        reason: l.reason,
        createdAt: l.createdAt.toISOString(),
      }))}
    />
  );
}
