"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, CircleCheck, CircleHelp, ImagePlus, Info, Loader2, Pencil, Sparkles, TriangleAlert } from "lucide-react";
import Image from "next/image";
import { CategoryIcon } from "@/components/CategoryIcon";
import { SITE_IMAGES } from "@/lib/site-images";
import { useCredits } from "@/components/CreditsProvider";
import { GenerationCard } from "@/components/GenerationCard";
import { CATEGORIES, CATEGORY_LIST, type CategoryId } from "@/lib/catalog/options";
import { BACKDROPS, DEFAULT_COUNT, LOOKS, SIZES, type LookId, type Size } from "@/lib/catalog/simple";
import {
  CLASSIFICATION_ISSUES,
  CORRECTION_CONFIDENCE,
  describeCorrection,
  type Classification,
  type Correction,
} from "@/lib/classify/reconcile";
import { ApiError, apiFetch, compressImage } from "@/lib/client/fetcher";
import { isActive, type GenerationDTO } from "@/lib/client/types";
import { useGenerationPolling } from "@/lib/client/usePolling";
import { DEFAULT_TIER, generationCost } from "@/lib/pricing";

export interface UploadedAsset {
  id: string;
  thumbUrl: string;
  url: string;
  width: number;
  height: number;
  classification: Classification | null;
  preparation: { status: "pending" | "ready" | "failed" | "none"; method?: string | null };
  clean: { url: string; thumbUrl: string } | null;
}

const COST = generationCost(DEFAULT_TIER, DEFAULT_COUNT);

