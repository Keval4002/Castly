import "server-only";
import { llmOrder, llmPromptPlan } from "./llm";
import { templatePrompts, type PromptPlan, type PromptRequest } from "./shared";

const LLM_TIMEOUT_MS = 12_000;

/**
 * Turn the user's selections into N distinct, product-preserving prompts.
 * Tries the preferred LLM, then every other configured LLM, and finally a
 * deterministic template — so generation never blocks on the LLM.
 */
export async function buildPromptPlan(req: PromptRequest): Promise<PromptPlan> {
  for (const id of llmOrder()) {
    try {
      const plan = await llmPromptPlan(id, req, LLM_TIMEOUT_MS);
      if (plan) return plan;
    } catch (err) {
      console.warn(`[prompt] ${id} failed: ${(err as Error).message}`);
    }
  }
  return { productSummary: "", prompts: templatePrompts(req), source: "template" };
}
