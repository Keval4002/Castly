import "server-only";
import { createHash } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { env } from "@/lib/env";

/**
 * Local-only email login used when AUTH_PROVIDER=dev (no Supabase project).
 * env() refuses to start a production build with this enabled unless
 * ALLOW_INSECURE_DEV_MODE is explicitly set for e2e runs.
 */
export const DEV_SESSION_COOKIE = "dukaanshot_dev_session";

function key() {
  return new TextEncoder().encode(env().SESSION_SECRET);
}

/** Stable UUID derived from the email so re-login maps to the same profile. */
export function devUserId(email: string): string {
  const h = createHash("sha256").update(`dukaanshot-dev:${email.toLowerCase()}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function signDevSession(email: string): Promise<string> {
  return new SignJWT({ email: email.toLowerCase() })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(devUserId(email))
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(key());
}

export async function verifyDevSession(token: string): Promise<{ id: string; email: string } | null> {
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload.email !== "string") return null;
    return { id: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}
