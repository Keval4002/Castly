"use client";

import { useState } from "react";
import { aspectRatio, CATEGORIES, type CategoryId } from "@/lib/catalog/options";
import { downloadImage } from "@/lib/client/fetcher";
import { isActive, type GenerationDTO } from "@/lib/client/types";
import { TIERS, type TierId } from "@/lib/pricing";

function summary(g: GenerationDTO): string[] {
  const cat = CATEGORIES[g.category as CategoryId];
  const out: string[] = [];
  for (const group of cat.groups) {
    const v = g.options[group.id];
    const c = group.choices.find((x) => x.id === v);
    if (c && c.id !== "none") out.push(c.label);
  }
  return out.slice(0, 5);
}

export function GenerationCard({ gen, onRerun }: { gen: GenerationDTO; onRerun?: (g: GenerationDTO) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const ar = aspectRatio(gen.aspectRatio);
  const active = isActive(gen);
  const done = gen.images.filter((i) => i.status === "succeeded");

  async function downloadAll() {
    for (const img of done) {
      if (img.url) await downloadImage(img.url, `castly-${gen.id.slice(0, 8)}-${img.idx + 1}.jpg`);
    }
  }

  return (
    <article className="card overflow-hidden" data-testid="generation-card" data-status={gen.status}>
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        {gen.source && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={gen.source.thumbUrl} alt="Product" className="h-10 w-10 rounded-lg border border-line object-cover" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {CATEGORIES[gen.category as CategoryId]?.label} · {TIERS[gen.tier as TierId]?.label} · {gen.aspectRatio}
          </p>
          <p className="truncate text-xs text-ink-2">{gen.productSummary || summary(gen).join(" · ")}</p>
        </div>
        <StatusPill gen={gen} />
        {!active && done.length > 0 && (
          <button className="btn-ghost px-3 py-1.5 text-xs" onClick={downloadAll}>
            Download all
          </button>
        )}
        {!active && onRerun && (
          <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => onRerun(gen)} title="New unique variations with the same settings">
            Generate again
          </button>
        )}
      </header>

      <div className={`grid gap-3 p-4 ${gen.count === 1 ? "grid-cols-1 sm:max-w-sm" : "grid-cols-2 lg:grid-cols-4"}`}>
        {gen.images.map((img) => (
          <div
            key={img.idx}
            className="group relative overflow-hidden rounded-xl bg-surface-2"
            style={{ aspectRatio: `${ar.width} / ${ar.height}` }}
            data-testid="generation-image"
            data-status={img.status}
          >
            {img.status === "succeeded" && img.thumbUrl ? (
              <>
                <button className="h-full w-full" onClick={() => setOpen(img.idx)} aria-label={`Open variant ${img.idx + 1}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.thumbUrl} alt={`Variant ${img.idx + 1}`} className="h-full w-full object-cover" loading="lazy" />
                </button>
                <button
                  className="absolute bottom-2 right-2 rounded-full bg-white/90 px-3 py-1 text-xs font-medium opacity-100 shadow sm:opacity-0 sm:group-hover:opacity-100"
                  onClick={() => img.url && downloadImage(img.url, `castly-${gen.id.slice(0, 8)}-${img.idx + 1}.jpg`)}
                >
                  Download
                </button>
              </>
            ) : img.status === "failed" ? (
              <div className="grid h-full place-items-center p-3 text-center text-xs text-ink-2">
                Couldn’t generate this one.
                <br />
                Credits refunded.
              </div>
            ) : (
              <div className="shimmer h-full w-full" />
            )}
          </div>
        ))}
      </div>
      {gen.error && !active && gen.status === "failed" && <p className="px-4 pb-4 text-sm text-err">{gen.error}</p>}

      {open !== null && (
        <Lightbox gen={gen} idx={open} onClose={() => setOpen(null)} onNav={(i) => setOpen(i)} />
      )}
    </article>
  );
}

function StatusPill({ gen }: { gen: GenerationDTO }) {
  const map: Record<GenerationDTO["status"], [string, string]> = {
    queued: ["Queued", "bg-surface-2 text-ink-2"],
    running: ["Generating…", "bg-brand-soft text-brand"],
    succeeded: ["Ready", "bg-green-50 text-ok"],
    partial: [`Partly ready · ${gen.refundedCredits} refunded`, "bg-amber-50 text-warn"],
    failed: ["Failed · refunded", "bg-red-50 text-err"],
  };
  const [label, cls] = map[gen.status];
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>{label}</span>;
}

function Lightbox({
  gen,
  idx,
  onClose,
  onNav,
}: {
  gen: GenerationDTO;
  idx: number;
  onClose: () => void;
  onNav: (i: number) => void;
}) {
  const ok = gen.images.filter((i) => i.status === "succeeded");
  const pos = ok.findIndex((i) => i.idx === idx);
  const img = ok[pos];
  if (!img?.url) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
      onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      role="dialog"
      aria-modal
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={img.url} alt="" className="max-h-full max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
      <div className="absolute right-4 top-4 flex gap-2" onClick={(e) => e.stopPropagation()}>
        <button
          className="btn bg-white text-ink"
          onClick={() => downloadImage(img.url!, `castly-${gen.id.slice(0, 8)}-${img.idx + 1}.jpg`)}
        >
          Download
        </button>
        <button className="btn bg-white/20 text-white" onClick={onClose}>
          Close
        </button>
      </div>
      {ok.length > 1 && (
        <>
          <button
            className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/20 px-4 py-3 text-white"
            onClick={(e) => {
              e.stopPropagation();
              onNav(ok[(pos - 1 + ok.length) % ok.length].idx);
            }}
            aria-label="Previous"
          >
            ‹
          </button>
          <button
            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/20 px-4 py-3 text-white"
            onClick={(e) => {
              e.stopPropagation();
              onNav(ok[(pos + 1) % ok.length].idx);
            }}
            aria-label="Next"
          >
            ›
          </button>
        </>
      )}
    </div>
  );
}
