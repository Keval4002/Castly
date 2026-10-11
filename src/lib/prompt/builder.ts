import "server-only";
import { env } from "@/lib/env";
import { llmPromptPlan, type PromptLLMId } from "./llm";
import { templatePrompts, type PromptPlan, type PromptRequest } from "./shared";

const LLM_TIMEOUT_MS = 12_000;
const ALL: PromptLLMId[] = ["gemini", "groq", "claude"];

/**
 * Turn the user's selections into N distinct, product-preserving prompts.
 * Tries the preferred LLM, then every other configured LLM, and finally a
 * deterministic template — so generation never blocks on the LLM.
 */
export async function buildPromptPlan(req: PromptRequest): Promise<PromptPlan> {
  const preferred = env().PROMPT_LLM;
  const order = preferred === "template" ? [] : [preferred, ...ALL.filter((x) => x !== preferred)];

  for (const id of order) {
    try {
      const plan = await llmPromptPlan(id, req, LLM_TIMEOUT_MS);
      if (plan) return plan;
    } catch (err) {
      console.warn(`[prompt] ${id} failed: ${(err as Error).message}`);
    }
  }
  return { productSummary: "", prompts: templatePrompts(req), source: "template" };
}
