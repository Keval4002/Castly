"use client";

import Link from "next/link";
import { useState } from "react";
import { GenerationCard } from "@/components/GenerationCard";
import { apiFetch } from "@/lib/client/fetcher";
import type { GenerationDTO } from "@/lib/client/types";
import { useGenerationPolling } from "@/lib/client/usePolling";

export function LibraryClient({ initial }: { initial: GenerationDTO[] }) {
  const [gens, setGens] = useState(initial);
  const [hasMore, setHasMore] = useState(initial.length === 24);
  const [loading, setLoading] = useState(false);
  useGenerationPolling(gens, setGens);

  async function loadMore() {
    const last = gens[gens.length - 1];
    if (!last) return;
    setLoading(true);
    try {
      const { generations } = await apiFetch<{ generations: GenerationDTO[] }>(
        `/api/generations?before=${encodeURIComponent(last.createdAt)}`,
      );
      setGens((g) => [...g, ...generations]);
      setHasMore(generations.length === 24);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-4xl">Library</h1>
          <p className="text-sm text-ink-2">Every batch you’ve generated. Links refresh each time you open this page.</p>
        </div>
        <Link href="/studio" className="btn-primary">
          New batch
        </Link>
      </div>
      {gens.length === 0 ? (
        <div className="card p-10 text-center text-ink-2">
          Nothing here yet. <Link href="/studio" className="text-brand underline">Create your first catalogue shots →</Link>
        </div>
      ) : (
        gens.map((g) => <GenerationCard key={g.id} gen={g} />)
      )}
      {hasMore && (
        <div className="text-center">
          <button className="btn-ghost" onClick={loadMore} disabled={loading}>
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
