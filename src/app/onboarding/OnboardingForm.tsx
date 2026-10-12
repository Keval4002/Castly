"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/client/fetcher";

const SELLS = [
  { id: "clothing", label: "Clothing", hint: "Sarees, kurtas, dresses, menswear" },
  { id: "jewellery", label: "Jewellery", hint: "Necklaces, earrings, rings, bangles" },
  { id: "both", label: "Both", hint: "A bit of everything" },
] as const;

const PURPOSES = [
  { id: "marketplace", label: "Marketplaces", hint: "Amazon, Meesho, Flipkart" },
  { id: "social", label: "Instagram & WhatsApp", hint: "Posts, stories, catalogue" },
  { id: "website", label: "My own website", hint: "Store and banners" },
] as const;

export function OnboardingForm({ bonus }: { bonus: number }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [shopName, setShopName] = useState("");
  const [sells, setSells] = useState<(typeof SELLS)[number]["id"] | null>(null);
  const [purpose, setPurpose] = useState<(typeof PURPOSES)[number]["id"] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish(p: (typeof PURPOSES)[number]["id"]) {
    setPurpose(p);
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/onboarding", { method: "POST", body: JSON.stringify({ shopName: shopName.trim(), sells, purpose: p }) });
      router.replace("/workspace");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="card p-6 sm:p-8" data-testid="onboarding">
      <p className="font-ui text-xs font-medium uppercase tracking-wide text-ink-2">Step {step + 1} of 3</p>

      {step === 0 && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (shopName.trim()) setStep(1);
          }}
        >
          <h1 className="mt-2 text-3xl">What’s your shop called?</h1>
          <p className="mt-1 text-sm text-ink-2">You’ll get {bonus} free credits to try it out.</p>
          <input
            className="input mt-5"
            placeholder="e.g. Meera Ethnic Wear"
            value={shopName}
            maxLength={60}
            autoFocus
            onChange={(e) => setShopName(e.target.value)}
            data-testid="shop-name"
          />
          <button className="btn-primary mt-4 w-full" disabled={!shopName.trim()} data-testid="onboarding-next">
            Continue <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        </form>
      )}

      {step === 1 && (
        <div>
          <h1 className="mt-2 text-3xl">What do you sell?</h1>
          <div className="mt-5 grid gap-2">
            {SELLS.map((s) => (
              <button
                key={s.id}
                className="card p-4 text-left transition hover:border-ink"
                data-testid={`sells-${s.id}`}
                onClick={() => {
                  setSells(s.id);
                  setStep(2);
                }}
              >
                <p className="font-medium">{s.label}</p>
                <p className="text-sm text-ink-2">{s.hint}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <h1 className="mt-2 text-3xl">Where will you use your photos?</h1>
          <p className="mt-1 text-sm text-ink-2">We’ll set the best look and size for you.</p>
          <div className="mt-5 grid gap-2">
            {PURPOSES.map((p) => (
              <button
                key={p.id}
                className="card p-4 text-left transition hover:border-ink disabled:opacity-60"
                disabled={saving}
                data-testid={`purpose-${p.id}`}
                onClick={() => finish(p.id)}
              >
                <p className="flex items-center gap-2 font-medium">
                  {p.label}
                  {saving && purpose === p.id && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                </p>
                <p className="text-sm text-ink-2">{p.hint}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-err">{error}</p>}
      {step > 0 && !saving && (
        <button className="mt-4 text-sm text-ink-2 underline" onClick={() => setStep(step - 1)}>
          Back
        </button>
      )}
    </div>
  );
}
