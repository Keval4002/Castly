import { readFileSync } from "node:fs";
import sharp from "sharp";
import { MockImageModelV4, MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aspectRatio, resolveOptions } from "@/lib/catalog/options";
import { resetEnvCache } from "@/lib/env";
import type { PromptRequest } from "@/lib/prompt/shared";

// ---- Fake AI SDK providers: record calls, answer deterministically ----

const calls: { llm: string[]; llmOptions: unknown[]; image: { id: string; options: unknown }[] } = {
  llm: [],
  llmOptions: [],
  image: [],
};
const behaviour: Record<string, "ok" | "fail" | "garbage"> = {};
let classifierAnswer: Record<string, unknown> = {};

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 1, text: 1, reasoning: undefined },
    },
    warnings: [],
  };
}

function fakeLM(provider: string) {
  return (modelId: string) =>
    new MockLanguageModelV4({
      provider,
      modelId,
      doGenerate: async (options) => {
        calls.llm.push(provider);
        calls.llmOptions.push(options);
        if (behaviour[provider] === "fail") throw new Error(`${provider} down`);
        if (behaviour[provider] === "garbage") return textResult("not json");
        if (JSON.stringify(options.prompt).includes("You classify product photos")) {
          return textResult(JSON.stringify(classifierAnswer));
        }
        const n = Number((JSON.stringify(options.prompt).match(/Number of prompts: (\d)/) ?? [])[1] ?? 1);
        return textResult(
          JSON.stringify({
            product_summary: `${provider} saw a red dress`,
            prompts: Array.from({ length: n }, (_, i) => `${provider} prompt ${i} — keep the product exactly identical`),
          }),
        );
      },
    });
}

let png: Uint8Array;

function fakeImage(provider: string) {
  return (modelId: string) =>
    new MockImageModelV4({
      provider,
      modelId,
      doGenerate: async (options) => {
        calls.image.push({ id: provider, options });
        if (behaviour[provider] === "fail") throw new Error(`${provider} image down`);
        return { images: [png], warnings: [], response: { timestamp: new Date(), modelId, headers: {} } };
      },
    });
}

vi.mock("@/lib/ai/providers", () => {
  const withImage = (name: string) => () => Object.assign(fakeLM(name), { image: fakeImage(name) });
  return {
    google: withImage("google"),
    groq: withImage("groq"),
    anthropic: withImage("anthropic"),
    openai: withImage("openai"),
    fal: withImage("fal"),
  };
});

const req = (): PromptRequest => ({
  category: "clothing",
  values: resolveOptions("clothing", {}),
  aspectRatio: aspectRatio("4:5"),
  count: 2,
  recentPrompts: [],
  directions: ["a", "b"],
  preview: Buffer.from("fake-jpeg"),
});

beforeEach(async () => {
  png ??= new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: "#f00" } }).png().toBuffer());
  calls.llm = [];
  calls.llmOptions = [];
  calls.image = [];
  for (const k of Object.keys(behaviour)) delete behaviour[k];
});

afterEach(() => {
  process.env.PROMPT_LLM = "template";
  process.env.CLASSIFIER_MODE = "mock";
  process.env.IMAGE_PROVIDER_MODE = "mock";
  resetEnvCache();
  vi.unstubAllGlobals();
});

function setEnv(vars: Record<string, string>) {
  Object.assign(process.env, vars);
  resetEnvCache();
}

describe("prompt LLM via Vercel AI SDK", () => {
  it("uses the preferred LLM and sends the product preview as an image", async () => {
    setEnv({ PROMPT_LLM: "groq" });
    const { buildPromptPlan } = await import("@/lib/prompt/builder");
    const plan = await buildPromptPlan(req());
    expect(plan.source).toBe("groq");
    expect(plan.prompts).toHaveLength(2);
    expect(plan.productSummary).toBe("groq saw a red dress");
    expect(calls.llm).toEqual(["groq"]);
    expect(JSON.stringify(calls.llmOptions[0])).toContain('"type":"file"');
    // Groq: JSON mode instead of strict schema for broad model support.
    expect(JSON.stringify(calls.llmOptions[0])).toMatch(/json/i);
  });

  it("falls back through the other LLMs, then to the template", async () => {
    setEnv({ PROMPT_LLM: "gemini" });
    const { buildPromptPlan } = await import("@/lib/prompt/builder");

    behaviour.google = "fail";
    behaviour.groq = "garbage";
    const plan = await buildPromptPlan(req());
    expect(calls.llm).toEqual(["google", "groq", "anthropic"]);
    expect(plan.source).toBe("claude");

    behaviour.anthropic = "fail";
    const fallback = await buildPromptPlan(req());
    expect(fallback.source).toBe("template");
    expect(fallback.prompts).toHaveLength(2);
  });
});

