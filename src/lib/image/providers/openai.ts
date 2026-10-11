import "server-only";
import { env } from "@/lib/env";
import { errorText, fetchWithTimeout, isRetryableStatus, ProviderError } from "@/lib/http";
import type { ImageProvider, ImageRequest, ImageResult } from "../types";

function sizeFor(req: ImageRequest): string {
  const { width, height } = req.aspectRatio;
  if (width === height) return "1024x1024";
  return width > height ? "1536x1024" : "1024x1536";
}

export const openaiImage: ImageProvider = {
  id: "openai",
  get model() {
    return env().OPENAI_IMAGE_MODEL;
  },
  available: () => Boolean(env().OPENAI_API_KEY),

  async generate(req: ImageRequest): Promise<ImageResult> {
    const model = env().OPENAI_IMAGE_MODEL;
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", req.prompt);
    form.append("size", sizeFor(req));
    form.append("quality", "high");
    form.append("input_fidelity", "high");
    form.append("output_format", "jpeg");
    form.append("n", "1");
    form.append("image[]", new Blob([new Uint8Array(req.image.data)], { type: req.image.mime }), "product.jpg");

    const res = await fetchWithTimeout("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { authorization: `Bearer ${env().OPENAI_API_KEY}` },
      body: form,
      timeoutMs: 180_000,
    });
    if (!res.ok) {
      throw new ProviderError(`OpenAI ${res.status}: ${await errorText(res)}`, "openai", res.status, isRetryableStatus(res.status));
    }
    const json = (await res.json()) as { data?: { b64_json?: string }[] };
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new ProviderError("OpenAI returned no image", "openai");
    return { data: Buffer.from(b64, "base64"), model };
  },
};
