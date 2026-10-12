# Pipeline diagnosis: why images in a set look alike

Phase 0, read-only. Produced by a subagent and spot-checked by the lead: verified that no seed is passed to any provider (`src/lib/image/types.ts:8` documents `variant` but only the mock provider reads it), and that generation runs inside one request via `after()` (`src/app/api/generations/route.ts:18`). The hypothesis verdicts and the rest of the file:line evidence below are the subagent's and have not been independently re-checked.


Working tree = uncommitted state on branch claude/catalogue-image-generation-zu00oe.

## 1. Verdict per hypothesis

| # | Hypothesis | Verdict |
|---|---|---|
| 1 | One static prompt template, no per-shot spec | PARTLY REFUTED. There is per-variant variation (random "direction" + random "casting"), but it is shallow (see below). Everything that defines a scene (setting, pose, lighting, outfit/styling, backdrop, shot type, model look/age/body) is ONE batch-wide value shared by all N images. So "different background / outfit / pose / crop" is structurally impossible; only camera-angle phrase, hair/face/expression and props vary. Verdict: true in effect (no real per-shot spec). |
| 2 | Seeds identical/absent/uncontrollable | CONFIRMED (worse: no seed exists anywhere). `ImageRequest.variant` is documented "used by providers that accept seeds" (src/lib/image/types.ts:8) but NO real provider reads it. Only mock.ts uses `variant` (delay + label). grep for `seed` finds nothing in image providers. Retries pass `variant + attempt*10` (service.ts:247) which is also ignored. AI SDK `generateImage` supports `seed`, fal provider forwards it (node_modules/@ai-sdk/fal), OpenAI marks seed unsupported, Gemini image has no seed. Image temperature/guidance is never set either. Result: sampling randomness is the only diversity source and the identical anchor (below) overpowers it. |
| 3 | No cross-image diversity check | CONFIRMED for outputs. Diversity is only attempted at prompt time: pre-sampling of directions/castings, `recentPrompts` (last 6 prompts, same user+category) given to the LLM, and the LLM sees all N prompts in one call. Nothing compares the delivered images with each other (no embedding/pHash/VLM pairwise check). Each variant runs independently inside `Promise.all` (service.ts:173) with no knowledge of siblings. |
| 4 | Product conditioned only loosely | REFUTED as stated, but it is the real root cause in the opposite direction. Product is passed STRONGLY and identically to every call: same single cleaned cutout (product on pure white, 1536px, 8% padding, centred) as the image input of an edit model. Edit/instruction models (Gemini image, Kontext, Seedream edit, gpt-image-1 with `inputFidelity:"high"`) copy the composition, framing, scale and often pose/drape of the reference; the textual direction is a few words at the END of a ~100 word prompt. So all N outputs inherit the same layout from the same anchor. Mask/cutout IS used (reference.ts:67-80 returns `clean` JPEG; the alpha mask itself is discarded after compositing onto white, never stored or passed to a provider as an inpaint mask). Only 1 reference image per call. |
| 5 | Other | See section 3: batch-wide selections, same reference for all, same tier chain, same prompt skeleton "Using the provided product photo, create...", framing sentence forced into every prompt, aspect/crop identical, `finalizeOutput` re-crops with `position: "attention"`, retry loop can only add a CORRECTION suffix, enforce-mode fidelity pushes models toward "reproduce exactly as in photo / centred hero" (retry text at service.ts:256-258 literally says centred hero), which further collapses variety. No n-images-per-call (one call per shot), no caching of outputs. LLM temperature is 1 (non-Claude) so prompts themselves vary, but the LLM is told to keep the same framing + selections in all. |

## 2. Findings (with file:line)

