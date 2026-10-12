import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { requireProfile } from "@/lib/auth/session";
import { listLedger } from "@/lib/credits";
import { listPayments } from "@/lib/payments/service";

export const dynamic = "force-dynamic";

export const GET = api(async () => {
  const profile = await requireProfile();
  const [ledger, payments] = await Promise.all([listLedger(profile.id), listPayments(profile.id)]);
  return NextResponse.json({
    balance: profile.credits,
    ledger: ledger.map((l) => ({
      id: l.id,
      delta: l.delta,
      balanceAfter: l.balanceAfter,
      reason: l.reason,
      createdAt: l.createdAt.toISOString(),
    })),
    payments: payments.map((p) => ({
      orderId: p.razorpayOrderId,
      packId: p.packId,
      credits: p.credits,
      amountPaise: p.amountPaise,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
    })),
  });
});
