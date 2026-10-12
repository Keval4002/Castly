"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/client/fetcher";
import { supabaseBrowser } from "@/lib/client/supabase";

export function LoginForm({ mode, next }: { mode: "supabase" | "dev"; next: string }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "dev") {
        await apiFetch("/api/auth/dev-login", { method: "POST", body: JSON.stringify({ email }) });
        window.location.href = next;
        return;
      }
      const { error } = await supabaseBrowser().auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
      });
      if (error) throw error;
      setStep("code");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.verifyOtp({ email, token: code.trim(), type: "email" });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    window.location.href = next;
  }

  async function google() {
    await supabaseBrowser().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
  }

  if (step === "code") {
    return (
      <form onSubmit={submitCode} className="mt-6 space-y-3">
        <p className="text-sm text-ink-2">
          We sent a sign-in link and code to <b>{email}</b>. Click the link, or enter the code:
        </p>
        <input
          className="input text-center text-lg tracking-[0.4em]"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="••••••"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          maxLength={10}
          required
        />
        {error && <p className="text-sm text-err">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Verifying…" : "Verify & continue"}
        </button>
        <button type="button" className="w-full text-sm text-ink-2 underline" onClick={() => setStep("email")}>
          Use a different email
        </button>
      </form>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      {mode === "supabase" && (
        <>
          <button type="button" onClick={google} className="btn-ghost w-full">
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
              <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
            </svg>
            Continue with Google
          </button>
          <div className="flex items-center gap-3 text-xs text-ink-3">
            <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}
      <form onSubmit={submitEmail} className="space-y-3">
        <input
          className="input"
          type="email"
          name="email"
          autoComplete="email"
          placeholder="you@business.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        {error && <p className="text-sm text-err">{error}</p>}
        <button className="btn-primary w-full" disabled={busy} data-testid="login-submit">
          {busy ? "Please wait…" : mode === "dev" ? "Continue (dev login)" : "Email me a sign-in code"}
        </button>
        {mode === "dev" && <p className="text-center text-xs text-warn">Development auth — no email verification.</p>}
      </form>
    </div>
  );
}
