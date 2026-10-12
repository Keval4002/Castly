# Shot planner (Phase 2)

## Why the images in a set looked alike

(Evidence in `docs/pipeline-diagnosis.md`.) Every shot of a set was generated from the **same** cleaned, centred,
white-background cutout, and edit models copy the layout, scale and pose of their reference. The per-shot direction
was a few words at the end of the prompt, the LLM system prompt told every shot to make the product "centred, large,
the hero", no seed was sent, and nothing compared the outputs.

## What changed

| Before | Now (`SHOT_PLANNER=v1`) |
|---|---|
| one reference for every shot | every shot gets its **own reference view** of the product (centred, off-centre, small/loose, a real close-up crop, slight tilt), cut from a transparent cut-out (`assets.cutout_key`) |
| 1 free-text direction per shot | a structured **ShotSpec** from a fixed, versioned vocabulary (framing, angle, pose, background, lighting, styling, hair, model slot, view) stored in `generation_images.spec` |
| same "centred hero" wording everywhere | the **shot direction leads the prompt**; "hero" wording only on hero shots |
| one prominence rule (hero/clear) | per-shot `minProminence`: close-ups `clear`, wide/styled shots `small` (visible, details judgeable) |
| no variety control | every pair of shots must differ on **at least 3** attributes (`minDifferences`); if locks make that impossible the plan says so (`relaxed`, real `minPairwiseDiff`) |
| clothing back view / fabric macro = invented | **skipped** unless the seller supplied a back / detail photo; the reason is stored and shown ("A back view needs a back photo") |
| one seed | a recorded seed per shot (and per retry), sent to providers that accept one |

Code: `src/lib/shots/` (types, presets as data, planner, prompt builder), `src/lib/image/views.ts` (reference views),
`src/lib/image/profile.ts` (measured product profile), `src/lib/generation/planning.ts` (glue).

## Design notes and deliberate deviations

- **No LLM in the v1 planner.** The kickoff note proposed using the prompt LLM as an "art director" that selects the
  enumerated values. v1 selects them deterministically (seeded, max-min variety), which is free, reproducible and
  testable, and renders prompts with a deterministic builder. The LLM path (`buildPromptPlan`) is unchanged and is
  still used when `SHOT_PLANNER=off` or planning fails. Adding the LLM as a *selector* later only needs a second
  implementation of `planShots`.
- **Product profile is measured**, not guessed: dominant colours of the product's own pixels (names + hex), metal
  tone for jewellery, size and solidity. It feeds the prompt ("preserve exactly…") and the styling choice (outfits
  that would clash with the stones are avoided). QA still uses the vision judge; measured colour distance on the
  masked region is Phase 3.
- **The judge compares against the full cleaned product photo**, never against a shot's close-up crop.
- **Cloudflare FLUX.2 klein accepts references < 512 px.** Each view is therefore also rendered *directly* at ≤ 511 px
  with the product filling more of the frame (`image.small`), instead of downscaling the big canvas and ending up
  with a tiny product. A close-up crop of a small cut-out cannot be sharper than the cut-out: `detailLoss` is
  recorded when a crop had to be upscaled more than 2×, and presets skip close-ups for low-resolution products.
- **Adult models only.** There is no child wording in the vocabulary; child models stay off
  (`CHILD_MODELS_ENABLED=false`) until a human-review flow exists.
- **Rollout.** `SHOT_PLANNER` defaults to `v1` outside production and `off` in production, so deploying the code
  changes nothing until you flip it. Run `npm run eval` for both modes first and compare diversity (see
  `eval/README.md`); `off` is the instant rollback.

## Not done in Phase 2 (proposals)

- **Crop the real input instead of generating** close-ups when the photo is sharp enough (the kickoff note asks for
  this to be confirmed before building): the `detail_*` reference views already cut real pixels, so a shot could
  deliver that crop directly. Needs your decision because it delivers an unprocessed photo crop as a "generated" image.
- Seller-facing UI to **add the missing back/detail photo** from the card. The API exists
  (`POST /api/products/:id/photos`); the card currently shows the reason only.
- Set-level **diversity gate** (embeddings / perceptual hashes with a regenerate) and measured colour/structure QA:
  Phase 3.
