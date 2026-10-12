import type { Metadata } from "next";
import { BazaarScene } from "@/components/brand/BazaarScene";
import { Logo } from "@/components/Logo";
import { safeNextPath } from "@/lib/auth/redirect";
import { env } from "@/lib/env";
import { SIGNUP_BONUS_CREDITS } from "@/lib/pricing";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="relative isolate grid min-h-screen place-items-center overflow-hidden px-4 py-10">
      <BazaarScene className="absolute inset-0 -z-20 h-full w-full" />
      <div className="hero-grid absolute inset-0 -z-10" />
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center rounded-full bg-white/75 px-5 py-3 backdrop-blur">
          <Logo full />
        </div>
        <div className="rounded-3xl border border-white/70 bg-surface/95 p-6 shadow-[0_30px_80px_-30px_rgba(31,34,89,0.5)] backdrop-blur sm:p-8">
          <h1 className="text-4xl">
            Welcome to your <span className="italic text-brand">dukaan</span>
          </h1>
          <p className="mt-2 text-sm text-ink-2">
            Sign in to start. New accounts get <b className="text-ink">{SIGNUP_BONUS_CREDITS} free credits</b>.
          </p>
          {sp.error && (
            <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-err">Sign-in link expired or invalid. Please try again.</p>
          )}
          <LoginForm mode={env().AUTH_PROVIDER} next={safeNextPath(sp.next)} />
        </div>
        <p className="mt-5 text-center font-ui text-xs text-ink-2">By continuing you agree to our Terms and Privacy Policy.</p>
      </div>
    </div>
  );
}