export function StudioClient({
  initialAsset,
  initialCategory,
  initialProductType,
  defaultLook,
  defaultSize,
  initial,
}: {
  initialAsset: UploadedAsset | null;
  initialCategory: CategoryId;
  initialProductType: string | null;
  defaultLook: LookId;
  defaultSize: Size["id"];
  initial: GenerationDTO[];
}) {
  const { credits, setCredits } = useCredits();
  const [asset, setAsset] = useState<UploadedAsset | null>(initialAsset);
  const [uploading, setUploading] = useState(false);
  const [category, setCategory] = useState<CategoryId>(initialCategory);
  const [productTypeId, setProductTypeId] = useState<string | null>(initialProductType);
  const [override, setOverride] = useState(false);
  const [editing, setEditing] = useState(false);
  const [look, setLook] = useState<LookId>(defaultLook);
  const [backdrop, setBackdrop] = useState<string | null>(null);
  const [size, setSize] = useState<Size["id"]>(defaultSize);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; topup?: boolean } | null>(null);
  const [notice, setNotice] = useState<Correction[] | null>(null);
  const [gens, setGens] = useState<GenerationDTO[]>(initial);
  const fileInput = useRef<HTMLInputElement>(null);

  useGenerationPolling(gens, setGens);

  // The photo is cleaned in the background while the seller picks a look.
  const preparing = asset?.preparation.status === "pending";
  useEffect(() => {
    if (!asset || !preparing) return;
    let stop = false;
    const started = Date.now();
    const tick = async () => {
      if (stop || Date.now() - started > 120_000) return;
      try {
        const res = await apiFetch<{ asset: UploadedAsset }>(`/api/uploads/${asset.id}`);
        if (stop) return;
        if (res.asset.preparation.status !== "pending") {
          setAsset((a) => (a && a.id === res.asset.id ? { ...a, preparation: res.asset.preparation, clean: res.asset.clean } : a));
          return;
        }
      } catch {
        // transient — keep polling
      }
      setTimeout(tick, 1500);
    };
    const timer = setTimeout(tick, 1200);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [asset?.id, preparing]); // eslint-disable-line react-hooks/exhaustive-deps

  const cat = CATEGORIES[category];
  const looks = LOOKS[category];
  const backdrops = BACKDROPS[category].items;
  const activeLook = looks.find((l) => l.id === look) ?? looks[0];
  const selectedBackdrop = backdrops.some((b) => b.id === backdrop) ? backdrop : activeLook.backdrop;
  const activeCount = gens.filter(isActive).length;
  const canGenerate = Boolean(asset) && !uploading && !submitting;

  const detection = asset?.classification ?? null;
  const confident = Boolean(detection && detection.confidence >= CORRECTION_CONFIDENCE);
  const typeLabel = cat.productTypes.find((t) => t.id === productTypeId)?.label ?? null;
  const unsupported = confident && detection!.category === "other";
  const mismatch =
    confident &&
    detection!.category !== "other" &&
    (detection!.category !== category || (productTypeId !== null && productTypeId !== detection!.productType));

  function pickCategory(id: CategoryId) {
    setCategory(id);
    setProductTypeId(detection && detection.category === id ? detection.productType : null);
    setBackdrop(null);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const blob = await compressImage(file);
      const form = new FormData();
      form.append("file", blob, file.name || "product.jpg");
      const res = await apiFetch<{ asset: UploadedAsset }>("/api/uploads", { method: "POST", body: form });
      setAsset(res.asset);
      setOverride(false);
      setNotice(null);
      setEditing(false);
      // Auto-select what the classifier saw so the seller doesn't have to.
      const c = res.asset.classification;
      if (c && c.category !== "other" && c.confidence >= CORRECTION_CONFIDENCE) {
        if (c.category !== category) {
          setCategory(c.category);
          setBackdrop(null);
        }
        setProductTypeId(c.productType);
      } else {
        setProductTypeId(c && c.category === category ? c.productType : null);
      }
    } catch (err) {
      setError({ message: (err as Error).message });
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function submit(body: Record<string, unknown>) {
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const res = await apiFetch<{ generation: GenerationDTO; balance: number }>("/api/generations", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setGens((g) => [res.generation, ...g]);
      if (res.generation.corrections.length) {
        // Reflect the server's correction for the next run.
        const g = res.generation;
        setNotice(g.corrections);
        if (g.category !== category) {
          setCategory(g.category);
          setBackdrop(null);
        }
        setProductTypeId(g.productType);
      }
      setCredits(res.balance);
      document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      const e = err as ApiError;
      setError({ message: e.message, topup: e.code === "insufficient_credits" });
    } finally {
      setSubmitting(false);
    }
  }

  function generate() {
    if (!asset) return;
    void submit({
      sourceAssetId: asset.id,
      category,
      productType: productTypeId,
      overrideDetection: override || undefined,
      look,
      backdrop: selectedBackdrop,
      aspectRatio: size,
    });
  }

  function rerun(g: GenerationDTO) {
    if (!g.source) return;
    void submit({
      sourceAssetId: g.source.id,
      category: g.category,
      productType: g.productType,
      look: g.look ?? "marketplace",
      aspectRatio: SIZES.some((s) => s.id === g.aspectRatio) ? g.aspectRatio : "1:1",
    });
  }

  return (
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-[400px_minmax(0,1fr)]">
      <section className="min-w-0 space-y-6 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto lg:pb-4 lg:pr-2">
        {/* ---- Photo ---- */}
        <div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            data-testid="file-input"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInput.current?.click()}
            onKeyDown={(e) => e.key === "Enter" && fileInput.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void onFile(e.dataTransfer.files?.[0]);
            }}
            className="card flex cursor-pointer items-center gap-4 border-dashed p-4 hover:bg-surface-2"
          >
            {asset ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={asset.clean?.thumbUrl ?? asset.thumbUrl}
                alt="Your product"
                className="h-24 w-24 rounded-xl border border-line bg-white object-contain"
                data-testid="upload-preview"
              />
            ) : (
              <div className={`grid h-24 w-24 place-items-center rounded-xl bg-surface-2 text-ink-2 ${uploading ? "shimmer" : ""}`}>
                {uploading ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden /> : <ImagePlus className="h-7 w-7" strokeWidth={1.5} aria-hidden />}
              </div>
            )}
            <div className="text-sm">
              <p className="font-medium">{uploading ? "Uploading…" : asset ? "Change photo" : "Upload your product photo"}</p>
              <p className="text-ink-2">One product, any phone photo works.</p>
            </div>
          </div>
          {asset && <PreparationStatus prep={asset.preparation} />}

          {asset && (
            <div className="mt-3 rounded-xl bg-surface-2 p-3 text-sm" data-testid="detection">
              <div className="flex items-center gap-2">
                <CategoryIcon icon={cat.icon} className="h-4 w-4 text-navy" />
                <p className="flex-1">
                  {detection || typeLabel ? (
                    <>
                      This is <b data-testid="detected-type">{typeLabel ?? cat.label}</b>
                    </>
                  ) : (
                    "What is this?"
                  )}
                </p>
                <button className="inline-flex items-center gap-1 text-xs font-medium text-brand" onClick={() => setEditing((e) => !e)}>
                  <Pencil className="h-3 w-3" aria-hidden /> {editing ? "Done" : "Not right?"}
                </button>
              </div>
              {detection?.issues.map((i) => (
                <p key={i} className="mt-2 flex items-start gap-1.5 text-xs text-warn">
                  <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                  {CLASSIFICATION_ISSUES[i]}
                </p>
              ))}
              {(editing || !detection || !confident) && (
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    {CATEGORY_LIST.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => pickCategory(c.id)}
                        data-active={category === c.id}
                        data-testid={`category-${c.id}`}
                        className="card flex items-center gap-2 p-2 text-sm transition data-[active=true]:border-ink data-[active=true]:ring-1 data-[active=true]:ring-ink"
                      >
                        <CategoryIcon icon={c.icon} className="h-4 w-4" /> {c.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Product type">
                    {cat.productTypes.map((t) => (
                      <button
                        key={t.id}
                        role="radio"
                        aria-checked={productTypeId === t.id}
                        className="chip"
                        data-active={productTypeId === t.id}
                        data-testid={`type-${t.id}`}
                        onClick={() => setProductTypeId(productTypeId === t.id ? null : t.id)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {(mismatch || unsupported) && (
                <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-warn" data-testid="detection-mismatch">
                  <p className="flex gap-2">
                    <CircleHelp className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>
                      {unsupported
                        ? `This doesn’t look like clothing or jewellery${detection!.description ? ` (we see: ${detection!.description})` : ""}.`
                        : `This photo looks like ${detection!.description || "a different product"}. We’ll use what we see for accurate results.`}
                    </span>
                  </p>
                  <label className="mt-2 flex items-center gap-2 text-ink">
                    <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} data-testid="override-detection" />
                    {unsupported ? "Generate anyway" : "I’m sure — use my choice"}
                  </label>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ---- Look ---- */}
        <div>
          <h2 className="mb-2 font-ui text-sm font-semibold tracking-normal">Pick a look</h2>
          <div className="grid gap-2" role="radiogroup" aria-label="Look">
            {looks.map((l) => (
              <button
                key={l.id}
                role="radio"
                aria-checked={look === l.id}
                data-active={look === l.id}
                data-testid={`look-${l.id}`}
                onClick={() => {
                  setLook(l.id);
                  setBackdrop(null);
                }}
                className="card p-3 text-left transition data-[active=true]:border-brand data-[active=true]:bg-brand-soft"
              >
                <p className="font-medium">{l.label}</p>
                <p className="text-xs text-ink-2">{l.description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* ---- Backdrop ---- */}
        <div>
          <h2 className="mb-2 font-ui text-sm font-semibold tracking-normal">Backdrop</h2>
          <div className="grid grid-cols-6 gap-2" role="radiogroup" aria-label="Backdrop">
            {backdrops.map((b) => (
              <button
                key={b.id}
                role="radio"
                aria-checked={selectedBackdrop === b.id}
                aria-label={b.label}
                title={b.label}
                data-active={selectedBackdrop === b.id}
                onClick={() => setBackdrop(b.id)}
                className="group flex flex-col items-center gap-1"
              >
                <span
                  className="block h-10 w-10 rounded-full border border-line ring-offset-2 group-data-[active=true]:ring-2 group-data-[active=true]:ring-brand"
                  style={{ background: b.swatch }}
                />
                <span className="text-[10px] text-ink-2">{b.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ---- Size ---- */}
        <div>
          <h2 className="mb-2 font-ui text-sm font-semibold tracking-normal">Size</h2>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Size">
            {SIZES.map((s) => (
              <button
                key={s.id}
                role="radio"
                aria-checked={size === s.id}
                data-active={size === s.id}
                onClick={() => setSize(s.id)}
                className="card p-2 text-center transition data-[active=true]:border-ink data-[active=true]:ring-1 data-[active=true]:ring-ink"
              >
                <span className="block text-sm font-medium">{s.label}</span>
                <span className="block text-[10px] leading-tight text-ink-2">{s.use}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="sticky bottom-0 -mx-1 bg-bg/95 px-1 pb-2 pt-2 backdrop-blur lg:static lg:bg-transparent">
          {notice && (
            <p className="mb-2 flex gap-2 rounded-lg bg-navy-soft p-3 text-sm text-navy" data-testid="correction-notice">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>Auto-corrected from your photo: {notice.map(describeCorrection).join("; ")}.</span>
            </p>
          )}
          {error && (
            <p className="mb-2 rounded-lg bg-red-50 p-3 text-sm text-err" data-testid="studio-error">
              {error.message}{" "}
              {error.topup && (
                <Link href="/credits" className="font-medium underline">
                  Buy credits <ArrowRight className="inline h-3.5 w-3.5 align-[-2px]" aria-hidden />
                </Link>
              )}
            </p>
          )}
          <button className="btn-brand w-full py-3 text-base" disabled={!canGenerate} onClick={generate} data-testid="generate">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
            {submitting ? "Starting…" : !asset ? "Upload a photo to start" : `Generate · ${COST} credits`}
          </button>
          <p className="mt-2 text-center text-xs text-ink-2">
            Balance: {credits} credits{credits < COST && asset ? " — " : ""}
            {credits < COST && asset && (
              <Link href="/credits" className="font-medium text-brand underline">
                top up
              </Link>
            )}
            {activeCount > 0 && ` · ${activeCount} in progress`}
          </p>
        </div>
      </section>

      <section id="results" className="min-w-0 scroll-mt-20 space-y-4">
        {gens.length === 0 ? <EmptyState /> : gens.map((g) => <GenerationCard key={g.id} gen={g} onRerun={rerun} />)}
      </section>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="relative isolate grid min-h-[460px] place-items-center overflow-hidden rounded-3xl border border-line p-8 text-center">
      <Image src={SITE_IMAGES.studioEmpty.src} alt="" fill sizes="(min-width: 1024px) 60vw, 100vw" className="-z-10 object-cover" />
      <div className="max-w-sm rounded-2xl bg-surface/90 p-6 backdrop-blur">
        <p className="font-display text-3xl">
          Your shots <span className="italic text-brand">appear here</span>
        </p>
        <p className="mt-2 text-sm text-ink-2">Upload a photo, pick a look and tap Generate. Ready for WhatsApp, Instagram and your store.</p>
      </div>
    </div>
  );
}

function PreparationStatus({ prep }: { prep: UploadedAsset["preparation"] }) {
  if (prep.status === "none") return null;
  if (prep.status === "pending") {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-2" data-testid="prep-status" data-status="pending">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Cleaning your photo — pick a look meanwhile
      </p>
    );
  }
  if (prep.status === "failed") {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-2" data-testid="prep-status" data-status="failed">
        <Info className="h-3.5 w-3.5" aria-hidden />
        Using your original photo as-is
      </p>
    );
  }
  return (
    <p className="mt-2 flex items-center gap-1.5 text-xs text-ok" data-testid="prep-status" data-status="ready">
      <CircleCheck className="h-3.5 w-3.5" aria-hidden />
      Photo cleaned · product left untouched
    </p>
  );
}
