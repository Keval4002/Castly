import { CircleCheck, Coins, Sparkles } from "lucide-react";
import Image from "next/image";
import { SHOWCASE_LABELS, SITE_IMAGES } from "@/lib/site-images";

/**
 * Product preview shown over the hero: the Studio turning one product photo
 * into four catalogue shots. Images come from public/images/showcase.
 */
export function HeroPreview() {
  const input = SITE_IMAGES.showcaseInput;
  return (
    <div className="overflow-hidden rounded-2xl border border-white/60 bg-surface text-left shadow-[0_30px_80px_-20px_rgba(31,34,89,0.45)]">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#f87171]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#fbbf24]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#4ade80]" />
        <span className="ml-3 font-ui text-xs font-medium text-ink-2">Studio · Dukaanshot</span>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-0.5 font-ui text-[11px] font-medium text-brand">
          <Coins className="h-3 w-3" aria-hidden /> 42 credits
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[230px_1fr]">
        <aside className="hidden space-y-3 border-r border-line p-4 md:block">
          <div className="flex items-center gap-3">
            <div className="relative h-14 w-12 overflow-hidden rounded-lg border border-line bg-surface-2">
              <Image src={input.src} alt={input.alt} fill sizes="48px" className="object-cover" />
            </div>
            <div>
              <p className="font-ui text-xs font-semibold text-ink">product-photo.jpg</p>
              <p className="inline-flex items-center gap-1 font-ui text-[11px] text-ok">
                <CircleCheck className="h-3 w-3" aria-hidden /> Detected: Dress · 96%
              </p>
            </div>
          </div>
          <PreviewGroup label="Look" items={["Marketplace", "Lifestyle", "Festive"]} active={1} />
          <PreviewGroup label="Model" items={["Woman", "Man", "Kid"]} active={0} />
          <PreviewGroup label="Format" items={["1:1", "4:5", "9:16"]} active={1} />
          <div className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-brand py-2 font-ui text-xs font-semibold text-white">
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> Generate 4 images · 8 credits
          </div>
        </aside>
        <div className="grid grid-cols-2 gap-2.5 p-3 sm:grid-cols-4 sm:p-4">
          {SITE_IMAGES.showcaseOutputs.map((img, i) => (
            <figure key={img.src} className="relative aspect-[4/5] overflow-hidden rounded-xl border border-line bg-surface-2">
              <Image src={img.src} alt={img.alt} fill sizes="(min-width: 768px) 200px, 45vw" className="object-cover" />
              <figcaption className="absolute bottom-2 left-2 rounded-full bg-white/90 px-2 py-0.5 font-ui text-[10px] font-medium text-ink">
                {SHOWCASE_LABELS[i]}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </div>
  );
}

function PreviewGroup({ label, items, active }: { label: string; items: string[]; active: number }) {
  return (
    <div>
      <p className="mb-1.5 font-ui text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it, i) => (
          <span
            key={it}
            className={`rounded-full border px-2.5 py-1 font-ui text-[11px] ${
              i === active ? "border-navy bg-navy text-white" : "border-line text-ink-2"
            }`}
          >
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}
