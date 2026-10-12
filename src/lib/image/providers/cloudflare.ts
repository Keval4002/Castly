import "server-only";
import sharp from "sharp";
import { env } from "@/lib/env";
import { errorText, fetchWithTimeout, isRetryableStatus, ProviderError } from "@/lib/http";
import type { ImageProvider, ImageRequest, ImageResult } from "../types";

/**
 * Cloudflare Workers AI — FLUX.2 (klein / dev) with a reference image.
 * Free allocation: 10,000 neurons/day, no card required. Used in
 * IMAGE_PROVIDER_MODE=free for testing the full pipeline at zero cost.
 *
 * FLUX.2 models take multipart form data; reference images must be named
 * input_image_0..3 and (for klein) be smaller than 512×512.
 */
export const cloudflareFlux: ImageProvider = {
  id: "cloudflare",
  get model() {
    return env().CLOUDFLARE_IMAGE_MODEL;
  },
  available: () => Boolean(env().CLOUDFLARE_ACCOUNT_ID && env().CLOUDFLARE_API_TOKEN),

  async generate(req: ImageRequest): Promise<ImageResult> {
    const e = env();
    const model = e.CLOUDFLARE_IMAGE_MODEL;
    const reference = await sharp(req.image.data)
      .resize({ width: 511, height: 511, fit: "inside" })
      .jpeg({ quality: 90 })
      .toBuffer();

    // Keep within the model's 1024px-class budget while matching the ratio.
    const scale = 1024 / Math.max(req.aspectRatio.width, req.aspectRatio.height);
    const width = Math.round((req.aspectRatio.width * scale) / 16) * 16;
    const height = Math.round((req.aspectRatio.height * scale) / 16) * 16;

    const form = new FormData();
    form.append("prompt", req.prompt);
    form.append("input_image_0", new Blob([new Uint8Array(reference)], { type: "image/jpeg" }), "product.jpg");
    form.append("width", String(width));
    form.append("height", String(height));

    const res = await fetchWithTimeout(
      `https://api.cloudflare.com/client/v4/accounts/${e.CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`,
      { method: "POST", headers: { authorization: `Bearer ${e.CLOUDFLARE_API_TOKEN}` }, body: form, timeoutMs: 90_000 },
    );
    if (!res.ok) {
      throw new ProviderError(`Cloudflare ${res.status}: ${await errorText(res)}`, "cloudflare", res.status, isRetryableStatus(res.status));
    }
    const type = res.headers.get("content-type") ?? "";
    if (type.startsWith("image/")) return { data: Buffer.from(await res.arrayBuffer()), model };

    const json = (await res.json()) as { result?: { image?: string }; errors?: { message: string }[] };
    const b64 = json.result?.image;
    if (!b64) throw new ProviderError(`Cloudflare returned no image ${JSON.stringify(json.errors ?? [])}`, "cloudflare");
    return { data: Buffer.from(b64.replace(/^data:[^,]+,/, ""), "base64"), model };
  },
};
