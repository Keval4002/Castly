import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { errorText, fetchWithTimeout } from "@/lib/http";

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
}

export function paymentsConfigured(): boolean {
  const e = env();
  return e.PAYMENTS_MOCK || Boolean(e.RAZORPAY_KEY_ID && e.RAZORPAY_KEY_SECRET);
}

export async function createRazorpayOrder(
  amountPaise: number,
  receipt: string,
  notes: Record<string, string>,
): Promise<RazorpayOrder> {
  const e = env();
  if (e.PAYMENTS_MOCK) {
    return { id: `order_mock_${randomBytes(8).toString("hex")}`, amount: amountPaise, currency: "INR" };
  }
  if (!e.RAZORPAY_KEY_ID || !e.RAZORPAY_KEY_SECRET) throw new Error("Razorpay is not configured");
  const auth = Buffer.from(`${e.RAZORPAY_KEY_ID}:${e.RAZORPAY_KEY_SECRET}`).toString("base64");
  const res = await fetchWithTimeout("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Basic ${auth}` },
    body: JSON.stringify({ amount: amountPaise, currency: "INR", receipt, notes }),
    timeoutMs: 15_000,
  });
  if (!res.ok) throw new Error(`Razorpay order failed ${res.status}: ${await errorText(res)}`);
  const json = (await res.json()) as RazorpayOrder;
  return { id: json.id, amount: json.amount, currency: json.currency };
}

function hmacHex(secret: string, data: string) {
  return createHmac("sha256", secret).update(data).digest("hex");
}

function safeEqualHex(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Checkout handler signature: HMAC_SHA256(order_id|payment_id, key_secret). */
export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string, secret?: string): boolean {
  const key = secret ?? env().RAZORPAY_KEY_SECRET;
  if (!key) return false;
  return safeEqualHex(hmacHex(key, `${orderId}|${paymentId}`), signature);
}

/** Webhook signature: HMAC_SHA256(raw body, webhook_secret). */
export function verifyWebhookSignature(rawBody: string, signature: string, secret?: string): boolean {
  const key = secret ?? env().RAZORPAY_WEBHOOK_SECRET;
  if (!key || !signature) return false;
  return safeEqualHex(hmacHex(key, rawBody), signature);
}

export function signWebhookBody(rawBody: string, secret: string) {
  return hmacHex(secret, rawBody);
}
