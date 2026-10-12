import "server-only";
import path from "node:path";
import sharp from "sharp";
import { env } from "@/lib/env";
import { errorText, fetchWithTimeout, isRetryableStatus, ProviderError } from "@/lib/http";

/**
 * Background removal with BiRefNet (MIT licence). Returns a single-channel
 * alpha mask (0 = background, 255 = product) at the input's size.
 *
 * - fal: hosted BiRefNet "General Use (Light)", ~1–3 s. Production.
 * - local: BiRefNet-lite via transformers.js on this server's CPU, ~10–20 s,
 *   free. Dev / self-hosted only — onnxruntime is excluded from Vercel builds.
 */
export interface Mask {
  data: Buffer;
  width: number;
  height: number;
  method: "fal-birefnet" | "local-birefnet";
}

/** The models run at 1024² internally, so larger inputs only add transfer time. */
const MODEL_SIDE = 1024;

export type BackgroundRemover = "fal" | "local" | null;

export function backgroundRemover(): BackgroundRemover {
  const e = env();
  switch (e.BACKGROUND_REMOVAL) {
    case "off":
      return null;
    case "fal":
      return e.FAL_KEY ? "fal" : null;
    case "local":
      return "local";
    case "auto":
      if (e.FAL_KEY) return "fal";
      return process.env.VERCEL ? null : "local";
  }
}

export async function removeBackground(image: Buffer): Promise<Mask | null> {
  const which = backgroundRemover();
  if (!which) return null;
  const meta = await sharp(image).metadata();
  const input = await sharp(image)
    .resize({ width: MODEL_SIDE, height: MODEL_SIDE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 92 })
    .toBuffer();
  const small = which === "fal" ? await falMask(input) : await localMask(input);
  // Back to the original size; a smooth upscale keeps edges soft.
  const data = await sharp(small.data, { raw: { width: small.width, height: small.height, channels: 1 } })
    .resize(meta.width!, meta.height!, { fit: "fill", kernel: "cubic" })
    .extractChannel(0) // sharp outputs 3 channels for a resized grey image
    .raw()
    .toBuffer();
  return { data, width: meta.width!, height: meta.height!, method: which === "fal" ? "fal-birefnet" : "local-birefnet" };
}

type RawMask = { data: Buffer; width: number; height: number };

async function alphaOf(png: Buffer): Promise<RawMask> {
  const { data, info } = await sharp(png).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function falMask(input: Buffer): Promise<RawMask> {
  const res = await fetchWithTimeout("https://fal.run/fal-ai/birefnet/v2", {
    method: "POST",
    headers: { authorization: `Key ${env().FAL_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      image_url: `data:image/jpeg;base64,${input.toString("base64")}`,
      model: "General Use (Light)",
      operating_resolution: "1024x1024",
      output_format: "png",
      refine_foreground: true,
    }),
    timeoutMs: 30_000,
  });
  if (!res.ok) {
    throw new ProviderError(`fal birefnet ${res.status}: ${await errorText(res)}`, "fal-birefnet", res.status, isRetryableStatus(res.status));
  }
  const json = (await res.json()) as { image?: { url?: string } };
  if (!json.image?.url) throw new ProviderError("fal birefnet returned no image", "fal-birefnet");
  const img = await fetchWithTimeout(json.image.url, { timeoutMs: 15_000 });
  if (!img.ok) throw new ProviderError(`fal birefnet download ${img.status}`, "fal-birefnet", img.status);
  return alphaOf(Buffer.from(await img.arrayBuffer()));
}

// ---------- local (transformers.js) ----------

type Segmenter = (input: unknown) => Promise<unknown>;
let segmenter: Promise<Segmenter> | null = null;
/** One inference at a time: the model already uses every CPU core. */
let queue: Promise<unknown> = Promise.resolve();

function loadSegmenter(): Promise<Segmenter> {
  segmenter ??= (async () => {
    const t = await import("@huggingface/transformers");
    t.env.cacheDir = path.resolve(/*turbopackIgnore: true*/ process.cwd(), env().LOCAL_MODEL_DIR);
    const pipe = await t.pipeline("background-removal", "onnx-community/BiRefNet_lite-ONNX", { dtype: "fp16" });
    return pipe as unknown as Segmenter;
  })().catch((err) => {
    segmenter = null; // retry the download/load next time
    throw err;
  });
  return segmenter;
}

async function localMask(input: Buffer): Promise<RawMask> {
  const run = queue.then(async () => {
    const [seg, t] = await Promise.all([loadSegmenter(), import("@huggingface/transformers")]);
    const image = await t.RawImage.fromBlob(new Blob([new Uint8Array(input)], { type: "image/jpeg" }));
    const out = await seg(image);
    const img = (Array.isArray(out) ? out[0] : out) as { data: Uint8ClampedArray; width: number; height: number; channels: number };
    const rgba = sharp(Buffer.from(img.data), { raw: { width: img.width, height: img.height, channels: img.channels as 4 } });
    const { data, info } = await rgba.extractChannel((img.channels - 1) as 3).raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  });
  queue = run.catch(() => undefined);
  return run;
}
