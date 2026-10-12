"use client";

import { Images, LogOut, Wallet, Wand2 } from "lucide-react";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CreditsBadge } from "./CreditsProvider";
import { Logo } from "./Logo";

const NAV = [
  { href: "/studio", label: "Studio", icon: Wand2 },
  { href: "/library", label: "Library", icon: Images },
  { href: "/credits", label: "Credits", icon: Wallet },
];

export function AppHeader({ email }: { email: string }) {
  const pathname = usePathname();
  const router = useRouter();
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/");
    router.refresh();
  }
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4">
        <Logo href="/studio" />
        <nav className="ml-2 hidden items-center gap-1 sm:flex">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-ui text-sm ${
                pathname.startsWith(n.href) ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:text-ink"
              }`}
            >
              <n.icon className="h-4 w-4" aria-hidden />
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <CreditsBadge />
          <details className="relative">
            <summary className="grid h-9 w-9 cursor-pointer list-none place-items-center rounded-full bg-surface-2 text-sm font-semibold uppercase">
              {email[0]}
            </summary>
            <div className="card absolute right-0 mt-2 w-56 p-2 shadow-lg">
              <p className="truncate px-3 py-2 text-xs text-ink-2">{email}</p>
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 font-ui text-sm hover:bg-surface-2 sm:hidden"
                >
                  <n.icon className="h-4 w-4" aria-hidden />
                  {n.label}
                </Link>
              ))}
              <button
                onClick={logout}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left font-ui text-sm hover:bg-surface-2"
              >
                <LogOut className="h-4 w-4" aria-hidden />
                Sign out
              </button>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
