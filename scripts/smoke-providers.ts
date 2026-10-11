/**
 * Live smoke test against real models — no database or server needed.
 *
 *   IMAGE_PROVIDER_MODE=free PROMPT_LLM=groq \
 *   GROQ_API_KEY=... CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
 *   npm run smoke -- [path/to/product.jpg] [clothing|jewellery] [tier]
 *
 * Writes the prompt plan to stdout and images to .data/smoke/.
 */
import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

async function main() {
  const [file = "tests/fixtures/product.jpg", category = "clothing", tier = "standard"] = process.argv.slice(2);
  process.env.DATABASE_URL ??= "postgres://unused";
  const { aspectRatio, resolveOptions, CATEGORIES } = await import("../src/lib/catalog/options");
  const { finalizeOutput, llmPreview, normalizeUpload } = await import("../src/lib/image/process");
  const { buildPromptPlan } = await import("../src/lib/prompt/builder");
  const { sampleDirections } = await import("../src/lib/prompt/shared");
  const { generateWithFallback, providersFor } = await import("../src/lib/image/router");
  type Cat = keyof typeof CATEGORIES;

  const cat = category as Cat;
  const product = await normalizeUpload(readFileSync(file));
  const ar = aspectRatio("4:5");
  const values = resolveOptions(cat, CATEGORIES[cat].presets[0].values);

  console.log(`Image providers for ${tier}:`, providersFor(tier as never).map((p) => `${p.id} (${p.model})`));
  let t = Date.now();
  const plan = await buildPromptPlan({
    category: cat,
    values,
    aspectRatio: ar,
    count: 2,
    preview: await llmPreview(product.data),
    recentPrompts: [],
    directions: sampleDirections(cat, 2),
  });
  console.log(`\nPrompt plan via ${plan.source} in ${Date.now() - t}ms`);
  console.log("Product:", plan.productSummary || "(n/a)");
  plan.prompts.forEach((p, i) => console.log(`\n[${i + 1}] ${p}`));

  mkdirSync(".data/smoke", { recursive: true });
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
    console.log(`\nVariant ${i + 1}: ${r.value.provider}/${r.value.model} → ${path}`);
  }
  console.log(`\nImages took ${Date.now() - t}ms`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
