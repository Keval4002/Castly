import { NextResponse } from "next/server";
import { z } from "zod";
import { api, HttpError } from "@/lib/api";
import { requireProfile } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { verifyCheckoutSignature } from "@/lib/payments/razorpay";
import { fulfillOrder, getOrderForUser } from "@/lib/payments/service";

export const dynamic = "force-dynamic";

const body = z.object({
  orderId: z.string().min(1).max(64),
  paymentId: z.string().min(1).max(64),
  signature: z.string().max(256).default(""),
});

/**
 * Called by the browser after Razorpay Checkout succeeds. The webhook is the
 * source of truth; this just gives instant feedback. Both paths are idempotent.
 */
export const POST = api(async (req) => {
  const profile = await requireProfile();
  const { orderId, paymentId, signature } = body.parse(await req.json());

  const order = await getOrderForUser(profile.id, orderId);
  if (!order) throw new HttpError(404, "Order not found", "not_found");

  const isMock = env().PAYMENTS_MOCK && orderId.startsWith("order_mock_");
  if (!isMock && !verifyCheckoutSignature(orderId, paymentId, signature)) {
    throw new HttpError(400, "Payment signature verification failed", "invalid_signature");
  }
  const result = await fulfillOrder(orderId, paymentId);
  return NextResponse.json({ ok: true, credits: result.credits, balance: result.balance });
});
