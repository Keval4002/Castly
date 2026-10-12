import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { env } from "@/lib/env";
import { sweepJobs } from "@/lib/generation/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled sweep: starts generations nobody started, restarts shots whose worker died, re-checks held
 * images and fails (and refunds) jobs past their deadline. Needs `Authorization: Bearer $CRON_SECRET`
 * (Vercel Cron sends it when CRON_SECRET is set). Disabled until CRON_SECRET is configured.
 */
async function sweep(req: Request) {
  const secret = env().CRON_SECRET;
  if (!secret) return jsonError(503, "sweep_disabled", "Set CRON_SECRET to enable the sweep");
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return jsonError(401, "unauthorized", "Not allowed");
  }
  const result = await sweepJobs();
  return NextResponse.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
}

export const GET = sweep;
export const POST = sweep;