### 2.1 How prompts are built today
- Entry: `runGeneration` (src/lib/generation/service.ts:134). Builds `castingInput`, then `buildPromptPlan({...})` at service.ts:157-165.
- `buildPromptPlan` (src/lib/prompt/builder.ts): tries LLMs in order (`llmOrder()`, default gemini then groq then claude), 12s timeout each, fallback `templatePrompts` (deterministic template). Source recorded in `generations.promptSource`.
- LLM call: src/lib/prompt/llm.ts:`llmPromptPlan` (line ~72-99): system prompt `SYSTEM_PROMPT` (shared.ts:35-51), user message `buildUserMessage` (shared.ts:53-73) with a 512px preview of the (cleaned) product, selections, framing, per-variant `directions`, `castings`, `recentPrompts`. One call returns `{product_summary, prompts[]}` for all N. temperature 1 (claude: default), maxOutputTokens 3000.
- Prompt requirements baked into SYSTEM_PROMPT: product identical, product is centred hero, include framing in every prompt, 60-110 words each, start with "Using the provided product photo, create...". This forces every prompt to be near-identical in structure and to centre the product.
- `coercePlan`/`enforceEssentials` (shared.ts:76-97) re-append the framing sentence and casting verbatim if the LLM dropped them.
- Template fallback `templatePrompts` (shared.ts:138-161): same sentence skeleton for all variants; only `direction` and casting differ.
- Direction pool: `DIRECTIONS` (shared.ts:101-126), 10 phrases per category, `sampleDirections` (shared.ts:128) = random sampling without replacement using `Math.random` (not seeded, not stored). Clothing directions are camera/mood phrases ("symmetrical editorial", "soft bokeh"); several are near-synonyms ("setting hinted through bokeh" vs "soft background bokeh"). They never change setting, outfit, shot type.
- Casting pool: `sampleCastings` (shared.ts:245-273): per-variant face shape, complexion (within model_look), hair, expression, feature, makeup/grooming, hand model. Good start; dedup within batch via `used` sets and soft-avoid `recentPrompts`. Not stored per shot; only the free text prompt is stored.
- Options catalog (src/lib/catalog/options.ts): groups per category: clothing = presentation(shot type), model_gender, model_look, model_age, body_type, pose, setting, lighting, occasion; jewellery = presentation, style, backdrop, model_*. All are single-select, batch-wide `generations.options` jsonb. `framingFor` (options.ts:587) returns a mandatory hero framing string tied to presentation (e.g. "model centred, full outfit ~80% of frame height").
- docs/IMAGE_PROMPTS.md is NOT about generation prompts: it is an Antigravity brief for website marketing images. There is no prompt documentation for the product pipeline.

### 2.2 Seeds
- No seed field anywhere in schema, service, types or providers. `variant` index exists in `ImageRequest` but unused by real providers (only mock.ts:22,35).
- Provider capability (from AI SDK): fal providers accept `seed` via `generateImage({seed})`; OpenAI image: unsupported; Google Gemini image: no seed. Cloudflare FLUX.2 REST accepts a `seed` form field (not currently sent, verify against CF docs). So a seed alone cannot be the diversity mechanism on the default Standard tier (Gemini first).

### 2.3 How the product is passed to each provider
- `productReference(source)` (src/lib/image/reference.ts:67): waits up to 6s for the background-removed "clean" JPEG (white bg, centred, 1536px), else falls back to the original upload.
- `ImageRequest.image = {data, mime}` single image (types.ts:6).
- AI SDK providers (src/lib/image/providers/aisdk.ts:32-38): `generateImage({ prompt: { text, images: [req.image.data] }, ...settings })`: gemini (`GEMINI_IMAGE_MODEL`, default gemini-3.1-flash-image, native aspect ratios), fal-seedream (`seedream/v4/edit`, `useMultipleImages:true`), fal-kontext (`flux-pro/kontext`, ratio map), openai (`gpt-image-1`, quality high, `inputFidelity high`, size 1024x1024/1536x1024/1024x1536). No seed, no guidance, no negative prompt, no mask.
- Cloudflare (providers/cloudflare.ts:25-39): reference downscaled to <512px (klein limit), sent as `input_image_0`; free mode only.
- Mock: composites product at 70% on gradient from prompt hash.
- Fidelity judge: src/lib/image/fidelity.ts, compares cleaned reference vs output with a vision LLM (feature checklist + prominence). Gate `passes()` requires prominence hero|clear (quality.ts:37), which punishes wide/environmental/detail shots and pushes toward same hero framing.
- Prep pipeline: src/lib/image/prepare.ts (BiRefNet mask via fal or local, hole repair `repairMask`, `composeWithMask`, white placement). Mask is thrown away after compositing; only the white-bg JPEG is stored (`assets.cleanKey`).

