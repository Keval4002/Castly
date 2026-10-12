import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2" aria-label="Castly home">
      <span className="grid h-8 w-8 place-items-center rounded-xl bg-ink font-display text-xl text-white">C</span>
      <span className="font-display text-2xl tracking-tight">Castly</span>
    </Link>
  );
}
