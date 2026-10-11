import "server-only";
import { env } from "@/lib/env";
import { errorText, fetchWithTimeout, isRetryableStatus, ProviderError } from "@/lib/http";
import type { ImageProvider, ImageRequest, ImageResult } from "../types";

// Gemini supports these natively; anything else is cropped afterwards.
const GEMINI_RATIOS = new Set(["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]);

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  inline_data?: { mime_type: string; data: string };
}

export const geminiImage: ImageProvider = {
  id: "gemini",
  get model() {
    return env().GEMINI_IMAGE_MODEL;
  },
  available: () => Boolean(env().GEMINI_API_KEY),

  async generate(req: ImageRequest): Promise<ImageResult> {
    const e = env();
    const model = e.GEMINI_IMAGE_MODEL;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const body = {
      contents: [
        {
          role: "user",
          parts: [
            { inline_data: { mime_type: req.image.mime, data: req.image.data.toString("base64") } },
            { text: req.prompt },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ["IMAGE"],
        ...(GEMINI_RATIOS.has(req.aspectRatio.id) ? { imageConfig: { aspectRatio: req.aspectRatio.id } } : {}),
      },
    };

    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": e.GEMINI_API_KEY! },
      body: JSON.stringify(body),
      timeoutMs: 90_000,
    });
    if (!res.ok) {
      throw new ProviderError(
        `Gemini ${res.status}: ${await errorText(res)}`,
        "gemini",
        res.status,
        isRetryableStatus(res.status),
      );
    }
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
    };
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    for (const p of parts) {
      const data = p.inlineData?.data ?? p.inline_data?.data;
      if (data) return { data: Buffer.from(data, "base64"), model };
    }
    const reason = json.promptFeedback?.blockReason ?? json.candidates?.[0]?.finishReason ?? "no image returned";
    throw new ProviderError(`Gemini returned no image (${reason})`, "gemini", undefined, true);
  },
};
