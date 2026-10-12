import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createFal } from "@ai-sdk/fal";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { env } from "@/lib/env";

/**
 * Vercel AI SDK provider instances, created lazily from our validated env
 * (so keys never come from ambient defaults and tests can control them).
 * Returns null when the provider isn't configured.
 */
const cache = new Map<string, unknown>();

function lazy<T>(name: string, key: string | undefined, make: (apiKey: string) => T): T | null {
  if (!key) return null;
  if (!cache.has(name)) cache.set(name, make(key));
  return cache.get(name) as T;
}

export const google = () => lazy("google", env().GEMINI_API_KEY, (apiKey) => createGoogleGenerativeAI({ apiKey }));
export const groq = () => lazy("groq", env().GROQ_API_KEY, (apiKey) => createGroq({ apiKey }));
export const anthropic = () => lazy("anthropic", env().ANTHROPIC_API_KEY, (apiKey) => createAnthropic({ apiKey }));
export const openai = () => lazy("openai", env().OPENAI_API_KEY, (apiKey) => createOpenAI({ apiKey }));
export const fal = () => lazy("fal", env().FAL_KEY, (apiKey) => createFal({ apiKey }));
