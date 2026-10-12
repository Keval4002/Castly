import Link from "next/link";
import { BazaarScene, Toran } from "@/components/brand/BazaarScene";
import { HeroPreview } from "@/components/brand/HeroPreview";
import { Logo } from "@/components/Logo";
import { CATEGORY_LIST } from "@/lib/catalog/options";
import { CREDIT_PACKS, formatINR, SIGNUP_BONUS_CREDITS, TIER_ORDER, TIERS } from "@/lib/pricing";

const NAV = [
  { href: "#how", label: "How it works" },
  { href: "#categories", label: "Categories" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

const STEPS = [
  { title: "Upload one photo", body: "Any clear phone photo — on a hanger, on the floor or on the counter. We detect what it is." },
  { title: "Pick a look", body: "On-model, flat lay, luxury velvet, festive… one tap presets, or fine-tune model, pose and setting." },
  { title: "Share & sell", body: "Unique, catalogue-ready images sized for WhatsApp, Instagram and your store — in seconds." },
];

const CHANNELS = ["WhatsApp Business", "Instagram", "Meesho", "Amazon", "Flipkart", "Shopify"];

const FAQ = [
  {
    q: "Will the product look exactly like mine?",
    a: "Dukaanshot keeps your product’s colour, print, embroidery, metal and stones intact and only changes the model, setting and lighting. Clear, well-lit photos give the best results.",
  },
  {
    q: "What if I pick the wrong product type?",
    a: "We detect the product in your photo. If it’s clearly a necklace and you picked clothing, we fix it for you and tell you — or you can confirm your own choice.",
  },
  {
    q: "What happens if an image fails?",
    a: "You only pay for images that are delivered. Failed images are refunded to your balance automatically.",
  },
  {
    q: "Can I use the images commercially?",
    a: "Yes — images you generate are yours to use in your catalogue, ads, website and social media.",
  },
  { q: "Do credits expire?", a: "No. Pay once with UPI, card or netbanking and use them whenever you need." },
];

export default function Landing() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* ---------- Hero ---------- */}
      <section className="px-2 pt-2 sm:px-4 sm:pt-4">
        <div className="relative isolate overflow-hidden rounded-[28px] sm:rounded-[36px]">
          <BazaarScene className="absolute inset-0 -z-20 h-full w-full" />
          <div className="hero-grid absolute inset-0 -z-10" />
          <Toran className="pointer-events-none absolute inset-x-0 top-[72px] -z-10 h-12 w-full sm:top-[92px] sm:h-[72px]" />

          {/* floating pill nav */}
          <header className="relative z-10 flex justify-center px-3 pt-4 sm:pt-6">
            <nav className="flex w-full max-w-4xl items-center gap-2 rounded-full border border-white/70 bg-white/80 py-2 pl-4 pr-2 shadow-[0_8px_30px_-12px_rgba(31,34,89,0.35)] backdrop-blur-md">
              <Logo size="sm" />
              <div className="mx-auto hidden items-center gap-1 md:flex">
                {NAV.map((n) => (
                  <a key={n.href} href={n.href} className="rounded-full px-3 py-1.5 font-ui text-sm text-ink-2 hover:bg-surface-2 hover:text-ink">
                    {n.label}
                  </a>
                ))}
              </div>
              <div className="ml-auto flex items-center gap-1.5 md:ml-0">
                <Link href="/login" className="rounded-full px-3 py-2 font-ui text-sm font-medium text-ink hover:bg-surface-2">
                  Sign in
                </Link>
                <Link href="/login" className="btn-primary px-4 py-2">
                  Start free
                </Link>
              </div>
            </nav>
          </header>

          <div className="relative px-4 pb-0 pt-20 text-center sm:pt-28">
            <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/70 px-3 py-1 font-ui text-xs font-medium text-navy backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" /> For clothing & jewellery sellers
            </p>
            <h1 className="mx-auto mt-6 max-w-5xl font-display text-[2.35rem] leading-[1.12] text-ink sm:text-6xl lg:text-7xl">
              Shoot your <span className="mark-orange whitespace-nowrap">whole catalogue</span>
              <br />
              <span className="mark-navy whitespace-nowrap">studio‑ready</span> from one photo.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base text-ink-2 sm:text-lg">
              Models, settings and lighting for every product in your dukaan — generated in seconds for WhatsApp Business,
              Instagram and your store. No photographer, no studio.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3">
              <Link href="/login" className="btn-brand px-7 py-3.5 text-base" data-testid="hero-cta">
                Try free — {SIGNUP_BONUS_CREDITS} credits <span aria-hidden>»</span>
              </Link>
              <p className="font-ui text-xs text-ink-2">No card needed · Pay with UPI when you need more</p>
            </div>

            <div className="float-slow relative mx-auto -mb-10 mt-12 max-w-5xl sm:mt-16">
              <HeroPreview />
            </div>
          </div>
        </div>
      </section>

      <main className="flex-1">
        {/* channels */}
        <section className="mx-auto max-w-5xl px-4 pt-14 text-center">
          <p className="label">Made for sellers on</p>
          <div className="mt-3 flex flex-wrap justify-center gap-x-8 gap-y-2 font-ui text-lg font-medium text-ink-3">
            {CHANNELS.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
        </section>

        {/* how it works */}
        <section id="how" className="mx-auto max-w-6xl scroll-mt-8 px-4 py-20">
          <p className="label text-brand">How it works</p>
          <h2 className="max-w-2xl text-4xl sm:text-5xl">
            Catalogue shoots, <span className="italic text-brand">minus the shoot</span>
          </h2>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <div key={s.title} className="card p-6">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-navy font-ui text-sm font-semibold text-white">
                  {i + 1}
                </span>
                <h3 className="mt-4 text-2xl">{s.title}</h3>
                <p className="mt-2 text-ink-2">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* categories */}
        <section id="categories" className="scroll-mt-8 border-y border-line bg-surface py-20">
          <div className="mx-auto max-w-6xl px-4">
            <p className="label text-brand">Categories</p>
            <h2 className="text-4xl sm:text-5xl">
              Made for what <span className="italic text-navy">you sell</span>
            </h2>
            <div className="mt-10 grid gap-4 md:grid-cols-2">
              {CATEGORY_LIST.map((c) => (
                <div key={c.id} className="rounded-3xl border border-line bg-bg p-7">
                  <p className="text-3xl">{c.emoji}</p>
                  <h3 className="mt-2 text-3xl">{c.label}</h3>
                  <p className="text-ink-2">{c.description}</p>
                  <p className="label mt-5">Looks</p>
                  <div className="flex flex-wrap gap-2">
                    {c.presets.map((p) => (
                      <span key={p.id} className="rounded-full bg-brand-soft px-3 py-1 font-ui text-xs font-medium text-brand">
                        {p.label}
                      </span>
                    ))}
                  </div>
                  <p className="label mt-4">Detects</p>
                  <p className="font-ui text-sm text-ink-2">
                    {c.productTypes
                      .filter((t) => !t.id.startsWith("other"))
                      .map((t) => t.label)
                      .join(" · ")}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* pricing */}
        <section id="pricing" className="mx-auto max-w-6xl scroll-mt-8 px-4 py-20">
          <p className="label text-brand">Pricing</p>
          <h2 className="text-4xl sm:text-5xl">
            Pay as you go. <span className="italic text-navy">No subscriptions.</span>
          </h2>
          <p className="mt-3 text-ink-2">
            Start with {SIGNUP_BONUS_CREDITS} free credits. Top up any time — credits never expire.
          </p>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {CREDIT_PACKS.map((p) => (
              <div
                key={p.id}
                className={`relative rounded-3xl border p-7 ${
                  p.badge === "Popular" ? "border-navy bg-navy text-white" : "border-line bg-surface"
                }`}
              >
                {p.badge && (
                  <span className="absolute -top-3 left-7 rounded-full bg-brand px-3 py-0.5 font-ui text-xs font-semibold text-white">
                    {p.badge}
                  </span>
                )}
                <p className={`font-ui text-sm ${p.badge === "Popular" ? "text-white/70" : "text-ink-2"}`}>{p.label}</p>
                <p className="mt-2 font-display text-5xl">{formatINR(p.amountPaise)}</p>
                <p className={`font-ui ${p.badge === "Popular" ? "text-white/80" : "text-ink-2"}`}>{p.credits} credits</p>
              </div>
            ))}
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {TIER_ORDER.map((t) => (
              <div key={t} className="rounded-2xl bg-surface-2 p-4">
                <p className="font-ui font-semibold">
                  {TIERS[t].label}{" "}
                  <span className="font-normal text-ink-2">
                    · {TIERS[t].creditsPerImage} credit{TIERS[t].creditsPerImage > 1 ? "s" : ""}/image
                  </span>
                </p>
                <p className="text-sm text-ink-2">{TIERS[t].tagline}</p>
              </div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="mx-auto max-w-3xl scroll-mt-8 px-4 pb-20">
          <h2 className="text-4xl sm:text-5xl">Questions</h2>
          <div className="mt-6 divide-y divide-line">
            {FAQ.map((f) => (
              <details key={f.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between font-ui text-lg font-medium">
                  {f.q}
                  <span className="ml-4 text-brand transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-2 text-ink-2">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* final CTA */}
        <section className="px-2 pb-4 sm:px-4">
          <div className="relative isolate overflow-hidden rounded-[28px] bg-navy px-6 py-16 text-center text-white sm:rounded-[36px]">
            <BazaarScene className="absolute inset-0 -z-10 h-full w-full opacity-25 mix-blend-luminosity" />
            <h2 className="mx-auto max-w-3xl text-4xl sm:text-6xl">
              Open your dukaan to <span className="italic text-marigold">better photos</span>.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-white/80">
              Your first {SIGNUP_BONUS_CREDITS / TIERS.standard.creditsPerImage} Studio images are on us.
            </p>
            <Link href="/login" className="btn-brand mt-8 px-7 py-3.5 text-base">
              Create my first catalogue shots <span aria-hidden>»</span>
            </Link>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8">
        <Logo size="sm" />
        <p className="font-ui text-xs text-ink-3">© {new Date().getFullYear()} Dukaanshot · AI catalogue photography for Indian sellers</p>
      </footer>
    </div>
  );
}
