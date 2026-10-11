import { NextResponse } from "next/server";
import { z } from "zod";
import { api, HttpError, rateLimit } from "@/lib/api";
import { requireProfile } from "@/lib/auth/session";
import { paymentsConfigured } from "@/lib/payments/razorpay";
import { createCheckout } from "@/lib/payments/service";

export const dynamic = "force-dynamic";

const body = z.object({ packId: z.string().min(1).max(32) });

export const POST = api(async (req) => {
  const profile = await requireProfile();
  rateLimit(`order:${profile.id}`, 10, 60_000);
  if (!paymentsConfigured()) throw new HttpError(503, "Payments are not configured yet", "payments_unavailable");
  const { packId } = body.parse(await req.json());
  const checkout = await createCheckout(profile, packId);
  return NextResponse.json(checkout, { status: 201 });
});
