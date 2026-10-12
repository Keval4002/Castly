"use client";

import { Coins } from "lucide-react";

import { createContext, useContext, useState } from "react";

const Ctx = createContext<{ credits: number; setCredits: (n: number) => void } | null>(null);

export function CreditsProvider({ initial, children }: { initial: number; children: React.ReactNode }) {
  const [credits, setCredits] = useState(initial);
  return <Ctx.Provider value={{ credits, setCredits }}>{children}</Ctx.Provider>;
}

export function useCredits() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCredits must be used inside CreditsProvider");
  return v;
}

export function CreditsBadge() {
  const { credits } = useCredits();
  return (
    <a
      href="/credits"
      data-testid="credits-badge"
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 font-ui text-sm font-medium hover:bg-surface-2"
      title="Your credits — click to top up"
    >
      <Coins className="h-4 w-4 text-brand" aria-hidden />
      <span data-testid="credits-value">{credits}</span>
      <span className="text-ink-2">credits</span>
    </a>
  );
}
