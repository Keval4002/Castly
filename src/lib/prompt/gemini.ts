import "server-only";
import { env } from "@/lib/env";
import { errorText, fetchWithTimeout } from "@/lib/http";
import { buildUserMessage, coercePlan, SYSTEM_PROMPT, type PromptPlan, type PromptRequest } from "./shared";

export async function geminiPromptPlan(req: PromptRequest, timeoutMs: number): Promise<PromptPlan | null> {
  const e = env();
  if (!e.GEMINI_API_KEY) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${e.GEMINI_PROMPT_MODEL}:generateContent`;

  const parts: Record<string, unknown>[] = [];
  if (req.preview) parts.push({ inline_data: { mime_type: "image/jpeg", data: req.preview.toString("base64") } });
  parts.push({ text: buildUserMessage(req) });

  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": e.GEMINI_API_KEY },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 1,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            product_summary: { type: "STRING" },
            prompts: { type: "ARRAY", items: { type: "STRING" } },
          },
          required: ["product_summary", "prompts"],
        },
      },
    }),
    timeoutMs,
  });
  if (!res.ok) throw new Error(`Gemini prompt LLM ${res.status}: ${await errorText(res)}`);
  const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  return coercePlan(JSON.parse(text), req, "gemini");
}
