import "server-only";
import { generateImage, type ImageModel } from "ai";
import { fal, google, openai } from "@/lib/ai/providers";
import { env } from "@/lib/env";
import { ProviderError } from "@/lib/http";
import type { ImageProvider, ImageRequest, ImageResult } from "../types";

type GenerateImageOptions = Parameters<typeof generateImage>[0];

interface Spec {
  id: string;
  modelId: () => string;
  model: (modelId: string) => ImageModel | null;
  timeoutMs: number;
  /** Size / aspect-ratio + provider options for this request. */
  settings: (req: ImageRequest) => Pick<GenerateImageOptions, "size" | "aspectRatio" | "providerOptions">;
}

/** Wrap any Vercel AI SDK image model as an image-editing provider. */
function aiSdkProvider(spec: Spec): ImageProvider {
  return {
    id: spec.id,
    get model() {
      return spec.modelId();
    },
    available: () => spec.model(spec.modelId()) !== null,
    async generate(req: ImageRequest): Promise<ImageResult> {
      const modelId = spec.modelId();
      const model = spec.model(modelId);
      if (!model) throw new ProviderError(`${spec.id} is not configured`, spec.id, undefined, false);
      try {
        const { image } = await generateImage({
          model,
          prompt: { text: req.prompt, images: [req.image.data] },
          maxRetries: 1,
          abortSignal: AbortSignal.timeout(spec.timeoutMs),
          ...spec.settings(req),
        });
        return { data: Buffer.from(image.uint8Array), model: modelId };
      } catch (err) {
        throw new ProviderError(`${spec.id}: ${(err as Error).message}`, spec.id);
      }
    },
  };
}

// Kontext supports a fixed set of ratios; we crop to the exact one afterwards.
const KONTEXT_RATIO: Record<string, `${number}:${number}`> = {
  "1:1": "1:1",
  "4:5": "3:4",
  "3:4": "3:4",
  "9:16": "9:16",
  "16:9": "16:9",
};

function openaiSize(req: ImageRequest): `${number}x${number}` {
  const { width, height } = req.aspectRatio;
  if (width === height) return "1024x1024";
  return width > height ? "1536x1024" : "1024x1536";
}

export const geminiImage = aiSdkProvider({
  id: "gemini",
  modelId: () => env().GEMINI_IMAGE_MODEL,
  model: (id) => google()?.image(id) ?? null,
  timeoutMs: 90_000,
  // Gemini supports every ratio we offer natively.
  settings: (req) => ({ aspectRatio: req.aspectRatio.id as `${number}:${number}` }),
});

export const falSeedream = aiSdkProvider({
  id: "fal-seedream",
  modelId: () => "fal-ai/bytedance/seedream/v4/edit",
  model: (id) => fal()?.image(id) ?? null,
  timeoutMs: 120_000,
  settings: (req) => ({
    size: `${req.aspectRatio.width}x${req.aspectRatio.height}`,
    // Seedream's edit endpoint takes an `image_urls` array.
    providerOptions: { fal: { useMultipleImages: true, enableSafetyChecker: true } },
  }),
});

export const falKontext = aiSdkProvider({
  id: "fal-kontext",
  modelId: () => "fal-ai/flux-pro/kontext",
  model: (id) => fal()?.image(id) ?? null,
  timeoutMs: 120_000,
  settings: (req) => ({
    aspectRatio: KONTEXT_RATIO[req.aspectRatio.id] ?? "1:1",
    providerOptions: { fal: { outputFormat: "jpeg", safetyTolerance: 2 } },
  }),
});

export const openaiImage = aiSdkProvider({
  id: "openai",
  modelId: () => env().OPENAI_IMAGE_MODEL,
  model: (id) => openai()?.image(id) ?? null,
  timeoutMs: 180_000,
  settings: (req) => ({
    size: openaiSize(req),
    providerOptions: { openai: { quality: "high", inputFidelity: "high", outputFormat: "jpeg" } },
  }),
});
