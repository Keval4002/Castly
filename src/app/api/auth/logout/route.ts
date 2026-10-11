import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { DEV_SESSION_COOKIE } from "@/lib/auth/dev";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export const POST = api(async () => {
  if (env().AUTH_PROVIDER === "supabase") {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(DEV_SESSION_COOKIE);
  return res;
});
