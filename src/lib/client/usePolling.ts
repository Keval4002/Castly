"use client";

import { useEffect, useRef } from "react";
import { useCredits } from "@/components/CreditsProvider";
import { apiFetch } from "./fetcher";
import { isActive, type GenerationDTO } from "./types";

/** Polls every in-progress generation until it settles; updates the list in place. */
export function useGenerationPolling(
  gens: GenerationDTO[],
  setGens: React.Dispatch<React.SetStateAction<GenerationDTO[]>>,
  intervalMs = 1500,
) {
  const { setCredits } = useCredits();
  const activeIds = gens.filter(isActive).map((g) => g.id).join(",");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!activeIds) return;
    let cancelled = false;
    const ids = activeIds.split(",");

    async function tick() {
      const results = await Promise.allSettled(
        ids.map((id) => apiFetch<{ generation: GenerationDTO; balance?: number }>(`/api/generations/${id}`)),
      );
      if (cancelled) return;
      const updates = new Map<string, GenerationDTO>();
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        updates.set(r.value.generation.id, r.value.generation);
        if (typeof r.value.balance === "number") setCredits(r.value.balance);
      }
      if (updates.size) setGens((prev) => prev.map((g) => updates.get(g.id) ?? g));
      timer.current = setTimeout(tick, intervalMs);
    }
    timer.current = setTimeout(tick, intervalMs);
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [activeIds, intervalMs, setCredits, setGens]);
}
