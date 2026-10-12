import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { UnauthorizedError } from "@/lib/auth/session";
import { InsufficientCreditsError } from "@/lib/credits";
import { GenerationError } from "@/lib/generation/service";
import { UnsupportedImageError } from "@/lib/image/process";
import { PaymentError } from "@/lib/payments/service";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = "error",
  ) {
    super(message);
  }
}

export function jsonError(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}

/** Reject cross-site state-changing requests (defence in depth on top of SameSite cookies). */
export function assertSameOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host || new URL(origin).host !== host) throw new HttpError(403, "Cross-origin request blocked", "forbidden");
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

export function api<C = unknown>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      assertSameOrigin(req);
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof HttpError) return jsonError(err.status, err.code, err.message);
      if (err instanceof UnauthorizedError) return jsonError(401, "unauthorized", err.message);
      if (err instanceof ZodError) {
        return jsonError(400, "invalid_request", "Invalid request", { issues: err.issues.slice(0, 5) });
      }
      if (err instanceof InsufficientCreditsError) {
        return jsonError(402, "insufficient_credits", "Not enough credits. Top up to continue.", {
          required: err.required,
          balance: err.balance,
        });
      }
      if (err instanceof GenerationError) return jsonError(err.status, err.code, err.message);
      if (err instanceof PaymentError) return jsonError(err.status, "payment_error", err.message);
      if (err instanceof UnsupportedImageError) return jsonError(415, "unsupported_image", err.message);
      console.error("[api] unhandled error", err);
      return jsonError(500, "internal_error", "Something went wrong. Please try again.");
    }
  };
}

// Simple fixed-window limiter. Per-instance only — put a shared store
// (e.g. Upstash Redis) in front for multi-instance deployments.
const windows = new Map<string, { start: number; count: number }>();

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now - w.start > windowMs) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 10_000) windows.clear();
    return;
  }
  if (++w.count > limit) throw new HttpError(429, "Too many requests. Slow down a little.", "rate_limited");
}
