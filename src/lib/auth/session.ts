import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { cache } from "react";
import { ensureProfile } from "@/lib/credits";
import type { Profile } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { DEV_SESSION_COOKIE, verifyDevSession } from "./dev";
import { createSupabaseServerClient } from "./supabase-server";

export interface SessionUser {
  id: string;
  email: string;
  name?: string | null;
}

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  // Sessions only exist at request time; also keeps env() out of build-time prerendering.
  await connection();
  if (env().AUTH_PROVIDER === "dev") {
    const token = (await cookies()).get(DEV_SESSION_COOKIE)?.value;
    return token ? verifyDevSession(token) : null;
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.email) return null;
  const meta = data.user.user_metadata as { full_name?: string; name?: string } | undefined;
  return { id: data.user.id, email: data.user.email, name: meta?.full_name ?? meta?.name ?? null };
});

/** Current user's profile (created + signup bonus on first visit), or null. */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  return ensureProfile(user);
});

export class UnauthorizedError extends Error {}

export async function requireProfile(): Promise<Profile> {
  const p = await getCurrentProfile();
  if (!p) throw new UnauthorizedError("Please sign in");
  return p;
}
