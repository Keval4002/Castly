/**
 * Product preview shown over the hero: the Studio with one red dress turned
 * into four catalogue shots. Illustrated (SVG) so it ships without photos.
 */

const NAVY = "#2b2f78";

function Model({ skin = "#c98a63", pose = 0 }: { skin?: string; pose?: number }) {
  return (
    <g transform={`translate(60 18) rotate(${pose} 0 90)`}>
      {/* hair + head */}
      <ellipse cx="0" cy="14" rx="11" ry="12" fill="#2a1b17" />
      <circle cx="0" cy="16" r="9" fill={skin} />
      <path d="M-11 12 Q0 -2 11 12 Q8 4 0 4 Q-8 4 -11 12 Z" fill="#2a1b17" />
      <rect x="-3" y="24" width="6" height="7" fill={skin} />
      {/* arms */}
      <path d="M-14 36 Q-22 58 -18 78" stroke={skin} strokeWidth="5" strokeLinecap="round" fill="none" />
      <path d="M14 36 Q22 58 18 78" stroke={skin} strokeWidth="5" strokeLinecap="round" fill="none" />
      {/* the product: red A-line dress with gold buti */}
      <path d="M-11 30 L11 30 L15 46 L30 128 L-30 128 L-15 46 Z" fill="#b91c1c" />
      <path d="M-11 30 Q0 37 11 30" stroke="#7f1d1d" strokeWidth="2" fill="none" />
      <g fill="#fde68a">
        {[
          [-6, 52],
          [6, 60],
          [-12, 72],
          [2, 78],
          [14, 88],
          [-18, 96],
          [-4, 100],
          [10, 108],
          [-20, 116],
          [22, 118],
          [0, 120],
        ].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="1.6" />
        ))}
      </g>
      {/* legs */}
      <path d="M-8 128 V150 M8 128 V150" stroke={skin} strokeWidth="5" strokeLinecap="round" />
      <path d="M-12 151 h8 M4 151 h8" stroke="#2a1b17" strokeWidth="4" strokeLinecap="round" />
    </g>
  );
}

const TILES = [
  {
    label: "Studio white",
    bg: (
      <>
        <rect width="120" height="170" fill="#f7f6f3" />
        <ellipse cx="60" cy="168" rx="40" ry="5" fill="#000" opacity="0.07" />
      </>
    ),
    skin: "#c98a63",
    pose: 0,
  },
  {
    label: "City street",
    bg: (
      <>
        <rect width="120" height="170" fill="#c9d3df" />
        <rect x="-4" y="20" width="34" height="120" fill="#aab6c6" />
        <rect x="88" y="10" width="40" height="130" fill="#b4bfcd" />
        <g fill="#e8eef5" opacity="0.8">
          <rect x="4" y="34" width="8" height="10" />
          <rect x="16" y="34" width="8" height="10" />
          <rect x="4" y="54" width="8" height="10" />
          <rect x="96" y="26" width="8" height="10" />
          <rect x="108" y="26" width="8" height="10" />
        </g>
        <rect y="140" width="120" height="30" fill="#8d97a6" />
      </>
    ),
    skin: "#a8704d",
    pose: -3,
  },
  {
    label: "Heritage haveli",
    bg: (
      <>
        <rect width="120" height="170" fill="#f3c9a0" />
        <path d="M10 170 V70 Q60 10 110 70 V170 Z" fill="#e7a978" />
        <path d="M24 170 V78 Q60 34 96 78 V170 Z" fill="#fbe2c4" />
        <rect y="150" width="120" height="20" fill="#d99566" />
      </>
    ),
    skin: "#b77c55",
    pose: 2,
  },
  {
    label: "Festive glow",
    bg: (
      <>
        <rect width="120" height="170" fill="#3b2a52" />
        {Array.from({ length: 14 }, (_, i) => (
          <circle key={i} cx={(i * 37) % 120} cy={18 + ((i * 53) % 90)} r={3 + (i % 3)} fill="#fbbf24" opacity="0.55" />
        ))}
        <path d="M0 10 Q60 40 120 10" stroke="#f59e0b" strokeWidth="1.5" fill="none" />
        <rect y="146" width="120" height="24" fill="#2a1d3d" />
      </>
    ),
    skin: "#c98a63",
    pose: -1,
  },
];

function Tile({ t }: { t: (typeof TILES)[number] }) {
  return (
    <figure className="relative overflow-hidden rounded-xl border border-line bg-surface-2">
      <svg viewBox="0 0 120 170" className="block w-full">
        {t.bg}
        <Model skin={t.skin} pose={t.pose} />
      </svg>
      <figcaption className="absolute bottom-2 left-2 rounded-full bg-white/90 px-2 py-0.5 font-ui text-[10px] font-medium text-ink">
        {t.label}
      </figcaption>
    </figure>
  );
}

export function HeroPreview() {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/60 bg-surface shadow-[0_30px_80px_-20px_rgba(31,34,89,0.45)]">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#f87171]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#fbbf24]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#4ade80]" />
        <span className="ml-3 font-ui text-xs font-medium text-ink-2">Studio · Dukaanshot</span>
        <span className="ml-auto rounded-full bg-brand-soft px-2.5 py-0.5 font-ui text-[11px] font-medium text-brand">
          ● 42 credits
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[230px_1fr]">
        <aside className="hidden space-y-3 border-r border-line p-4 text-left md:block">
          <div className="flex items-center gap-3">
            <div className="h-14 w-12 overflow-hidden rounded-lg border border-line bg-[#f4f1ec]">
              <svg viewBox="0 0 120 170">
                <path d="M47 30 L73 30 L78 50 L95 150 L25 150 L42 50 Z" fill="#b91c1c" />
              </svg>
            </div>
            <div>
              <p className="font-ui text-xs font-semibold text-ink">red-dress.jpg</p>
              <p className="font-ui text-[11px] text-ok">Detected: Dress · 96% ✓</p>
            </div>
          </div>
          <PreviewGroup label="Look" items={["Marketplace", "Lifestyle", "Festive"]} active={1} />
          <PreviewGroup label="Model" items={["Woman", "Man", "Kid"]} active={0} />
          <PreviewGroup label="Format" items={["1:1", "4:5", "9:16"]} active={1} />
          <div className="rounded-full bg-brand py-2 text-center font-ui text-xs font-semibold text-white">
            Generate 4 images · 8 credits
          </div>
        </aside>
        <div className="grid grid-cols-2 gap-2.5 p-3 sm:grid-cols-4 sm:p-4">
          {TILES.map((t) => (
            <Tile key={t.label} t={t} />
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
            style={i === active ? { borderColor: NAVY } : undefined}
          >
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}