### 2.4 Number of images per generation and execution
- `count` 1..4 (`MAX_VARIANTS=4`, src/lib/pricing.ts:203; zod in src/lib/catalog/request.ts:14), chosen in StudioClient (`count` state, default 2).
- `createGeneration` (service.ts:35-113): one transaction inserts `generations` row, `count` empty `generation_images` rows (idx 0..count-1), and debits credits (`applyCreditMovement`, idempotency `generation:<id>`). Max 3 active generations/user (`MAX_ACTIVE_GENERATIONS`).
- POST /api/generations (src/app/api/generations/route.ts): rate limit 20/min, 202, then `after(() => runGeneration(id))`, `maxDuration=300`.
- `runGeneration`: plan prompts once, then `Promise.all` over prompts: one provider call per shot (no n-per-call), each through `generateFaithfully` (service.ts:238-267): up to `GENERATION_MAX_ATTEMPTS` (default 2) tries, `generateWithFallback` along the tier chain, `finalizeOutput` (cover-crop to exact aspect, position attention), judge, retry with CORRECTION suffix, `bestAttempt`; in `enforce` mode failing images are not delivered.
- Per-image state: generation_images {idx, status, prompt, provider, model, assetId, fidelity jsonb, attempts, error, latencyMs}.

### 2.5 Tiers, models, credits
- Tiers (src/lib/pricing.ts:147-169): economy "Quick" 1 credit/image; standard "Studio" 2; premium "Premium HD" 8.
- Chains (src/lib/image/router.ts:14-21): economy [fal seedream, gemini, kontext]; standard [gemini, kontext, seedream]; premium [openai, gemini, kontext]. `IMAGE_PROVIDER_MODE` live | free (cloudflare then gemini) | mock. First available provider wins; later ones only on error.
- Credits: charged up-front for count*tier price inside the creation transaction; `finalizeGeneration` (service.ts:273-307) refunds failed images at tier price, idempotent key `refund:<id>`; stale reaper after 10 min. Failed fidelity (enforce) = refunded. Retries/attempts are NOT charged extra (cost absorbed). Planning LLM, judge LLM, bg-removal costs are also not charged.
- Packs: starter 40/199 INR, growth 110/499, business 360/1499 (pricing.ts:183-187). Signup bonus 10.

### 2.6 Storage URLs
- `saveAsset` (src/lib/assets.ts:11-42): keys `u/<userId>/<folder>/<uuid>.jpg` + `_t.webp`; outputs folder `out/<generationId>`; row in `assets`. Clean ref is `<base>_clean.jpg` / `_clean_t.webp` (reference.ts:32-34).
- `storage()` (src/lib/storage/index.ts): local FS driver (HMAC-signed `/api/files/<key>?exp&sig`, served by src/app/api/files/[...key]/route.ts) or Supabase Storage (`createSignedUrls`, TTL 3600s, private bucket). `signAssets` batches signing in `toDTOs`. URLs are never stored; signed on read.

### 2.7 Schema support
- Multiple input photos per product: NO. `generations.sourceAssetId` is a single non-null FK; no product table, no join table, no "angle/view" label on assets. `assets` has `kind` upload|output only. API schema takes a single `sourceAssetId`. Upload route handles one file.
- Per-shot rows: PARTIAL. `generation_images` is a per-shot row (idx, prompt, provider, model, assetId, fidelity, attempts), but it has no shot spec (shot type, angle, crop, background, outfit, model/casting, seed, negative constraints), no diversity score, no QA beyond fidelity, no per-shot credit cost, no parent/regeneration link.
- A "product profile" is only `assets.classification` (jsonb: category/type/description/confidence) + `generations.productSummary` text from the LLM. No structured attributes (colours, print, neckline, length, closure, jewellery stones/metal).

