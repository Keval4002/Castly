import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ensureProfile, getBalance, InsufficientCreditsError, listLedger, moveCredits } from "@/lib/credits";
import { SIGNUP_BONUS_CREDITS } from "@/lib/pricing";
import { makeUser, resetDb } from "./helpers";
import { createCheckout, fulfillOrder } from "@/lib/payments/service";
import { findPack } from "@/lib/pricing";

beforeEach(resetDb);
afterAll(resetDb);

describe("credits ledger", () => {
  it("grants the signup bonus exactly once", async () => {
    const u = await makeUser();
    expect(u.credits).toBe(SIGNUP_BONUS_CREDITS);
    await ensureProfile({ id: u.id, email: u.email });
    await ensureProfile({ id: u.id, email: u.email });
    expect(await getBalance(u.id)).toBe(SIGNUP_BONUS_CREDITS);
    expect(await listLedger(u.id)).toHaveLength(1);
  });

  it("is idempotent per key, including under concurrency", async () => {
    const u = await makeUser();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        moveCredits({ userId: u.id, delta: 7, reason: "admin_adjustment", idempotencyKey: "same-key" }),
      ),
    );
    expect(results.filter((r) => r.applied)).toHaveLength(1);
    expect(await getBalance(u.id)).toBe(SIGNUP_BONUS_CREDITS + 7);
  });

  it("never goes negative", async () => {
    const u = await makeUser();
    await expect(
      moveCredits({ userId: u.id, delta: -(SIGNUP_BONUS_CREDITS + 1), reason: "generation", idempotencyKey: "k1" }),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(await getBalance(u.id)).toBe(SIGNUP_BONUS_CREDITS);
  });

  it("concurrent debits cannot overspend", async () => {
    const u = await makeUser(); // 10 credits
    const settled = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) =>
        moveCredits({ userId: u.id, delta: -3, reason: "generation", idempotencyKey: `debit-${i}` }),
      ),
    );
    const ok = settled.filter((s) => s.status === "fulfilled").length;
    expect(ok).toBe(Math.floor(SIGNUP_BONUS_CREDITS / 3));
    expect(await getBalance(u.id)).toBe(SIGNUP_BONUS_CREDITS - ok * 3);
  });
});

describe("payments", () => {
  it("fulfils an order once even if verify and webhook race", async () => {
    const u = await makeUser();
    const pack = findPack("starter")!;
    const checkout = await createCheckout(u, pack.id);
    const results = await Promise.all([
      fulfillOrder(checkout.orderId, "pay_1"),
      fulfillOrder(checkout.orderId, "pay_1", pack.amountPaise),
      fulfillOrder(checkout.orderId, "pay_1"),
    ]);
    expect(results.filter((r) => r.fulfilled)).toHaveLength(1);
    expect(await getBalance(u.id)).toBe(SIGNUP_BONUS_CREDITS + pack.credits);
  });

  it("rejects amount mismatches", async () => {
    const u = await makeUser();
    const checkout = await createCheckout(u, "growth");
    await expect(fulfillOrder(checkout.orderId, "pay_x", 100)).rejects.toThrow(/Amount mismatch/);
    expect(await getBalance(u.id)).toBe(SIGNUP_BONUS_CREDITS);
  });
});
