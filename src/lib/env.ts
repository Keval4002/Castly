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
  SUPABASE_STORAGE_BUCKET: z.string().default("dukaanshot"),
  LOCAL_STORAGE_DIR: z.string().default(".data/storage"),

  // Prompt LLM (via Vercel AI SDK). The preferred one is tried first, then any
  // other configured LLM, then a deterministic template.
  PROMPT_LLM: z.enum(["gemini", "groq", "claude", "template"]).default("gemini"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_PROMPT_MODEL: z.string().default("gemini-3.5-flash-lite"),
  /** Stricter vision model for the product-fidelity judge ("" = use the prompt model). */
  GEMINI_JUDGE_MODEL: z.string().default("gemini-3.5-flash"),
  GROQ_API_KEY: z.string().optional(),
  GROQ_PROMPT_MODEL: z.string().default("qwen/qwen3.8-27b"),
  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_PROMPT_MODEL: z.string().default("claude-haiku-5-5"),

  /** Product-photo classifier: auto = first configured vision LLM, mock = offline heuristic, off = disabled. */
  CLASSIFIER_MODE: z.enum(["auto", "mock", "off"]).default("auto"),

  /**
   * Product-photo cleaning right after upload (background removal with BiRefNet).
   * auto: fal when FAL_KEY is set, else the local model (not on Vercel), else basic trim/pad.
   * fal: hosted BiRefNet (fast; production). local: transformers.js on this server's CPU
   * (free; dev / self-hosted). off: basic trim/pad only.
   */
  BACKGROUND_REMOVAL: z.enum(["auto", "fal", "local", "off"]).default("auto"),
  LOCAL_MODEL_DIR: z.string().default(".data/models"),

  /**
   * Product-fidelity check on every generated image (vision LLM compares it to the product).
   * enforce: regenerate when the product changed, refund if it still differs.
   * flag: keep the best attempt and record the score. off: no check.
   */
  FIDELITY_MODE: z.enum(["enforce", "flag", "off"]).default("enforce"),
  FIDELITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.8),
  /** Emergency stop: true pauses all paid image generation (needs a restart; scripts/kill-switch.ts is instant). */
  GENERATION_PAUSED: bool,
  /**
   * How a generation's shots are started. http = each shot runs in its own function invocation (production);
   * inline = shots run inside the job's own invocation (local dev and tests). Default: http in production, else inline.
   */
  SHOT_DISPATCH: z.enum(["http", "inline"]).optional(),
  /** Where operational alerts are POSTed as JSON ({text, content}); alerts are always logged either way. */
  ALERT_WEBHOOK_URL: z.string().url().optional(),
  /**
   * Shot planner. v1 = every shot gets its own structured spec, product reference view and prompt (see src/lib/shots);
   * off = the legacy single-reference flow. Default: v1 outside production, off in production until you flip it
   * (roll out, run the eval set, compare, keep `off` as the instant rollback).
   */
  SHOT_PLANNER: z.enum(["v1", "off"]).optional(),
  /** Bearer token for /api/cron/sweep (Vercel Cron sends it automatically when CRON_SECRET is set). */
  CRON_SECRET: z.string().min(16).optional(),
  /** Pause before re-asking the fidelity judge when it errored. */
  FIDELITY_JUDGE_RETRY_DELAY_MS: z.coerce.number().int().min(0).max(30_000).default(1500),
  /** Image attempts per variant, including fidelity retries. */
  GENERATION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(3).default(2),

  // Image providers
  /**
   * live: paid production chains (fal / Gemini / OpenAI)
   * free: free-tier models only (Cloudflare Workers AI FLUX.2, Gemini free quota) — for testing
   * mock: offline compositor (dev / e2e only)
   */
  IMAGE_PROVIDER_MODE: z.enum(["live", "free", "mock"]).default("live"),
  GEMINI_IMAGE_MODEL: z.string().default("gemini-3.1-flash-image"),
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
