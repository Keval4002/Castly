import "server-only";
import { z } from "zod";

/**
 * Centralised, validated server configuration.
 *
 * Everything that talks to a third party is optional so the app can boot in
 * development with mocks. `assertProductionReady()` is called at startup of
 * critical routes to fail loudly if production is misconfigured.
 */
const bool = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  /** HMAC secret for local file URLs and dev sessions. */
  SESSION_SECRET: z.string().min(32).default("dev-only-secret-change-me-dev-only-secret-change-me"),

  // Auth: "supabase" in production, "dev" for local testing without Supabase.
  AUTH_PROVIDER: z.enum(["supabase", "dev"]).default("supabase"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // Storage: "supabase" bucket or "local" filesystem (dev).
  STORAGE_DRIVER: z.enum(["supabase", "local"]).default("supabase"),
  SUPABASE_STORAGE_BUCKET: z.string().default("castly"),
  LOCAL_STORAGE_DIR: z.string().default(".data/storage"),

  // Prompt LLM (via Vercel AI SDK). The preferred one is tried first, then any
  // other configured LLM, then a deterministic template.
  PROMPT_LLM: z.enum(["gemini", "groq", "claude", "template"]).default("gemini"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_PROMPT_MODEL: z.string().default("gemini-2.5-flash-lite"),
  GROQ_API_KEY: z.string().optional(),
  GROQ_PROMPT_MODEL: z.string().default("meta-llama/llama-4-scout-17b-16e-instruct"),
  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_PROMPT_MODEL: z.string().default("claude-haiku-5-5"),

  /** Product-photo classifier: auto = first configured vision LLM, mock = offline heuristic, off = disabled. */
  CLASSIFIER_MODE: z.enum(["auto", "mock", "off"]).default("auto"),

  // Image providers
  /**
   * live: paid production chains (fal / Gemini / OpenAI)
   * free: free-tier models only (Cloudflare Workers AI FLUX.2, Gemini free quota) — for testing
   * mock: offline compositor (dev / e2e only)
   */
  IMAGE_PROVIDER_MODE: z.enum(["live", "free", "mock"]).default("live"),
  GEMINI_IMAGE_MODEL: z.string().default("gemini-2.5-flash-image"),
  FAL_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_IMAGE_MODEL: z.string().default("gpt-image-1"),
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  CLOUDFLARE_IMAGE_MODEL: z.string().default("@cf/black-forest-labs/flux-2-klein-4b"),

  // Payments
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  /** Fake Razorpay orders/payments (dev / e2e only). */
  PAYMENTS_MOCK: bool,

  /** Must be set to allow dev auth / mocks in a production build (e2e). */
  ALLOW_INSECURE_DEV_MODE: bool,
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  cached = parsed.data;
  guardInsecureModes(cached);
  return cached;
}

function guardInsecureModes(e: Env) {
  const insecure =
    e.AUTH_PROVIDER === "dev" || e.IMAGE_PROVIDER_MODE === "mock" || e.PAYMENTS_MOCK || e.STORAGE_DRIVER === "local";
  if (e.NODE_ENV === "production" && insecure && !e.ALLOW_INSECURE_DEV_MODE) {
    throw new Error(
      "Dev auth, mock providers or local storage are enabled in production. " +
        "Configure Supabase/Razorpay/providers, or set ALLOW_INSECURE_DEV_MODE=true for local e2e runs only.",
    );
  }
  if (e.AUTH_PROVIDER === "supabase" && (!e.NEXT_PUBLIC_SUPABASE_URL || !e.NEXT_PUBLIC_SUPABASE_ANON_KEY)) {
    throw new Error("AUTH_PROVIDER=supabase requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  if (e.STORAGE_DRIVER === "supabase" && (!e.NEXT_PUBLIC_SUPABASE_URL || !e.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error("STORAGE_DRIVER=supabase requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }
}

/** For tests only. */
export function resetEnvCache() {
  cached = null;
}
