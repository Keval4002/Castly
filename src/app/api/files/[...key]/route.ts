import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { storage, verifyLocalSignature } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Serves files for the local storage driver using HMAC-signed, expiring URLs. */
export async function GET(req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  if (env().STORAGE_DRIVER !== "local") return new NextResponse("Not found", { status: 404 });
  const { key: parts } = await ctx.params;
  const key = parts.join("/");
  const url = new URL(req.url);
  const exp = Number(url.searchParams.get("exp"));
  const sig = url.searchParams.get("sig") ?? "";
  if (!verifyLocalSignature(key, exp, sig)) return new NextResponse("Forbidden", { status: 403 });

  try {
    const data = await storage().get(key);
    const type = key.endsWith(".webp") ? "image/webp" : key.endsWith(".png") ? "image/png" : "image/jpeg";
    return new NextResponse(new Uint8Array(data), {
      headers: { "content-type": type, "cache-control": "private, max-age=3600" },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
