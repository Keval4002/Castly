import Link from "next/link";
import { Logo } from "@/components/Logo";
import { CATEGORY_LIST } from "@/lib/catalog/options";
import { CREDIT_PACKS, formatINR, SIGNUP_BONUS_CREDITS, TIER_ORDER, TIERS } from "@/lib/pricing";

const STEPS = [
  { title: "Upload one photo", body: "Any clear phone photo of your product — on a hanger, the floor or a table." },
  { title: "Pick a look", body: "On-model, flat lay, luxury velvet, festive… choose a preset or fine-tune model, pose and setting." },
  { title: "Download & share", body: "Get multiple unique, catalogue-ready images sized for WhatsApp, Instagram and your store." },
];

const USES = [
  { title: "WhatsApp Business catalogue", body: "Square 1:1 images that look sharp in product listings and chats." },
  { title: "Instagram & Status", body: "4:5 posts and 9:16 stories without a photoshoot." },
  { title: "Website & marketplaces", body: "Clean white-background shots and wide banners for your storefront." },
];

const FAQ = [
  {
    q: "Will the product look exactly like mine?",
    a: "Castly is built to keep your product’s colour, print, embroidery, metal and stones intact while changing only the model, setting and lighting. Use clear, well-lit photos for best results.",
  },
  {
    q: "What happens if an image fails?",
    a: "You are only charged for images that are delivered. Failed images are refunded to your balance automatically.",
  },
  {
    q: "Can I use the images commercially?",
    a: "Yes — images you generate are yours to use in your catalogue, ads, website and social media.",
  },
  {
    q: "Do credits expire?",
    a: "No. Buy once with UPI, card or netbanking and use them whenever you need.",
  },
];

const TILE_GRADIENTS = [
  "from-orange-200 via-rose-100 to-amber-50",
  "from-stone-800 via-stone-700 to-stone-500",
  "from-emerald-100 via-teal-50 to-white",
  "from-amber-100 via-orange-50 to-white",
];

export default function Landing() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4">
        <Logo />
        <nav className="flex items-center gap-2">
          <a href="#pricing" className="hidden px-3 text-sm text-ink-2 hover:text-ink sm:block">
            Pricing
          </a>
          <Link href="/login" className="btn-ghost">
            Sign in
          </Link>
          <Link href="/login" className="btn-primary hidden sm:inline-flex">
            Start free
          </Link>
        </nav>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-10 md:grid-cols-2 md:pt-16">
          <div>
            <p className="inline-flex rounded-full bg-brand-soft px-3 py-1 text-xs font-medium text-brand">
              For clothing & jewellery sellers
            </p>
            <h1 className="mt-4 font-display text-5xl leading-[1.05] sm:text-6xl">
              One product photo.
              <br />
              <span className="italic text-brand">A whole catalogue.</span>
            </h1>
            <p className="mt-5 max-w-md text-lg text-ink-2">
              Castly turns a simple phone photo into on-model, lifestyle and luxury studio shots for your WhatsApp
              Business catalogue, Instagram and website — in seconds, no photoshoot needed.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/login" className="btn-brand px-6 py-3 text-base">
                Try free — {SIGNUP_BONUS_CREDITS} credits
              </Link>
              <a href="#how" className="btn-ghost px-6 py-3 text-base">
                See how it works
              </a>
            </div>
            <p className="mt-3 text-xs text-ink-3">No card required. Pay with UPI when you need more.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {["Model · full body", "Luxury velvet", "Lifestyle street", "Minimal marble"].map((label, i) => (
              <div
                key={label}
                className={`relative aspect-[4/5] overflow-hidden rounded-2xl bg-gradient-to-br ${TILE_GRADIENTS[i]} ${
                  i % 2 ? "translate-y-6" : ""
                }`}
              >
                <span
                  className={`absolute bottom-3 left-3 rounded-full px-3 py-1 text-xs font-medium ${
                    i === 1 ? "bg-white/15 text-white" : "bg-white/80 text-ink"
                  }`}
                >
                  {label}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="border-y border-line bg-surface py-16">
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="font-display text-4xl">Catalogue shoots, minus the shoot</h2>
            <div className="mt-8 grid gap-6 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <div key={s.title}>
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-ink text-sm font-semibold text-white">
                    {i + 1}
                  </span>
                  <h3 className="mt-3 font-medium">{s.title}</h3>
                  <p className="mt-1 text-sm text-ink-2">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Categories */}
        <section className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="font-display text-4xl">Made for what you sell</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {CATEGORY_LIST.map((c) => (
              <div key={c.id} className="card p-6">
                <p className="text-3xl">{c.emoji}</p>
                <h3 className="mt-2 text-xl font-medium">{c.label}</h3>
                <p className="text-sm text-ink-2">{c.description}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {c.presets.map((p) => (
                    <span key={p.id} className="rounded-full bg-surface-2 px-3 py-1 text-xs">
                      {p.label}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {USES.map((u) => (
              <div key={u.title} className="rounded-2xl bg-surface-2 p-5">
                <h3 className="font-medium">{u.title}</h3>
                <p className="mt-1 text-sm text-ink-2">{u.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="border-t border-line bg-surface py-16">
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="font-display text-4xl">Simple, pay-as-you-go pricing</h2>
            <p className="mt-2 text-ink-2">
              Start with {SIGNUP_BONUS_CREDITS} free credits. Top up any time — credits never expire.
            </p>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {CREDIT_PACKS.map((p) => (
                <div key={p.id} className={`card p-6 ${p.badge === "Popular" ? "border-brand ring-1 ring-brand" : ""}`}>
                  <p className="text-sm text-ink-2">{p.label}</p>
                  <p className="mt-1 text-3xl font-semibold">{formatINR(p.amountPaise)}</p>
                  <p className="text-sm text-ink-2">{p.credits} credits</p>
                </div>
              ))}
            </div>
            <div className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
              {TIER_ORDER.map((t) => (
                <div key={t} className="rounded-xl bg-surface-2 p-4">
                  <b>{TIERS[t].label}</b> · {TIERS[t].creditsPerImage} credit{TIERS[t].creditsPerImage > 1 ? "s" : ""}/image
                  <p className="text-xs text-ink-2">{TIERS[t].tagline}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="mx-auto max-w-3xl px-4 py-16">
          <h2 className="font-display text-4xl">Questions</h2>
          <div className="mt-6 divide-y divide-line">
            {FAQ.map((f) => (
              <details key={f.q} className="py-4">
                <summary className="cursor-pointer font-medium">{f.q}</summary>
                <p className="mt-2 text-sm text-ink-2">{f.a}</p>
              </details>
            ))}
          </div>
          <div className="mt-10 text-center">
            <Link href="/login" className="btn-brand px-6 py-3 text-base">
              Create my first catalogue shots
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line py-8 text-center text-xs text-ink-3">
        © {new Date().getFullYear()} Castly · AI catalogue photography
      </footer>
    </div>
  );
}