## 3. Root-cause ranking (why they look alike)
1. All N calls anchored on the same single white-background cutout with an edit model; composition/pose/scale are copied. (Hyp 4 inverse)
2. Scene selections are batch-wide (setting, pose, lighting, shot type, backdrop, style, model look/age/body), so differences exist only in prose "direction" and casting. (Hyp 1)
3. The framing + "centred hero" + "reproduce exactly" language is mandatory in every prompt and in retries; the fidelity gate requires hero/clear prominence, so wide/environmental/crop variety is filtered out or corrected back.
4. No seeds/guidance; Gemini/OpenAI can't take them anyway. (Hyp 2)
5. No post-hoc cross-image check, so near duplicates are delivered and billed. (Hyp 3)
6. Casting text is a weak lever: image models largely ignore a 30-word face description when conditioned on a product-only image, and hair is often occluded/same default.

## 4. Existing-vs-target gap map

| Target stage | Exists? | Where | Gap |
|---|---|---|---|
| Segmentation / cutout | YES | image/background.ts (BiRefNet fal/local), prepare.ts (repairMask, composeWithMask), assets.clean* | Mask discarded (only white-bg JPEG kept); no RGBA/transparent PNG, no mask stored; no multi-view, no crop-of-details assets; not used as inpaint mask or for compositing. |
| Product profile | PARTIAL | classify/classifier.ts (category/type/description), llm `product_summary`, `judgeFidelity` reference_features (computed per output, thrown away) | No persisted structured profile (colours, print scale, key features list, drape/length, worn-on zones, symmetry, scale cues); judge re-derives features for every shot. |
| Shot planner | MINIMAL | `sampleDirections` + `sampleCastings` + LLM prompt writer | No per-shot spec object; no scene axes (background/outfit/crop/angle/shot type/lighting) sampled jointly; direction pool is prose camera tips; plan not persisted (only final prompt). |
| Per-shot generation controls | NO | n/a | No seed, no per-shot reference selection, no per-shot aspect/crop, no provider-specific params. |
| Per-shot QA | PARTIAL (fidelity+prominence only) | image/fidelity.ts, quality.ts, generateFaithfully | No anatomy/artefact/text-watermark check, no spec-compliance check (did the shot match its planned angle/background/model?), no composition check; prominence rule fights variety. |
| Diversity enforcement | NO (prompt-time only) | recentPrompts, `used` sets in sampleCastings | No output similarity check, no regenerate-the-duplicate step, no cross-batch memory beyond prompt text. |
| Multi-photo input | NO | schema single sourceAssetId | Needs product/asset-group model. |
| Per-shot rows | PARTIAL | generation_images | Needs spec jsonb, seed, diversity metrics, QA verdicts. |
| Credits/refund per shot | YES | pricing.ts, credits.ts, finalizeGeneration | Fine; extend if added shot types have different prices. |

## 5. Recommended minimal shot-planner design (proposal only; nothing built)

Goal: make each image a different, explicit "shot spec", keep product anchor, keep current pipeline shape.

### 5.1 Data model (one migration, additive)
- `generation_images.spec jsonb` (ShotSpec, see below), `seed integer`, `diversity jsonb` (nearest-sibling similarity, resolved/regenerated flag). Keep `prompt` as the rendered string.
- `generations.profile jsonb` (ProductProfile) so the judge and planner reuse it. Optionally `assets.mask_key` to keep the alpha PNG.
- Defer multi-photo: later add `product_assets(generation_or_product_id, asset_id, view label)`; reference selection per shot reads from it. Not needed for v1.

### 5.2 Types (src/lib/prompt/plan.ts, new)
```
ShotSpec = {
  shotType: "full" | "half" | "detail" | "flat" | "ghost" | ... (subset allowed by category + compatibility rules)
  angle: "front" | "three_quarter" | "side" | "back" | "high" | "low" | "overhead"
  crop: "wide" | "medium" | "tight"
  background: { setting: SettingId, colourway?: string }   // varied across shots, within user-allowed set
  lighting: LightingId
  pose?: PoseId
  casting?: string                                         // existing sampleCastings output
  styling?: string                                         // complementary outfit/props, never competing with product
  seed: number
  productScale: "hero" | "clear"                           // per-shot prominence floor for QA
}
```