describe("image providers via Vercel AI SDK", () => {
  const imgReq = () => ({
    prompt: "Using the provided product photo…",
    image: { data: readFileSync("tests/fixtures/product.jpg"), mime: "image/jpeg" },
    aspectRatio: aspectRatio("9:16"),
    variant: 0,
  });

  it("passes the product photo as an edit input with the right ratio", async () => {
    setEnv({ IMAGE_PROVIDER_MODE: "live" });
    const { generateWithFallback } = await import("@/lib/image/router");
    const out = await generateWithFallback("standard", imgReq());
    expect(out.provider).toBe("gemini");
    const opts = calls.image[0].options as { files: unknown[]; aspectRatio: string; prompt: string };
    expect(opts.files).toHaveLength(1);
    expect(opts.aspectRatio).toBe("9:16");
    expect(opts.prompt).toContain("product photo");
    expect(out.data.length).toBeGreaterThan(0);
  });

  it("falls back to the next provider in the tier chain", async () => {
    setEnv({ IMAGE_PROVIDER_MODE: "live" });
    behaviour.openai = "fail";
    const { generateWithFallback } = await import("@/lib/image/router");
    const out = await generateWithFallback("premium", imgReq());
    expect(calls.image.map((c) => c.id)).toEqual(["openai", "google"]);
    expect(out.provider).toBe("gemini");
    expect(out.attempts[0].provider).toBe("openai");
  });

  it("economy uses fal Seedream with an explicit size and multi-image input", async () => {
    setEnv({ IMAGE_PROVIDER_MODE: "live" });
    const { generateWithFallback } = await import("@/lib/image/router");
    const out = await generateWithFallback("economy", imgReq());
    expect(out.provider).toBe("fal-seedream");
    const opts = calls.image[0].options as { size: string; providerOptions: { fal: Record<string, unknown> } };
    expect(opts.size).toBe("1024x1820");
    expect(opts.providerOptions.fal.useMultipleImages).toBe(true);
  });
});

describe("free mode: Cloudflare Workers AI FLUX.2", () => {
  it("routes every tier to Cloudflare and sends a multipart reference image", async () => {
    setEnv({ IMAGE_PROVIDER_MODE: "free", CLOUDFLARE_ACCOUNT_ID: "acc123", CLOUDFLARE_API_TOKEN: "tok" });
    const seen: { url: string; form: FormData; auth: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen.push({ url, form: init.body as FormData, auth: new Headers(init.headers).get("authorization") ?? "" });
      return new Response(JSON.stringify({ success: true, result: { image: Buffer.from(png).toString("base64") } }), {
        headers: { "content-type": "application/json" },
      });
    });
    const { generateWithFallback, providersFor } = await import("@/lib/image/router");
    expect(providersFor("premium").map((p) => p.id)[0]).toBe("cloudflare");

    const out = await generateWithFallback("premium", {
      prompt: "catalogue shot",
      image: { data: readFileSync("tests/fixtures/product.jpg"), mime: "image/jpeg" },
      aspectRatio: aspectRatio("4:5"),
      variant: 0,
    });
    expect(out.provider).toBe("cloudflare");
    expect(seen[0].url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acc123/ai/run/@cf/black-forest-labs/flux-2-klein-4b",
    );
    expect(seen[0].auth).toBe("Bearer tok");
    expect(seen[0].form.get("prompt")).toBe("catalogue shot");
    const ref = seen[0].form.get("input_image_0") as Blob;
    const meta = await sharp(Buffer.from(await ref.arrayBuffer())).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThan(512);
    expect(Number(seen[0].form.get("width")) / Number(seen[0].form.get("height"))).toBeCloseTo(0.8, 1);
    expect((await sharp(out.data).metadata()).width).toBe(64);
  });

  it("free mode without Cloudflare keys makes tiers unavailable instead of using paid models", async () => {
    setEnv({ IMAGE_PROVIDER_MODE: "free", CLOUDFLARE_ACCOUNT_ID: "", CLOUDFLARE_API_TOKEN: "" });
    const { providersFor } = await import("@/lib/image/router");
    // Gemini (fake-configured here) is the only other free-chain member.
    expect(providersFor("premium").map((p) => p.id)).toEqual(["gemini"]);
  });
});

describe("product classifier via Vercel AI SDK", () => {
  it("classifies with the preferred LLM, falls back on failure, and normalises the answer", async () => {
    setEnv({ CLASSIFIER_MODE: "auto", PROMPT_LLM: "gemini" });
    behaviour.google = "fail";
    classifierAnswer = { category: "jewellery", product_type: "earrings", confidence: 0.88, description: "Jhumkas", issues: [] };
    const { classifyProduct } = await import("@/lib/classify/classifier");
    const result = await classifyProduct(Buffer.from("jpeg"));
    expect(calls.llm).toEqual(["google", "groq"]);
    expect(JSON.stringify(calls.llmOptions[1])).toContain('"type":"file"');
    expect(result).toMatchObject({ category: "jewellery", productType: "earrings", confidence: 0.88, source: "groq" });
  });

  it("returns null (never blocks) when every LLM fails or classification is off", async () => {
    setEnv({ CLASSIFIER_MODE: "auto", PROMPT_LLM: "groq" });
    behaviour.google = behaviour.groq = behaviour.anthropic = "fail";
    const { classifyProduct } = await import("@/lib/classify/classifier");
    expect(await classifyProduct(Buffer.from("jpeg"))).toBeNull();
    setEnv({ CLASSIFIER_MODE: "off" });
    expect(await classifyProduct(Buffer.from("jpeg"))).toBeNull();
  });
});
