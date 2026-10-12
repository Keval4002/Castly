import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { safeNextPath } from "@/lib/auth/redirect";

export const dynamic = "force-dynamic";

/**
 * Supabase auth callback.
 * - `token_hash` + `type` (magic-link email template): verified server-side, so
 *   the link works on any device or browser.
 * - `code` (Google OAuth / PKCE): needs the verifier cookie from the browser
 *   that started sign-in.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(url.searchParams.get("next"));

  if (tokenHash || code) {
    const supabase = await createSupabaseServerClient();
    const { error } =
      tokenHash && type
        ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
        : await supabase.auth.exchangeCodeForSession(code ?? "");
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
    console.warn(`[auth] callback failed (${tokenHash ? "token_hash" : "code"}): ${error.message}`);
  }
  return NextResponse.redirect(new URL("/login?error=auth", url.origin));
}
