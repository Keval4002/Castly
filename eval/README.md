# Eval harness (Phase 1 skeleton)

Product tuning cannot be done by eye. This harness runs the real image pipeline over a fixed, versioned set of
input photos and reports metrics, so thresholds can be chosen from data and providers (or a future in-house
pipeline) compared fairly.

## Run

```
npm run eval -- --cases all --shots 3
```

Flags: `--cases all|id,id|tag:<tag>|category:<cat>`, `--shots N` (default 3), `--tier economy|standard|premium`,
`--provider-mode mock|free|live` (default `mock`, sets `IMAGE_PROVIDER_MODE`), `--out <dir>` (default
`eval/runs/<timestamp>`), `--mock-judge`, `--live-llm`.

Mock mode is fully offline: template prompts and a fixed "pass" fidelity verdict, so it only proves the plumbing
(the `accepted` numbers are meaningless there; `report.json` records `mockJudge: true`). Use `--live-llm` to keep
the real prompt LLM and judge in mock mode. `free`/`live` use the keys in `.env.local` and cost real money/quota
(estimates from `src/lib/image/costs.ts`). The runner never touches the database (DATABASE_URL is overridden).

Output in `<out>/`: `report.json` (per-shot + per-case + overall), `report.md` (table), `images/`, `inputs/`,
`viewer.html` (self-contained; open it from the run folder so relative images load).
`eval/runs/` holds generated output: do not commit it (add it to .gitignore).

The pipeline pieces used: `buildPromptPlan` + `sampleDirections`/`sampleCastings`, `generateWithFallback`,
`finalizeOutput`, `judgeFidelity` (+ `passes` at `FIDELITY_THRESHOLD`), `estimateImageCostMicros`. Not yet
included: photo cleaning (`prepareProduct`), retry-on-fail loop, product-type classification.

## manifest.json schema (version 1)

```
{ "version": 1,
  "cases": [ { "id": "unique-slug", "category": "jewellery" | "clothing", "tags": ["..."],
               "input": "path/to/image (repo-relative)", "rights": "who owns it / licence / consent",
               "expectedShots": 3 } ] }
```
`expectedShots` is optional and informational. Bump `version` when cases are added/removed/changed so runs stay
comparable.

## Adding a case

1. Put the image under `eval/fixtures/` (or `tests/fixtures/`). Only images you have the right to keep in the repo:
   never real user uploads, never anything with personal data. Fill in `rights`.
2. Add an entry to `manifest.json` and bump `version`.
3. `npm run eval -- --cases <id> --shots 2` to check it runs.

## TODO: fixtures still to source (owner's spec; NOT in the manifest yet)

- Jewellery: clean ring, necklace on bust, earrings pair, glare-heavy gold, thin chain, stone-heavy,
  oxidised silver, glass bangles, worn-on-hand, blurry, dark, cropped, multiple pieces.
- Clothing: flat-lay kurta, hanger, saree border+pallu, heavy embroidery, small repeating print, graphic tee
  with text, sheer, three-piece set, wrinkled, mannequin, busy-background model photo.
- Non-product (should be rejected upstream, once an input gate exists): selfie, listing screenshot, meme,
  document, landscape, competitor watermark.

## Metrics (`src/lib/eval/metrics.ts`)

All are cheap proxies, not proof of fidelity.
- `dHash` / `hammingDistance`: 64-bit perceptual hash and bit distance between shots.
- `setDiversity`: pairwise difference between the shots of one case = 0.5 * hash/64 + 0.5 * colour-histogram
  distance (0 identical, 1 very different). Low min = near-duplicate shots (known weak spot: shot variety).
- `deltaE76` / `maskedColourDistance`: mean CIELAB distance between the product (optionally masked) and the
  central half of the output. Contaminated by backdrop, props and skin; only a rough "colour drifted" signal.
- `summarise`: failure rate, retry rate (fallback provider needed), accepted count, cost per accepted image
  (estimated spend on all shots / accepted), p50/p95 latency (successful shots).
- The automated gate is the existing LLM fidelity judge. `gate` is `pass`, `fail`, `unverified` (no judge
  answered; counts as not accepted) or `error` (no image).

## Human ratings and threshold tuning

1. Open `viewer.html`. Click an image to enlarge. Give each shot 1-5 stars and/or tag a reason it is bad
   (wrong colour, wrong stones/pattern, garbled text, bad hands/anatomy, too similar, other). Ratings autosave in
   the browser (localStorage, keyed by run id).
2. "Export ratings JSON", then `npx tsx scripts/eval/compare.ts ratings.json <out>/report.json`.
3. It prints precision/recall of the automated gate against human "bad" (1-2 stars or any reason tag):
   precision = of shots the gate rejected, how many were truly bad; recall = of truly bad shots, how many the
   gate rejected. Low recall means bad images are slipping through (raise `FIDELITY_THRESHOLD` or fix the judge);
   low precision means good images are wasted (lower it). Re-run across thresholds using the stored judge scores
   in `report.json`.

## Limits

- Fewer than ~30 rated shots is anecdotal; the compare script warns.
- One tier/provider per run; compare providers by running twice with the same manifest and diffing `report.md`.
- Mock provider output is a compositor stub, not a quality signal.
- Cost counts every provider attempted in the chain at list-price estimates, not billed amounts.
- The judge is itself an LLM and is noisy at temperature > 0 for some models; repeat runs before trusting a delta.

## Comparing the legacy flow with the shot planner

`npm run eval -- --cases all --shots 3 --planner off` (legacy: one shared reference) and `--planner v1` (per-shot specs,
product views and deterministic prompts, see `docs/SHOT_PLANNER.md`) run the same cases; compare `diversity`
in the two `report.json` files. **In mock mode the numbers only prove the wiring** (the mock provider composites
whatever reference it is given); the comparison is meaningful with `--provider-mode live` (or `free`) and real
fixtures. Without a real BiRefNet mask the runner cuts the product out by keying the near-white background, which
is only valid for plain-background fixtures.
