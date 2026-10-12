"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Download, Sparkles } from "lucide-react";
import { GenerationCard } from "@/components/GenerationCard";
import { apiFetch } from "@/lib/client/fetcher";
import type { GenerationDTO } from "@/lib/client/types";
import { useGenerationPolling } from "@/lib/client/usePolling";
import type { ProductDTO } from "@/lib/products";

export function ProductDetail({ product, initial }: { product: ProductDTO; initial: GenerationDTO[] }) {
  const router = useRouter();
  const [gens, setGens] = useState(initial);
  const [name, setName] = useState(product.name);
  const [sku, setSku] = useState(product.sku ?? "");
  const [saved, setSaved] = useState(false);
  useGenerationPolling(gens, setGens);

  async function save() {
    await apiFetch(`/api/products/${product.id}`, { method: "PATCH", body: JSON.stringify({ name, sku }) });
    setSaved(true);
    router.refresh();
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-8">
      <Link href="/workspace" className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Workspace
      </Link>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <label className="label" htmlFor="pname">
            Name
          </label>
          <input id="pname" className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="w-40">
          <label className="label" htmlFor="psku">
            SKU <span className="font-normal normal-case text-ink-3">(optional)</span>
          </label>
          <input id="psku" className="input" value={sku} maxLength={40} onChange={(e) => setSku(e.target.value)} />
        </div>
        <button className="btn-ghost" onClick={save} disabled={!name.trim()}>
          {saved ? "Saved" : "Save"}
        </button>
        <a href={`/api/products/export?ids=${product.id}`} className="btn-ghost">
          <Download className="h-4 w-4" aria-hidden /> Export
        </a>
        <Link href={`/studio?product=${product.id}`} className="btn-primary">
          <Sparkles className="h-4 w-4" aria-hidden /> Make photos
        </Link>
      </div>
      {gens.length === 0 ? (
        <div className="card p-10 text-center text-ink-2">No photos yet for this product.</div>
      ) : (
        gens.map((g) => <GenerationCard key={g.id} gen={g} />)
      )}
    </div>
  );
}
