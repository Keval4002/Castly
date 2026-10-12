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
  // Free tier, very fast; Qwen 3.8 accepts images. Older Groq models only
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

export const LLM_IDS: PromptLLMId[] = ["gemini", "groq", "claude"];

export function isLLMConfigured(id: PromptLLMId): boolean {
  return LLMS[id].model() !== null;
}

/** Model + provider options for one LLM, or null when it isn't configured. */
export function languageModel(id: PromptLLMId): (LLMConfig & { instance: LanguageModel }) | null {
  const instance = LLMS[id].model();
  return instance ? { ...LLMS[id], instance } : null;
}

export interface JudgeModel {
  id: string;
  instance: LanguageModel;
  providerOptions?: LLMConfig["providerOptions"];
  /** Claude ignores temperature with effort settings. */
  claude: boolean;
}

/**
 * Vision judges for the product-fidelity check, strictest first: a dedicated
 * Gemini judge model (subtle proportion/detail changes need more than a lite
 * model), then the prompt LLMs. A busy judge fails fast and hands over.
 */
export function judgeModels(): JudgeModel[] {
  const out: JudgeModel[] = [];
  const e = env();
  const g = google();
  if (g && e.GEMINI_JUDGE_MODEL && e.GEMINI_JUDGE_MODEL !== e.GEMINI_PROMPT_MODEL) {
    out.push({ id: `gemini:${e.GEMINI_JUDGE_MODEL}`, instance: g(e.GEMINI_JUDGE_MODEL), claude: false });
  }
  for (const id of llmOrder()) {
    const lm = languageModel(id);
    if (lm) out.push({ id, instance: lm.instance, providerOptions: lm.providerOptions, claude: id === "claude" });
  }
  return out;
}

/** Preferred LLM first, then every other one (PROMPT_LLM=template → none). */
export function llmOrder(): PromptLLMId[] {
  const preferred = env().PROMPT_LLM;
  return preferred === "template" ? [] : [preferred, ...LLM_IDS.filter((x) => x !== preferred)];
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
    // Rate-limited (e.g. Groq free tier)? Fall through to the next LLM now
    // instead of sleeping on the provider's retry-after.
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(timeoutMs),
    providerOptions: cfg.providerOptions,
  });
  return coercePlan(output, req, id);
}
