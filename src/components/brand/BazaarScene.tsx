/**
 * Illustrated hero backdrop: a sunrise over soft hills, a little bazaar of
 * striped-awning shops (from the Dukaanshot mark), a festive toran and a
 * marigold meadow. Pure SVG — crisp at any size, no image request.
 * The centre is kept calm so headline and product preview sit on top.
 */

// Deterministic pseudo-random so server and client render identically.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const ORANGE = "#fa743c";
const CREAM = "#fbf3e3";
const NAVY = "#2b2f78";
const MARIGOLD = "#f6ad2f";

function Shop({ x, y, s, flip = false, aperture = false }: { x: number; y: number; s: number; flip?: boolean; aperture?: boolean }) {
  // A 100×90 shop drawn at origin, then placed + scaled.
  const stripes = Array.from({ length: 6 }, (_, i) => i);
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -s : s} ${s})`} strokeLinejoin="round">
      <rect x={6} y={30} width={88} height={60} fill={CREAM} stroke={NAVY} strokeWidth={2.5} />
      {/* awning */}
      {stripes.map((i) => (
        <path
          key={i}
          d={`M${2 + i * 16} 6 L${18 + i * 16} 6 L${18 + i * 16} 30 Q${10 + i * 16} 38 ${2 + i * 16} 30 Z`}
          fill={i % 2 ? CREAM : ORANGE}
          stroke={NAVY}
          strokeWidth={2.2}
        />
      ))}
      <rect x={0} y={1} width={100} height={6} rx={2} fill={NAVY} />
      {/* door + window */}
      <rect x={14} y={50} width={20} height={40} fill="#f1e4cb" stroke={NAVY} strokeWidth={2} />
      <circle cx={30} cy={70} r={1.8} fill={NAVY} />
      {aperture ? (
        <g transform="translate(64 64)">
          <circle r={16} fill="#fff" stroke={NAVY} strokeWidth={2.2} />
          {Array.from({ length: 8 }, (_, i) => (
            <path key={i} d="M0 -13 L5 -5" stroke={NAVY} strokeWidth={1.6} transform={`rotate(${i * 45})`} />
          ))}
          <circle r={5.5} fill={NAVY} />
        </g>
      ) : (
        <g>
          <rect x={46} y={46} width={38} height={26} fill="#fff6e6" stroke={NAVY} strokeWidth={2} />
          <path d="M65 46 V72 M46 59 H84" stroke={NAVY} strokeWidth={1.4} opacity={0.6} />
        </g>
      )}
    </g>
  );
}

function Marigold({ x, y, r, hue }: { x: number; y: number; r: number; hue: number }) {
  const outer = hue > 0.5 ? ORANGE : MARIGOLD;
  const inner = hue > 0.5 ? "#e0561f" : "#ea8d1a";
  return (
    <g>
      {Array.from({ length: 8 }, (_, i) => (
        <circle
          key={i}
          cx={x + Math.cos((i / 8) * Math.PI * 2) * r * 0.55}
          cy={y + Math.sin((i / 8) * Math.PI * 2) * r * 0.55}
          r={r * 0.55}
          fill={outer}
        />
      ))}
      <circle cx={x} cy={y} r={r * 0.55} fill={inner} />
      <circle cx={x - r * 0.2} cy={y - r * 0.2} r={r * 0.18} fill="#ffd27a" opacity={0.8} />
    </g>
  );
}

export function BazaarScene({ className = "" }: { className?: string }) {
  const rand = rng(7);
  const flowers: { x: number; y: number; r: number; hue: number }[] = [];
  for (let i = 0; i < 170; i++) {
    const side = rand() < 0.5 ? "l" : "r";
    const depth = rand(); // 0 = far, 1 = near
    const x = side === "l" ? rand() * 470 - 20 : 970 + rand() * 490;
    const y = 700 + depth * 210 + rand() * 12;
    flowers.push({ x, y, r: 4 + depth * 13 + rand() * 3, hue: rand() });
  }
  flowers.sort((a, b) => a.y - b.y);

  const grass: { x: number; y: number; h: number; tilt: number }[] = [];
  for (let i = 0; i < 120; i++) {
    const x = rand() * 1440;
    grass.push({ x, y: 690 + rand() * 230, h: 10 + rand() * 22, tilt: rand() * 10 - 5 });
  }

  return (
    <svg
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMax slice"
      className={className}
      aria-hidden
      role="presentation"
    >
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#bcd6f2" />
          <stop offset="0.45" stopColor="#e8e4ea" />
          <stop offset="0.68" stopColor="#fbe3c8" />
          <stop offset="1" stopColor="#f9cfa6" />
        </linearGradient>
        <radialGradient id="sun" cx="0.5" cy="0.62" r="0.45">
          <stop offset="0" stopColor="#fff3dc" stopOpacity="0.95" />
          <stop offset="1" stopColor="#fff3dc" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hillFar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a9b4de" />
          <stop offset="1" stopColor="#c9c9e4" />
        </linearGradient>
        <linearGradient id="hillMid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8796cf" />
          <stop offset="1" stopColor="#b3b6dc" />
        </linearGradient>
        <linearGradient id="meadowFar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a8c98a" />
          <stop offset="1" stopColor="#89b673" />
        </linearGradient>
        <linearGradient id="meadowNear" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#77ad62" />
          <stop offset="1" stopColor="#4f8a47" />
        </linearGradient>
        <filter id="paper" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" />
          <feColorMatrix values="0 0 0 0 0.2  0 0 0 0 0.15  0 0 0 0 0.1  0 0 0 0.09 0" />
        </filter>
        <filter id="soft">
          <feGaussianBlur stdDeviation="1.2" />
        </filter>
      </defs>

      <rect width="1440" height="900" fill="url(#sky)" />
      <rect width="1440" height="900" fill="url(#sun)" />

      {/* clouds */}
      <g fill="#fff" opacity="0.7" filter="url(#soft)">
        <ellipse cx="220" cy="250" rx="120" ry="22" />
        <ellipse cx="290" cy="236" rx="70" ry="20" />
        <ellipse cx="1180" cy="210" rx="140" ry="24" />
        <ellipse cx="1250" cy="196" rx="80" ry="20" />
      </g>

      {/* far hills */}
      <path d="M0 560 C 180 470, 330 480, 470 520 S 760 470, 920 500 S 1220 440, 1440 520 V 900 H 0 Z" fill="url(#hillFar)" />
      <path d="M0 610 C 220 540, 380 560, 560 590 S 880 560, 1040 580 S 1300 540, 1440 590 V 900 H 0 Z" fill="url(#hillMid)" opacity="0.9" />

      {/* bazaar row */}
      <path d="M0 650 C 300 625, 600 640, 720 642 S 1180 628, 1440 648 V 900 H 0 Z" fill="url(#meadowFar)" />
      <Shop x={36} y={560} s={0.95} />
      <Shop x={150} y={575} s={0.8} aperture />
      <Shop x={248} y={590} s={0.66} />
      <Shop x={1404} y={560} s={0.95} flip />
      <Shop x={1290} y={575} s={0.8} flip />
      <Shop x={1190} y={590} s={0.66} flip aperture />

      {/* near meadow */}
      <path d="M0 700 C 260 670, 520 690, 720 694 S 1160 672, 1440 700 V 900 H 0 Z" fill="url(#meadowNear)" />
      <g stroke="#3f7a3a" strokeWidth="2" strokeLinecap="round" opacity="0.7">
        {grass.map((g, i) => (
          <path key={i} d={`M${g.x} ${g.y} q ${g.tilt} ${-g.h / 2} ${g.tilt * 1.6} ${-g.h}`} fill="none" />
        ))}
      </g>
      {flowers.map((f, i) => (
        <Marigold key={i} {...f} />
      ))}

      <rect width="1440" height="900" filter="url(#paper)" />
    </svg>
  );
}

/** Festive toran (bunting) — its own strip so it never crosses the headline. */
export function Toran({ className = "" }: { className?: string }) {
  const n = 23;
  const flags = Array.from({ length: n }, (_, i) => {
    const t = (i + 0.5) / n;
    const x = t * 1440;
    // point on the quadratic curve (0,6) (720,90) (1440,6)
    const y = (1 - t) * (1 - t) * 6 + 2 * (1 - t) * t * 90 + t * t * 6;
    return { x, y, c: [ORANGE, NAVY, MARIGOLD, CREAM][i % 4] };
  });
  return (
    <svg viewBox="0 0 1440 80" preserveAspectRatio="xMidYMin slice" className={className} aria-hidden role="presentation">
      <path d="M0 6 Q 720 90 1440 6" stroke={NAVY} strokeWidth="1.6" fill="none" opacity="0.5" />
      {flags.map((f, i) => (
        <path
          key={i}
          d={`M${f.x - 11} ${f.y - 1} L${f.x + 11} ${f.y - 1} L${f.x} ${f.y + 22} Z`}
          fill={f.c}
          stroke={NAVY}
          strokeWidth="1"
          opacity="0.9"
        />
      ))}
    </svg>
  );
}
