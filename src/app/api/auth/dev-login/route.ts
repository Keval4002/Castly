import { NextResponse } from "next/server";
import { z } from "zod";
import { api, HttpError, rateLimit } from "@/lib/api";
import { DEV_SESSION_COOKIE, signDevSession } from "@/lib/auth/dev";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

const body = z.object({ email: z.string().email().max(254) });

export const POST = api(async (req) => {
  if (env().AUTH_PROVIDER !== "dev") throw new HttpError(404, "Not found", "not_found");
  rateLimit(`devlogin:${req.headers.get("x-forwarded-for") ?? "local"}`, 20, 60_000);
  const { email } = body.parse(await req.json());
  const res = NextResponse.json({ ok: true });
  res.cookies.set(DEV_SESSION_COOKIE, await signDevSession(email), {
    httpOnly: true,
    sameSite: "lax",
    secure: env().APP_URL.startsWith("https://"),
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
});
