import "server-only";
import { env } from "@/lib/env";
import { errorText, fetchWithTimeout, isRetryableStatus, ProviderError } from "@/lib/http";
import type { ImageProvider, ImageRequest, ImageResult } from "../types";

/**
 * fal.ai synchronous endpoints. The product photo is sent as a data URI so we
 * never need a public URL for private uploads.
 */
async function callFal(model: string, body: Record<string, unknown>): Promise<Buffer> {
  const res = await fetchWithTimeout(`https://fal.run/${model}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Key ${env().FAL_KEY}` },
    body: JSON.stringify(body),
    timeoutMs: 120_000,
  });
  if (!res.ok) {
    throw new ProviderError(`fal ${model} ${res.status}: ${await errorText(res)}`, "fal", res.status, isRetryableStatus(res.status));
  }
  const json = (await res.json()) as { images?: { url: string }[]; has_nsfw_concepts?: boolean[] };
  const url = json.images?.[0]?.url;
  if (!url) throw new ProviderError(`fal ${model} returned no image`, "fal");
  if (url.startsWith("data:")) return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
  const img = await fetchWithTimeout(url, { timeoutMs: 30_000 });
  if (!img.ok) throw new ProviderError(`fal image download ${img.status}`, "fal", img.status);
  return Buffer.from(await img.arrayBuffer());
}

function dataUri(req: ImageRequest) {
  return `data:${req.image.mime};base64,${req.image.data.toString("base64")}`;
}

// FLUX Kontext only supports a fixed set of ratios.
const KONTEXT_RATIO: Record<string, string> = {
  "1:1": "1:1",
  "4:5": "3:4",
  "3:4": "3:4",
  "9:16": "9:16",
  "16:9": "16:9",
};

export const falKontext: ImageProvider = {
  id: "fal-kontext",
  model: "fal-ai/flux-pro/kontext",
  available: () => Boolean(env().FAL_KEY),
  async generate(req): Promise<ImageResult> {
    const data = await callFal(this.model, {
      prompt: req.prompt,
      image_url: dataUri(req),
      aspect_ratio: KONTEXT_RATIO[req.aspectRatio.id] ?? "1:1",
      num_images: 1,
      output_format: "jpeg",
      safety_tolerance: "2",
    });
    return { data, model: this.model };
  },
};

export const falSeedream: ImageProvider = {
  id: "fal-seedream",
  model: "fal-ai/bytedance/seedream/v4/edit",
  available: () => Boolean(env().FAL_KEY),
  async generate(req): Promise<ImageResult> {
    const data = await callFal(this.model, {
      prompt: req.prompt,
      image_urls: [dataUri(req)],
      image_size: { width: req.aspectRatio.width, height: req.aspectRatio.height },
      num_images: 1,
      enable_safety_checker: true,
    });
    return { data, model: this.model };
  },
};
