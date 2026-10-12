"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Download, ImagePlus, Images, Loader2, Package, Sparkles, Trash2, Wallet } from "lucide-react";
import { useCredits } from "@/components/CreditsProvider";
import { DEFAULT_COUNT, LOOK_IDS, LOOKS, SIZES, type LookId, type Size } from "@/lib/catalog/simple";
import { ApiError, apiFetch, compressImage } from "@/lib/client/fetcher";
import { DEFAULT_TIER, generationCost } from "@/lib/pricing";
import type { ProductDTO } from "@/lib/products";

const PER_PRODUCT = generationCost(DEFAULT_TIER, DEFAULT_COUNT);
/** Matches MAX_BULK in the bulk route. */
const BULK_CHUNK = 12;

export function WorkspaceClient({
  shopName,
  initial,
  totalImages,
  defaultLook,
  defaultSize,
}: {
  shopName: string;
  initial: ProductDTO[];
  totalImages: number;
  defaultLook: LookId;
  defaultSize: Size["id"];
}) {
  const { credits, setCredits } = useCredits();
  const [items, setItems] = useState(initial);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [look, setLook] = useState<LookId>(defaultLook);
  const [size, setSize] = useState<Size["id"]>(defaultSize);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: "ok" | "err"; topup?: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const res = await apiFetch<{ products: ProductDTO[] }>("/api/products");
    setItems(res.products);
  }, []);

  // Keep progress live while anything is generating.
  const generating = items.some((p) => p.status === "generating");
  useEffect(() => {
    if (!generating) return;
    const t = setInterval(() => void refresh().catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [generating, refresh]);

  const ids = [...selected];
  const cost = ids.length * PER_PRODUCT;
  const images = Math.max(totalImages, items.reduce((n, p) => n + p.imageCount, 0));
  const allSelected = items.length > 0 && selected.size === items.length;

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  async function onFiles(files: FileList | null) {
    const list = [...(files ?? [])];
    if (list.length === 0) return;
    setMessage(null);
    setUploading({ done: 0, total: list.length });
    let failed = 0;
    for (const [i, file] of list.entries()) {
      try {
        const blob = await compressImage(file);
        const form = new FormData();
        form.append("file", blob, file.name);
        await apiFetch("/api/uploads", { method: "POST", body: form });
      } catch {
        failed++;
      }
      setUploading({ done: i + 1, total: list.length });
    }
    setUploading(null);
    if (fileInput.current) fileInput.current.value = "";
    await refresh().catch(() => {});
    if (failed) setMessage({ kind: "err", text: `${failed} photo${failed > 1 ? "s" : ""} couldn’t be added. Try again.` });
  }

  async function generateSelected() {
    setBusy(true);
    setMessage(null);
    let queued = 0;
    let skipped = 0;
    try {
      for (let i = 0; i < ids.length; i += BULK_CHUNK) {
        const res = await apiFetch<{ queued: number; skipped: string[] }>("/api/generations/bulk", {
          method: "POST",
          body: JSON.stringify({ productIds: ids.slice(i, i + BULK_CHUNK), look, aspectRatio: size }),
        });
        queued += res.queued;
        skipped += res.skipped.length;
      }
      setCredits(Math.max(0, credits - queued * PER_PRODUCT));
      setSelected(new Set());
      setMessage({
        kind: "ok",
        text: `Started ${queued} product${queued === 1 ? "" : "s"}${skipped ? ` (${skipped} skipped — unsupported photo)` : ""}. You can leave this page.`,
      });
    } catch (err) {
      const e = err as ApiError;
      setMessage({ kind: "err", text: e.message, topup: e.code === "insufficient_credits" });
    } finally {
      setBusy(false);
      await refresh().catch(() => {});
    }
  }

  async function remove() {
    if (!window.confirm(`Remove ${ids.length} product${ids.length > 1 ? "s" : ""} from your catalogue? Generated images stay in the Library.`)) return;
    setBusy(true);
    await Promise.allSettled(ids.map((id) => apiFetch(`/api/products/${id}`, { method: "DELETE" })));
    setSelected(new Set());
    await refresh().catch(() => {});
    setBusy(false);
  }

  const exportHref = `/api/products/export${ids.length ? `?ids=${ids.join(",")}` : ""}`;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-ui text-sm text-ink-2">Welcome back</p>
          <h1 className="font-display text-4xl" data-testid="workspace-title">
            {shopName}
          </h1>
        </div>
        <div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            data-testid="workspace-file-input"
            onChange={(e) => void onFiles(e.target.files)}
          />
          <button className="btn-primary" onClick={() => fileInput.current?.click()} disabled={Boolean(uploading)} data-testid="add-products">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ImagePlus className="h-4 w-4" aria-hidden />}
            {uploading ? `Adding ${uploading.done}/${uploading.total}…` : "Add products"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat icon={<Package className="h-4 w-4" aria-hidden />} label="Products" value={items.length} />
        <Stat icon={<Images className="h-4 w-4" aria-hidden />} label="Photos made" value={images} href="/library" />
        <Stat icon={<Wallet className="h-4 w-4" aria-hidden />} label="Credits" value={credits} href="/credits" />
      </div>

      {message && (
        <p
          className={`rounded-xl p-3 text-sm ${message.kind === "ok" ? "bg-green-50 text-ok" : "bg-red-50 text-err"}`}
          data-testid="workspace-message"
        >
          {message.text}{" "}
          {message.topup && (
            <Link href="/credits" className="font-medium underline">
              Buy credits
            </Link>
          )}
        </p>
      )}

      {items.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="font-display text-3xl">Add your first products</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-ink-2">
            Upload product photos — as many as you like. Then pick a look and make them all in one tap.
          </p>
          <button className="btn-primary mt-5" onClick={() => fileInput.current?.click()}>
            <ImagePlus className="h-4 w-4" aria-hidden /> Upload photos
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <h2 className="font-ui text-sm font-semibold tracking-normal">Your catalogue</h2>
            <div className="flex items-center gap-3">
              <button className="text-sm text-brand underline" onClick={() => setSelected(allSelected ? new Set() : new Set(items.map((p) => p.id)))}>
                {allSelected ? "Clear" : "Select all"}
              </button>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- file download, not a page */}
              <a href="/api/products/export" className="btn-ghost text-sm" data-testid="export-all">
                <Download className="h-4 w-4" aria-hidden /> Export all
              </a>
            </div>
          </div>
          <ul className={`grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 ${selected.size ? "pb-44" : ""}`} data-testid="product-grid">
            {items.map((p) => (
              <li key={p.id}>
                <ProductCard p={p} selected={selected.has(p.id)} onToggle={() => toggle(p.id)} />
              </li>
            ))}
          </ul>
        </>
      )}

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 px-4 py-3 shadow-lg backdrop-blur" data-testid="bulk-bar">
          <div className="mx-auto flex max-w-6xl flex-col gap-3 lg:flex-row lg:items-center">
            <p className="font-ui text-sm font-medium">{selected.size} selected</p>
            <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Look">
              {LOOK_IDS.map((id) => (
                <button key={id} role="radio" aria-checked={look === id} className="chip" data-active={look === id} data-testid={`bulk-look-${id}`} onClick={() => setLook(id)}>
                  {LOOKS.clothing.find((l) => l.id === id)!.label}
                </button>
              ))}
              <span className="mx-1 h-5 w-px bg-line" aria-hidden />
              {SIZES.map((s) => (
                <button key={s.id} role="radio" aria-checked={size === s.id} className="chip" data-active={size === s.id} onClick={() => setSize(s.id)}>
                  {s.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 lg:ml-auto">
              <button className="btn-ghost" onClick={remove} disabled={busy} aria-label="Remove selected">
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
              <a href={exportHref} className="btn-ghost">
                <Download className="h-4 w-4" aria-hidden /> Export
              </a>
              <button className="btn-brand" onClick={generateSelected} disabled={busy} data-testid="generate-selected">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
                Generate · {cost} credits
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ icon, label, value, href }: { icon: React.ReactNode; label: string; value: number; href?: string }) {
  const body = (
    <div className="card p-4">
      <p className="flex items-center gap-1.5 text-xs text-ink-2">
        {icon}
        {label}
      </p>
      <p className="mt-1 font-display text-3xl">{value}</p>
    </div>
  );
  return href ? (
    <Link href={href} className="block transition hover:opacity-80">
      {body}
    </Link>
  ) : (
    body
  );
}

function ProductCard({ p, selected, onToggle }: { p: ProductDTO; selected: boolean; onToggle: () => void }) {
  const src = p.latestUrl ?? p.thumbUrl;
  return (
    <div className="card relative overflow-hidden data-[selected=true]:ring-2 data-[selected=true]:ring-brand" data-selected={selected} data-testid="product-card">
      <button
        onClick={onToggle}
        aria-pressed={selected}
        aria-label={`Select ${p.name}`}
        className="absolute left-2 top-2 z-10 grid h-6 w-6 place-items-center rounded-md border border-line bg-white/90 text-white data-[on=true]:border-brand data-[on=true]:bg-brand"
        data-on={selected}
      >
        {selected && <Check className="h-4 w-4" aria-hidden />}
      </button>
      <Link href={`/workspace/products/${p.id}`} className="block">
        <div className="aspect-[4/5] bg-surface-2">
          {src && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={p.name} className="h-full w-full object-cover" loading="lazy" />
          )}
        </div>
        <div className="p-2.5">
          <p className="truncate text-sm font-medium">{p.name}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-2">
            {p.status === "generating" ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Generating…
              </>
            ) : p.status === "ready" ? (
              `${p.imageCount} photo${p.imageCount === 1 ? "" : "s"}`
            ) : (
              "Not generated yet"
            )}
          </p>
        </div>
      </Link>
    </div>
  );
}
