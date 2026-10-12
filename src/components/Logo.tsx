import Image from "next/image";
import Link from "next/link";

/**
 * Brand logo. Assets live in public/brand — replace dukaanshot-logo.png /
 * dukaanshot-mark.png with the final exports (keep the names) to update everywhere.
 */
export function Logo({
  href = "/",
  size = "md",
  full = false,
}: {
  href?: string;
  size?: "sm" | "md" | "lg";
  /** Always show the wordmark (otherwise mobile shows just the shop mark). */
  full?: boolean;
}) {
  const h = size === "lg" ? 40 : size === "sm" ? 24 : 30;
  return (
    <Link href={href} className="flex shrink-0 items-center" aria-label="Dukaanshot home">
      <Image
        src="/brand/dukaanshot-logo.png"
        alt="Dukaanshot"
        width={Math.round(h * 7.82)}
        height={h}
        priority
        className={full ? "block" : "hidden sm:block"}
        style={{ height: h, width: "auto" }}
      />
      <Image
        src="/brand/dukaanshot-mark.png"
        alt="Dukaanshot"
        width={Math.round(h * 1.4 * 1.1)}
        height={Math.round(h * 1.4)}
        priority
        className={full ? "hidden" : "sm:hidden"}
        style={{ height: Math.round(h * 1.3), width: "auto" }}
      />
    </Link>
  );
}
