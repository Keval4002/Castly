/**
 * Live smoke test against real models — no database or server needed.
 *
 *   IMAGE_PROVIDER_MODE=free PROMPT_LLM=groq \
 *   GROQ_API_KEY=... CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
 *   npm run smoke -- [path/to/product.jpg] [clothing|jewellery] [tier] [productType] [presetId]
 *
 * Reads .env.local, then .env. Probes every configured LLM individually
 * (classifier + prompt plan), then runs the full pipeline: photo cleaning →
 * prompt plan with per-variant castings → image chain → fidelity check.
 * Writes the cleaned reference and images to .data/smoke/.
 */
import { config } from "dotenv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

config({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const [file = "tests/fixtures/product.jpg", category = "clothing", tier = "standard", type, presetId] = process.argv.slice(2);
  process.env.DATABASE_URL ??= "postgres://unused";
  const { aspectRatio, resolveOptions, CATEGORIES } = await import("../src/lib/catalog/options");
  const { finalizeOutput, llmPreview, normalizeUpload } = await import("../src/lib/image/process");
  const { prepareProduct } = await import("../src/lib/image/prepare");
  const { judgeFidelity } = await import("../src/lib/image/fidelity");
  const { buildPromptPlan } = await import("../src/lib/prompt/builder");
  const { sampleCastings, sampleDirections } = await import("../src/lib/prompt/shared");
  const { generateWithFallback, providersFor } = await import("../src/lib/image/router");
  const { LLM_IDS, isLLMConfigured, llmPromptPlan } = await import("../src/lib/prompt/llm");
  const { classifyProduct } = await import("../src/lib/classify/classifier");
  type Cat = keyof typeof CATEGORIES;

  const cat = category as Cat;
  const ar = aspectRatio("4:5");
  const preset = CATEGORIES[cat].presets.find((p) => p.id === presetId) ?? CATEGORIES[cat].presets[0];
  const productType = type ?? null;
  const values = resolveOptions(cat, preset.values, productType);
  mkdirSync(".data/smoke", { recursive: true });

  const upload = await normalizeUpload(readFileSync(file));
  let t = Date.now();
  const prepared = await prepareProduct(upload.data);
  const product = prepared.clean;
  writeFileSync(".data/smoke/reference.jpg", product.data);
  console.log(`Cleaned photo via ${prepared.method} in ${Date.now() - t}ms (repaired ${prepared.repairedPixels}px) → .data/smoke/reference.jpg`);

  const preview = await llmPreview(product.data);
  const base = { category: cat, values, productType, aspectRatio: ar, count: 2, preview, recentPrompts: [], directions: sampleDirections(cat, 2) };
  const req = { ...base, castings: sampleCastings(base) };

  // Each LLM on its own, so a working fallback can't hide a broken key.
  console.log("\nLLM probes:");
  for (const id of LLM_IDS) {
    if (!isLLMConfigured(id)) {
      console.log(`  ${id}: not configured`);
      continue;
    }
    const start = Date.now();
    try {
      const p = await llmPromptPlan(id, req, 30_000);
      console.log(`  ${id}: ${p ? "OK" : "bad output"} in ${Date.now() - start}ms`);
    } catch (err) {
      console.log(`  ${id}: FAILED in ${Date.now() - start}ms: ${(err as Error).message}`);
    }
  }

  t = Date.now();
  const classification = await classifyProduct(preview);
  console.log(`\nClassifier in ${Date.now() - t}ms:`, classification ?? "(none — no LLM answered)");

  console.log(`\nPreset: ${preset.id}`, values);
  console.log(`Image providers for ${tier}:`, providersFor(tier as never).map((p) => `${p.id} (${p.model})`));
  t = Date.now();
  const plan = await buildPromptPlan(req);
  console.log(`\nPrompt plan via ${plan.source} in ${Date.now() - t}ms`);
  console.log("Product:", plan.productSummary || "(n/a)");
  plan.prompts.forEach((p, i) => console.log(`\n[${i + 1}] ${p}`));

  t = Date.now();
  const results = await Promise.allSettled(
    plan.prompts.map((prompt, variant) =>
      generateWithFallback(tier as never, { prompt, image: { data: product.data, mime: product.mime }, aspectRatio: ar, variant }),
    ),
  );
  for (const [i, r] of results.entries()) {
    if (r.status === "rejected") {
      console.error(`\nVariant ${i + 1} failed: ${(r.reason as Error).message}`);
      continue;
    }
    const out = await finalizeOutput(r.value.data, ar);
    const path = `.data/smoke/variant-${i + 1}.jpg`;
    writeFileSync(path, out.data);
    const j = Date.now();
    const verdict = await judgeFidelity(product.data, out.data, plan.productSummary);
    console.log(`\nVariant ${i + 1}: ${r.value.provider}/${r.value.model} → ${path}`);
    console.log(`  Fidelity in ${Date.now() - j}ms:`, verdict ?? "unverified (no judge answered)");
  }
  console.log(`\nImages + checks took ${Date.now() - t}ms`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
