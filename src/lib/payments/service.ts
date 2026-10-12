import "server-only";
import { and, desc, eq, gte, ne } from "drizzle-orm";
import { applyCreditMovement, isUniqueViolation } from "@/lib/credits";
import { db } from "@/lib/db";
import { payments } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { findPack } from "@/lib/pricing";
import { createRazorpayOrder } from "./razorpay";

export class PaymentError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

/** An unpaid order for the same pack is reused for this long. */
export const OPEN_ORDER_REUSE_MS = 30 * 60 * 1000;

export async function createCheckout(user: { id: string; email: string }, packId: string) {
  const pack = findPack(packId);
  if (!pack) throw new PaymentError("Unknown credit pack", 400);

  // Idempotent: a double click (or a retry) reuses the unpaid order for this pack instead of opening a second one.
  const [open] = await db()
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.userId, user.id),
        eq(payments.packId, pack.id),
        eq(payments.status, "created"),
        gte(payments.createdAt, new Date(Date.now() - OPEN_ORDER_REUSE_MS)),
      ),
    )
    .orderBy(desc(payments.createdAt))
    .limit(1);
  if (open) {
    return {
      orderId: open.razorpayOrderId,
      amount: open.amountPaise,
      currency: open.currency,
      keyId: env().RAZORPAY_KEY_ID ?? "",
      mock: env().PAYMENTS_MOCK,
      pack,
      prefill: { email: user.email },
    };
  }

  const order = await createRazorpayOrder(pack.amountPaise, `cst_${Date.now().toString(36)}`, {
    user_id: user.id,
    pack_id: pack.id,
  });
  await db().insert(payments).values({
    userId: user.id,
    packId: pack.id,
    credits: pack.credits,
    amountPaise: pack.amountPaise,
    currency: "INR",
    razorpayOrderId: order.id,
  });
  return {
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId: env().RAZORPAY_KEY_ID ?? "",
    mock: env().PAYMENTS_MOCK,
    pack,
    prefill: { email: user.email },
  };
}

export interface FulfillResult {
  fulfilled: boolean; // false when it had already been fulfilled
  userId: string;
  credits: number;
  balance?: number;
}

/**
 * Credit the user for a paid order exactly once. Safe to call from both the
 * checkout callback and the webhook, in any order, concurrently.
 */
export async function fulfillOrder(orderId: string, paymentId: string, amountPaise?: number): Promise<FulfillResult> {
  try {
    return await db().transaction(async (tx) => {
      const [payment] = await tx.select().from(payments).where(eq(payments.razorpayOrderId, orderId)).for("update");
      if (!payment) throw new PaymentError("Order not found", 404);
      if (amountPaise !== undefined && amountPaise !== payment.amountPaise) {
        throw new PaymentError(`Amount mismatch for order ${orderId}`, 400);
      }
      if (payment.status === "paid") return { fulfilled: false, userId: payment.userId, credits: payment.credits };

      await tx
        .update(payments)
        .set({ status: "paid", razorpayPaymentId: paymentId, paidAt: new Date() })
        .where(and(eq(payments.id, payment.id), ne(payments.status, "paid")));
      const { balance } = await applyCreditMovement(tx, {
        userId: payment.userId,
        delta: payment.credits,
        reason: "purchase",
        idempotencyKey: `purchase:${orderId}`,
        ref: paymentId,
      });
      return { fulfilled: true, userId: payment.userId, credits: payment.credits, balance };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const [p] = await db().select().from(payments).where(eq(payments.razorpayOrderId, orderId));
      return { fulfilled: false, userId: p.userId, credits: p.credits };
    }
    throw err;
  }
}

export async function markOrderFailed(orderId: string) {
  await db()
    .update(payments)
    .set({ status: "failed" })
    .where(and(eq(payments.razorpayOrderId, orderId), eq(payments.status, "created")));
}

export async function getOrderForUser(userId: string, orderId: string) {
  const [p] = await db()
    .select()
    .from(payments)
    .where(and(eq(payments.razorpayOrderId, orderId), eq(payments.userId, userId)));
  return p ?? null;
}

export async function listPayments(userId: string, limit = 20) {
  return db().select().from(payments).where(eq(payments.userId, userId)).orderBy(desc(payments.createdAt)).limit(limit);
}
