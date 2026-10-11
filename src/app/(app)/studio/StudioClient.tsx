"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useCredits } from "@/components/CreditsProvider";
import { GenerationCard } from "@/components/GenerationCard";
import {
  ASPECT_RATIOS,
  CATEGORIES,
  CATEGORY_LIST,
  defaultValues,
  isGroupVisible,
  type AspectRatioId,
  type CategoryId,
  type OptionGroup,
} from "@/lib/catalog/options";
import { ApiError, apiFetch, compressImage } from "@/lib/client/fetcher";
import { isActive, type GenerationDTO } from "@/lib/client/types";
import { useGenerationPolling } from "@/lib/client/usePolling";
import { DEFAULT_TIER, generationCost, MAX_VARIANTS, TIER_ORDER, TIERS, type TierId } from "@/lib/pricing";

interface UploadedAsset {
  id: string;
  thumbUrl: string;
  url: string;
  width: number;
  height: number;
}

export function StudioClient({
  tierAvailability,
  initial,
}: {
  tierAvailability: Record<TierId, boolean>;
  initial: GenerationDTO[];
}) {
  const { credits, setCredits } = useCredits();
  const [asset, setAsset] = useState<UploadedAsset | null>(null);
  const [uploading, setUploading] = useState(false);
  const [category, setCategory] = useState<CategoryId>("clothing");
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...defaultValues("clothing"),
    ...CATEGORIES.clothing.presets[0].values,
  }));
  const [presetId, setPresetId] = useState<string | null>(CATEGORIES.clothing.presets[0].id);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [ratio, setRatio] = useState<AspectRatioId>("1:1");
  const firstAvailable = TIER_ORDER.find((t) => tierAvailability[t]) ?? DEFAULT_TIER;
  const [tier, setTier] = useState<TierId>(tierAvailability[DEFAULT_TIER] ? DEFAULT_TIER : firstAvailable);
  const [count, setCount] = useState(2);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; topup?: boolean } | null>(null);
  const [gens, setGens] = useState<GenerationDTO[]>(initial);
  const fileInput = useRef<HTMLInputElement>(null);

  useGenerationPolling(gens, setGens);

  const cat = CATEGORIES[category];
  const visibleGroups = cat.groups.filter((g) => isGroupVisible(g, values));
  const basic = visibleGroups.filter((g) => !g.advanced);
  const advanced = visibleGroups.filter((g) => g.advanced);
  const cost = generationCost(tier, count);
  const activeCount = gens.filter(isActive).length;

  const canGenerate = Boolean(asset) && !uploading && !submitting && tierAvailability[tier];

  function pickCategory(id: CategoryId) {
    setCategory(id);
    const preset = CATEGORIES[id].presets[0];
    setValues({ ...defaultValues(id), ...preset.values });
    setPresetId(preset.id);
  }

  function applyPreset(id: string) {
    const preset = cat.presets.find((p) => p.id === id);
    if (!preset) return;
    setValues({ ...defaultValues(category), ...preset.values });
    setPresetId(id);
  }

  function setOption(group: string, choice: string) {
    setValues((v) => ({ ...v, [group]: choice }));
    setPresetId(null);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const blob = await compressImage(file);
      const form = new FormData();
      form.append("file", blob, "product.jpg");
      const { asset } = await apiFetch<{ asset: UploadedAsset }>("/api/uploads", { method: "POST", body: form });
      setAsset(asset);
    } catch (err) {
      setError({ message: (err as Error).message });
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function submit(body: {
    sourceAssetId: string;
    category: string;
    options: Record<string, string>;
    aspectRatio: string;
    tier: string;
    count: number;
    customNote?: string;
  }) {
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch<{ generation: GenerationDTO; balance: number }>("/api/generations", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setGens((g) => [res.generation, ...g]);
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
      options: values,
      aspectRatio: ratio,
      tier,
      count,
      customNote: note.trim() || undefined,
    });
  }

  function rerun(g: GenerationDTO) {
    if (!g.source) return;
    void submit({
      sourceAssetId: g.source.id,
      category: g.category,
      options: g.options,
      aspectRatio: g.aspectRatio,
      tier: g.tier,
      count: g.count,
      customNote: g.customNote ?? undefined,
    });
  }

  return (
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-[420px_minmax(0,1fr)]">
      {/* ---------- Controls ---------- */}
      <section className="min-w-0 space-y-5 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pb-4 lg:pr-2">
        <Step n={1} title="Product photo">
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
              <img src={asset.thumbUrl} alt="Your product" className="h-20 w-20 rounded-xl object-cover" data-testid="upload-preview" />
            ) : (
              <div className={`grid h-20 w-20 place-items-center rounded-xl bg-surface-2 text-2xl ${uploading ? "shimmer" : ""}`}>
                {uploading ? "" : "＋"}
              </div>
            )}
            <div className="text-sm">
              <p className="font-medium">{uploading ? "Uploading…" : asset ? "Change photo" : "Upload a product photo"}</p>
              <p className="text-ink-2">Clear, well-lit photo of one product. JPG/PNG, any phone photo works.</p>
            </div>
          </div>
        </Step>

        <Step n={2} title="What are you selling?">
          <div className="grid grid-cols-2 gap-2">
            {CATEGORY_LIST.map((c) => (
              <button
                key={c.id}
                onClick={() => pickCategory(c.id)}
                data-active={category === c.id}
                data-testid={`category-${c.id}`}
                className="card p-3 text-left transition data-[active=true]:border-ink data-[active=true]:ring-1 data-[active=true]:ring-ink"
              >
                <span className="text-xl">{c.emoji}</span>
                <p className="mt-1 font-medium">{c.label}</p>
                <p className="text-xs text-ink-2">{c.description}</p>
              </button>
            ))}
          </div>
        </Step>

        <Step n={3} title="Pick a look">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {cat.presets.map((p) => (
              <button
                key={p.id}
                onClick={() => applyPreset(p.id)}
                data-active={presetId === p.id}
                className="card min-w-[150px] p-3 text-left text-sm transition data-[active=true]:border-brand data-[active=true]:bg-brand-soft"
              >
                <p className="font-medium">{p.label}</p>
                <p className="mt-0.5 text-xs text-ink-2">{p.description}</p>
              </button>
            ))}
          </div>
          <div className="mt-4 space-y-4">
            {basic.map((g) => (
              <Group key={g.id} group={g} value={values[g.id]} onChange={(v) => setOption(g.id, v)} />
            ))}
            {advanced.length > 0 && (
              <button className="text-sm font-medium text-brand" onClick={() => setShowAdvanced((s) => !s)}>
                {showAdvanced ? "− Fewer options" : `+ More options (${advanced.map((g) => g.label.toLowerCase()).join(", ")})`}
              </button>
            )}
            {showAdvanced &&
              advanced.map((g) => <Group key={g.id} group={g} value={values[g.id]} onChange={(v) => setOption(g.id, v)} />)}
            <div>
              <label className="label" htmlFor="note">
                Extra direction <span className="font-normal normal-case text-ink-3">(optional)</span>
              </label>
              <textarea
                id="note"
                className="input min-h-[64px] resize-y"
                maxLength={300}
                placeholder="e.g. model with long wavy hair, holding a coffee cup"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
        </Step>

        <Step n={4} title="Output">
          <label className="label">Format</label>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-3">
            {ASPECT_RATIOS.map((a) => (
              <button
                key={a.id}
                onClick={() => setRatio(a.id)}
                data-active={ratio === a.id}
                className="card flex flex-col items-center gap-1 p-2 text-center transition data-[active=true]:border-ink data-[active=true]:ring-1 data-[active=true]:ring-ink"
              >
                <span
                  className="block rounded-sm border border-ink-3 bg-surface-2"
                  style={{ width: a.width >= a.height ? 28 : (28 * a.width) / a.height, height: a.height >= a.width ? 28 : (28 * a.height) / a.width }}
                />
                <span className="text-xs font-medium">{a.id}</span>
                <span className="text-[10px] leading-tight text-ink-2">{a.useCase}</span>
              </button>
            ))}
          </div>

          <label className="label mt-4">Variations</label>
          <div className="flex gap-2">
            {Array.from({ length: MAX_VARIANTS }, (_, i) => i + 1).map((n) => (
              <button key={n} className="chip w-12" data-active={count === n} onClick={() => setCount(n)} data-testid={`count-${n}`}>
                {n}
              </button>
            ))}
          </div>

          <label className="label mt-4">Quality</label>
          <div className="space-y-2">
            {TIER_ORDER.map((t) => (
              <button
                key={t}
                disabled={!tierAvailability[t]}
                onClick={() => setTier(t)}
                data-active={tier === t}
                data-testid={`tier-${t}`}
                className="card flex w-full items-center gap-3 p-3 text-left transition disabled:opacity-40 data-[active=true]:border-ink data-[active=true]:ring-1 data-[active=true]:ring-ink"
              >
                <div className="flex-1">
                  <p className="text-sm font-medium">
                    {TIERS[t].label} <span className="font-normal text-ink-3">· {TIERS[t].eta}</span>
                  </p>
                  <p className="text-xs text-ink-2">{tierAvailability[t] ? TIERS[t].tagline : "Unavailable right now"}</p>
                </div>
                <span className="whitespace-nowrap text-sm font-semibold">
                  {TIERS[t].creditsPerImage} cr<span className="font-normal text-ink-2">/img</span>
                </span>
              </button>
            ))}
          </div>
        </Step>

        <div className="sticky bottom-0 -mx-1 bg-bg/95 px-1 pb-2 pt-2 backdrop-blur lg:static lg:bg-transparent">
          {error && (
            <p className="mb-2 rounded-lg bg-red-50 p-3 text-sm text-err" data-testid="studio-error">
              {error.message}{" "}
              {error.topup && (
                <Link href="/credits" className="font-medium underline">
                  Buy credits →
                </Link>
              )}
            </p>
          )}
          <button className="btn-brand w-full py-3 text-base" disabled={!canGenerate} onClick={generate} data-testid="generate">
            {submitting
              ? "Starting…"
              : !asset
                ? "Upload a photo to start"
                : `Generate ${count} image${count > 1 ? "s" : ""} · ${cost} credit${cost > 1 ? "s" : ""}`}
          </button>
          <p className="mt-2 text-center text-xs text-ink-2">
            Balance: {credits} credits{credits < cost && asset ? " — " : ""}
            {credits < cost && asset && (
              <Link href="/credits" className="font-medium text-brand underline">
                top up
              </Link>
            )}
            {activeCount > 0 && ` · ${activeCount} batch${activeCount > 1 ? "es" : ""} in progress`}
          </p>
        </div>
      </section>

      {/* ---------- Results ---------- */}
      <section id="results" className="min-w-0 space-y-4 scroll-mt-20">
        {gens.length === 0 ? <EmptyState /> : gens.map((g) => <GenerationCard key={g.id} gen={g} onRerun={rerun} />)}
      </section>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-ink text-xs text-white">{n}</span>
        {title}
      </h2>
      {children}
    </div>
  );
}

function Group({ group, value, onChange }: { group: OptionGroup; value: string; onChange: (v: string) => void }) {
  const id = useMemo(() => `g-${group.id}`, [group.id]);
  return (
    <div role="radiogroup" aria-labelledby={id}>
      <span id={id} className="label">
        {group.label}
      </span>
      <div className="flex flex-wrap gap-2">
        {group.choices.map((c) => (
          <button
            key={c.id}
            role="radio"
            aria-checked={value === c.id}
            className="chip"
            data-active={value === c.id}
            onClick={() => onChange(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="card grid min-h-[420px] place-items-center p-8 text-center">
      <div className="max-w-sm">
        <p className="font-display text-3xl">Your catalogue shots appear here</p>
        <p className="mt-2 text-sm text-ink-2">
          Upload one product photo, pick a look and hit generate. Each run creates fresh, unique variations — ready for
          WhatsApp, Instagram and your store.
        </p>
      </div>
    </div>
  );
}
