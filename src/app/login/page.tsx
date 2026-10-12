import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { safeNextPath } from "@/lib/auth/redirect";
import { env } from "@/lib/env";
import { SIGNUP_BONUS_CREDITS } from "@/lib/pricing";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="card p-6 sm:p-8">
          <h1 className="font-display text-3xl">Welcome to Castly</h1>
          <p className="mt-1 text-sm text-ink-2">
            Sign in to start. New accounts get <b>{SIGNUP_BONUS_CREDITS} free credits</b>.
          </p>
          {sp.error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-err">Sign-in link expired or invalid. Please try again.</p>}
          <LoginForm mode={env().AUTH_PROVIDER} next={safeNextPath(sp.next)} />
        </div>
        <p className="mt-6 text-center text-xs text-ink-3">By continuing you agree to our Terms and Privacy Policy.</p>
      </div>
    </div>
  );
}
