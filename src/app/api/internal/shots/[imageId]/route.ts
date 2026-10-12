import { after, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { runShot, verifyShotRequest } from "@/lib/generation/jobs";

export const dynamic = "force-dynamic";
// One shot gets its own function invocation and time budget.
export const maxDuration = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Starts one shot. Only this app can call it: the request carries an HMAC of the shot id and a timestamp.
 * It answers 202 immediately and does the work in after(), so the dispatcher never waits for generation.
 */
export async function POST(req: Request, ctx: { params: Promise<{ imageId: string }> }) {
  const { imageId } = await ctx.params;
  if (!UUID_RE.test(imageId) || !verifyShotRequest(imageId, req.headers.get("x-shot-ts"), req.headers.get("x-shot-sig"))) {
    return jsonError(401, "unauthorized", "Not allowed");
  }
  after(() => runShot(imageId));
  return NextResponse.json({ accepted: true }, { status: 202 });
}