### 5.3 Planner (deterministic first, LLM only for wording)
1. `planShots(category, userOptions, count, rand)` in a new file next to shared.ts. Replace `sampleDirections`. Treat user selections as: (a) LOCKED axes (the ones the user explicitly changed from preset, plus presentation/gender/look/age/body) and (b) FREE axes (setting, pose, lighting, angle, crop, styling). Add a "Variety" toggle default ON: free axes are sampled per shot; OFF keeps today's behaviour (all shots share one setting).
2. Sample a Latin-hypercube style set: for each free axis choose values so no two shots share more than 1 axis value (greedy max-min Hamming distance over axes; cheap and testable with a seeded RNG). Draw the base seed from `generations.id` hash so a plan is reproducible; per-shot seed = hash(genId, idx). Persist.
3. Compatibility: reuse `enforceCompatibility` per shot (options.ts) so a bad combo (e.g. back view on a front-only product) is repaired.
4. Prompt rendering: keep the current LLM writer but pass it the structured spec per shot and say "angle/crop/background are fixed; do not repeat the product-centred hero sentence; vary composition". Template fallback renders from the same spec, so fallback is also varied. Drop the blanket "centred hero" language for non-hero crops and make framing per spec.crop.
5. Product conditioning: keep cleaned cutout as image 1. For on-model shots consider telling the model "use the product photo only for the garment; ignore its pose, framing and white background" (reduces copy of layout). On providers that take several images (gemini, seedream, kontext multi) allow a 2nd reference later (a different view/detail crop).

### 5.4 Seeds (where they work)
- Pass `seed` through `ImageRequest` -> `generateImage({seed})` for fal providers (seedream, kontext) and cloudflare form field; ignore for gemini/openai but still store it (used for planner reproducibility). Do not rely on seeds for diversity on the Standard/Premium chains; the spec is the diversity lever.

### 5.5 Per-shot QA + diversity (add after generation, before saving)
- Reuse `generateFaithfully` loop; extend the judge verdict with `matchesSpec` (angle/crop/background as planned) using the same VLM call (one extra field, no extra cost) and relax the prominence requirement by spec.crop (detail/tight allowed "clear").
- Diversity: after all shots finish (or incrementally against already-finished siblings), compute a cheap perceptual signature (sharp: 16x16 greyscale DCT/aHash + colour histogram of the background region = outside the cutout bbox) and compare pairwise; if distance < threshold, regenerate that shot ONCE with a changed spec axis (next-best background/angle) and a new seed, within the same credit (like a fidelity retry). Persist metrics in `generation_images.diversity`. Optionally a VLM "are these two the same composition?" fallback only for borderline cases.
- Caps: total attempts per shot stay <= GENERATION_MAX_ATTEMPTS+1 to bound cost; document absorbed cost in docs/PRICING.md.

### 5.6 Implementation order (smallest wins first)
1. Add `seed` + `spec` columns; plumb seed to fal/cloudflare (tiny).
2. Replace `sampleDirections` with `planShots` + "Variety" toggle that varies setting/pose/lighting/angle/crop per shot (largest visible effect; stays inside existing LLM/template flow).
3. Persist structured ProductProfile (reuse classifier + judge reference_features).
4. Prominence floor per crop + `matchesSpec` in judge.
5. Post-gen diversity check with one respec-regenerate.
6. Multi-photo inputs / product table (separate project).

### 5.7 Tests to add (match existing vitest style, tests/unit)
- planShots: seeded determinism, pairwise axis distance >= 2 for count 2..4, honours locked axes and compatibility rules.
- templatePrompts renders different background/angle per shot from spec.
- diversity signature: identical images flagged, distinct images pass.
- service test with mock provider asserting stored specs differ per idx and retries change seed/spec.
