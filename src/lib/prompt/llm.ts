import "server-only";
import { generateText, Output, type LanguageModel, type ModelMessage } from "ai";
import { anthropic, google, groq } from "@/lib/ai/providers";
import { env } from "@/lib/env";
import { buildUserMessage, coercePlan, llmOutputSchema, SYSTEM_PROMPT, type PromptPlan, type PromptRequest } from "./shared";

export type PromptLLMId = "gemini" | "groq" | "claude";

interface LLMConfig {
  model: () => LanguageModel | null;
  providerOptions?: Parameters<typeof generateText>[0]["providerOptions"];
}

const LLMS: Record<PromptLLMId, LLMConfig> = {
  // Cheapest paid option; also has a free tier.
  gemini: { model: () => google()?.(env().GEMINI_PROMPT_MODEL) ?? null },
  // Free tier, very fast; Llama 4 Scout accepts images. Older Groq models only
  // support JSON mode (not strict schemas) — the SDK still validates the result.
  groq: {
    model: () => groq()?.(env().GROQ_PROMPT_MODEL) ?? null,
    providerOptions: { groq: { structuredOutputs: false } },
  },
  // Precise instruction following; low effort keeps latency down.
  claude: {
    model: () => anthropic()?.(env().CLAUDE_PROMPT_MODEL) ?? null,
    providerOptions: { anthropic: { effort: "low" } },
  },
};

export function isLLMConfigured(id: PromptLLMId): boolean {
  return LLMS[id].model() !== null;
}

/** Ask one LLM for a prompt plan. Returns null if it isn't configured or answers badly. */
export async function llmPromptPlan(id: PromptLLMId, req: PromptRequest, timeoutMs: number): Promise<PromptPlan | null> {
  const cfg = LLMS[id];
  const model = cfg.model();
  if (!model) return null;

  const content: Extract<ModelMessage, { role: "user" }>["content"] = [];
  if (req.preview) content.push({ type: "file", data: req.preview, mediaType: "image/jpeg" });
  content.push({ type: "text", text: buildUserMessage(req) });

  const { output } = await generateText({
    model,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
    output: Output.object({ schema: llmOutputSchema }),
    temperature: id === "claude" ? undefined : 1,
    maxOutputTokens: 3000,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(timeoutMs),
    providerOptions: cfg.providerOptions,
  });
  return coercePlan(output, req, id);
}
