"use client";

import { useState } from "react";
import { useCredits } from "@/components/CreditsProvider";
import { apiFetch } from "@/lib/client/fetcher";
import { CREDIT_PACKS, formatINR, TIER_ORDER, TIERS, type CreditPack } from "@/lib/pricing";

interface LedgerRow {
  id: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  createdAt: string;
}

interface Checkout {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
  mock: boolean;
  pack: CreditPack;
  prefill: { email: string };
}

interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open(): void; on(ev: string, cb: (r: unknown) => void): void };
  }
}

const REASON_LABEL: Record<string, string> = {
  signup_bonus: "Welcome bonus",
  purchase: "Credit purchase",
  generation: "Image generation",
  refund: "Refund (failed images)",
  admin_adjustment: "Adjustment",
};

function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load Razorpay. Check your connection and try again."));
    document.body.appendChild(s);
  });
}

export function CreditsClient({
  email,
  paymentsEnabled,
  mock,
  ledger: initialLedger,
}: {
  email: string;
  paymentsEnabled: boolean;
  mock: boolean;
  ledger: LedgerRow[];
}) {
  const { credits, setCredits } = useCredits();
  const [ledger, setLedger] = useState(initialLedger);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function refreshLedger() {
    const data = await apiFetch<{ balance: number; ledger: LedgerRow[] }>("/api/credits");
    setLedger(data.ledger);
    setCredits(data.balance);
  }

  async function verify(r: RazorpayResponse) {
    const res = await apiFetch<{ credits: number; balance?: number }>("/api/payments/verify", {
      method: "POST",
      body: JSON.stringify({ orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature }),
    });
    await refreshLedger();
    setMessage({ ok: true, text: `Payment successful — ${res.credits} credits added.` });
  }

  async function buy(pack: CreditPack) {
    setBusy(pack.id);
    setMessage(null);
    try {
      const checkout = await apiFetch<Checkout>("/api/payments/order", {
        method: "POST",
        body: JSON.stringify({ packId: pack.id }),
      });

      if (checkout.mock) {
        // Development: simulate a successful Razorpay payment.
        await verify({
          razorpay_order_id: checkout.orderId,
          razorpay_payment_id: `pay_mock_${crypto.randomUUID().slice(0, 12)}`,
          razorpay_signature: "",
        });
        return;
      }

      await loadRazorpay();
      await new Promise<void>((resolve, reject) => {
        const rzp = new window.Razorpay!({
          key: checkout.keyId,
          amount: checkout.amount,
          currency: checkout.currency,
          order_id: checkout.orderId,
          name: "Castly",
          description: `${pack.credits} credits · ${pack.label}`,
          prefill: { email },
          theme: { color: "#c2410c" },
          handler: (r: RazorpayResponse) => verify(r).then(resolve, reject),
          modal: { ondismiss: () => resolve() },
        });
        rzp.on("payment.failed", () => reject(new Error("Payment failed. You have not been charged.")));
        rzp.open();
      });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-10 px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">Credits</h1>
          <p className="text-sm text-ink-2">Pay as you go. Credits never expire. Failed images are refunded automatically.</p>
        </div>
        <div className="card px-5 py-3 text-right">
          <p className="text-xs uppercase tracking-wider text-ink-2">Balance</p>
          <p className="text-3xl font-semibold" data-testid="balance">
            {credits}
          </p>
        </div>
      </div>

      {message && (
        <p
          className={`rounded-lg p-3 text-sm ${message.ok ? "bg-green-50 text-ok" : "bg-red-50 text-err"}`}
          data-testid="payment-message"
        >
          {message.text}
        </p>
      )}

      <section>
        <div className="grid gap-4 sm:grid-cols-3">
          {CREDIT_PACKS.map((p) => (
            <div key={p.id} className={`card relative p-6 ${p.badge === "Popular" ? "border-brand ring-1 ring-brand" : ""}`}>
              {p.badge && (
                <span className="absolute -top-3 left-6 rounded-full bg-brand px-3 py-0.5 text-xs font-medium text-white">
                  {p.badge}
                </span>
              )}
              <p className="text-sm font-medium text-ink-2">{p.label}</p>
              <p className="mt-2 text-4xl font-semibold">{p.credits}</p>
              <p className="text-sm text-ink-2">credits</p>
              <p className="mt-4 text-2xl font-semibold">{formatINR(p.amountPaise)}</p>
              <p className="text-xs text-ink-2">
                ≈ {formatINR(Math.round(p.amountPaise / p.credits))}/credit · up to {Math.floor(p.credits / TIERS.standard.creditsPerImage)} Studio images
              </p>
              <button
                className="btn-primary mt-5 w-full"
                disabled={!paymentsEnabled || busy !== null}
                onClick={() => buy(p)}
                data-testid={`buy-${p.id}`}
              >
                {busy === p.id ? "Processing…" : `Buy ${p.label}`}
              </button>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-2">
          Secure payments by Razorpay — UPI, cards, netbanking & wallets. Prices include GST.
          {mock && <span className="ml-1 text-warn">(Test mode: payments are simulated.)</span>}
          {!paymentsEnabled && <span className="ml-1 text-err">Payments are not configured.</span>}
        </p>
      </section>

      <section className="grid gap-6 md:grid-cols-[1fr_1.4fr]">
        <div className="card p-6">
          <h2 className="font-medium">What a credit buys</h2>
          <ul className="mt-3 space-y-3 text-sm">
            {TIER_ORDER.map((t) => (
              <li key={t} className="flex justify-between gap-4">
                <span>
                  <b>{TIERS[t].label}</b>
                  <span className="block text-xs text-ink-2">{TIERS[t].tagline}</span>
                </span>
                <span className="whitespace-nowrap font-medium">{TIERS[t].creditsPerImage} / image</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="card p-6">
          <h2 className="font-medium">History</h2>
          <ul className="mt-3 divide-y divide-line text-sm" data-testid="ledger">
            {ledger.length === 0 && <li className="py-2 text-ink-2">No activity yet.</li>}
            {ledger.map((l) => (
              <li key={l.id} className="flex items-center justify-between py-2">
                <span>
                  {REASON_LABEL[l.reason] ?? l.reason}
                  <span className="block text-xs text-ink-2">{new Date(l.createdAt).toLocaleString("en-IN")}</span>
                </span>
                <span className={`font-medium ${l.delta > 0 ? "text-ok" : "text-ink"}`}>
                  {l.delta > 0 ? `+${l.delta}` : l.delta}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
