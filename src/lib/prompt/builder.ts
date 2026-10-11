import "server-only";
import { env } from "@/lib/env";
import { claudePromptPlan } from "./claude";
import { geminiPromptPlan } from "./gemini";
import { templatePrompts, type PromptPlan, type PromptRequest } from "./shared";

const LLM_TIMEOUT_MS = 12_000;

/**
 * Turn the user's selections into N distinct, product-preserving prompts.
 * Tries the configured LLM first, then the other one, and finally a
 * deterministic template — so generation never blocks on the LLM.
 */
export async function buildPromptPlan(req: PromptRequest): Promise<PromptPlan> {
  const mode = env().PROMPT_LLM;
  const order = mode === "claude" ? [claudePromptPlan, geminiPromptPlan] : mode === "gemini" ? [geminiPromptPlan, claudePromptPlan] : [];

  for (const fn of order) {
    try {
      const plan = await fn(req, LLM_TIMEOUT_MS);
      if (plan) return plan;
    } catch (err) {
      console.warn(`[prompt] ${fn.name} failed: ${(err as Error).message}`);
    }
  }
  return { productSummary: "", prompts: templatePrompts(req), source: "template" };
}
