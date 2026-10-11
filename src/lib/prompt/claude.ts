import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { env } from "@/lib/env";
import { buildUserMessage, coercePlan, llmOutputSchema, SYSTEM_PROMPT, type PromptPlan, type PromptRequest } from "./shared";

let client: Anthropic | null = null;

export async function claudePromptPlan(req: PromptRequest, timeoutMs: number): Promise<PromptPlan | null> {
  const e = env();
  if (!e.ANTHROPIC_API_KEY) return null;
  client ??= new Anthropic({ apiKey: e.ANTHROPIC_API_KEY, maxRetries: 1 });

  const content: Anthropic.ContentBlockParam[] = [];
  if (req.preview) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: req.preview.toString("base64") },
    });
  }
  content.push({ type: "text", text: buildUserMessage(req) });

  const response = await client.messages.parse(
    {
      model: e.CLAUDE_PROMPT_MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
      // Low effort keeps this step fast; the task is short and well-specified.
      output_config: { effort: "low", format: zodOutputFormat(llmOutputSchema) },
    },
    { timeout: timeoutMs },
  );
  if (response.stop_reason === "refusal" || !response.parsed_output) return null;
  return coercePlan(response.parsed_output, req, "claude");
}
