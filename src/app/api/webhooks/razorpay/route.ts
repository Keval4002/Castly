import { NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/payments/razorpay";
import { fulfillOrder, markOrderFailed, PaymentError } from "@/lib/payments/service";

export const dynamic = "force-dynamic";

interface PaymentEntity {
  id: string;
  order_id: string;
  amount: number;
  status: string;
}

interface WebhookEvent {
  event: string;
  payload?: { payment?: { entity?: PaymentEntity } };
}

/** Razorpay → us. Configure events: payment.captured, order.paid, payment.failed. */
export async function POST(req: Request) {
  const raw = await req.text();
  const signature = req.headers.get("x-razorpay-signature") ?? "";
  if (!verifyWebhookSignature(raw, signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  let event: WebhookEvent;
  try {
    event = JSON.parse(raw) as WebhookEvent;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const payment = event.payload?.payment?.entity;

  try {
    if ((event.event === "payment.captured" || event.event === "order.paid") && payment?.order_id) {
      const result = await fulfillOrder(payment.order_id, payment.id, payment.amount);
      return NextResponse.json({ ok: true, fulfilled: result.fulfilled });
    }
    if (event.event === "payment.failed" && payment?.order_id) {
      await markOrderFailed(payment.order_id);
    }
    return NextResponse.json({ ok: true, ignored: true });
  } catch (err) {
    if (err instanceof PaymentError && err.status === 404) {
      // Not one of ours (e.g. another app on the same Razorpay account). Ack so it isn't retried.
      return NextResponse.json({ ok: true, ignored: true });
    }
    console.error("[webhook] razorpay processing failed", err);
    // Non-2xx → Razorpay retries with backoff.
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
