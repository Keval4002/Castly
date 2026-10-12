# Dukaanshot — AI catalogue photos for clothing & jewellery

Upload one product photo and get on-model, lifestyle and studio catalogue images for WhatsApp Business,
Instagram, marketplaces and your website. Credit-based and paid: new users get free credits, then top up via Razorpay.

## Brand

| | |
|---|---|
| Logo | `public/brand/dukaanshot-logo.png` (wordmark) and `public/brand/dukaanshot-mark.png` (shop mark). App icons are in `src/app/icon.png` and `apple-icon.png`. To update everywhere, replace the files and keep the names. |
| Colours | Awning orange `#FA743C`, ink navy `#2B2F78`, cream `#FBF6EC`, marigold `#F6AD2F`. Tokens are in `src/app/globals.css`. |
| Type | **Sentient** for display and the italic highlight words, **Author** for body text, **Ranade** for UI (nav, buttons, chips, labels). All three are by Indian Type Foundry and loaded from Fontshare (free for commercial use). To self-host, put the `.woff2` files in `public/fonts` and uncomment the `@font-face` block in `globals.css`. |
| Icons | [Lucide](https://lucide.dev) line icons everywhere (`lucide-react`). Don't use emoji or unicode symbols. |
| Images | Every site image is listed in `src/lib/site-images.ts` and stored in `public/images/`. They start as plain placeholders; generate the real ones with `docs/IMAGE_PROMPTS.md`. To replace one, overwrite the file and keep the name and aspect ratio. |

## Stack

| Concern | Choice |
|---|---|
| App | Next.js 16 (App Router, route handlers, `after()` background jobs), React 19, Tailwind v4 |
| Auth | Supabase Auth: email OTP / magic link + Google |
| DB | Supabase Postgres via Drizzle ORM (RLS enabled, server-only access) |
| Storage | Supabase Storage, private bucket, signed URLs |
| AI layer | **Vercel AI SDK** (`ai` v7): `generateText` + `Output.object` for prompts, `generateImage` with `prompt.images` for product edits |
| Prompt LLM | Gemini 2.5 Flash-Lite (default), **Groq Llama 4 Scout (free)**, or Claude Haiku 5.5, then a deterministic template fallback |
| Image models | Tiered router: **Quick** Seedream v4 (fal) → **Studio** Gemini 2.5 Flash Image → **Premium** OpenAI gpt-image-1, each with automatic fallback. **Free mode:** Cloudflare Workers AI FLUX.2 |
| Payments | Razorpay Orders + Checkout + signed webhooks |

## How a generation works

1. The browser compresses the photo (≤2048px JPEG) and uploads it to `POST /api/uploads`. The server
   normalises it with sharp (EXIF rotation, size cap) and stores it with a 512px WebP thumbnail.
2. `POST /api/generations` validates the options against the catalogue, then in **one DB transaction**
   creates the job and its N image slots and debits `N × tier credits`. It returns `202` immediately.
3. `after()` runs the job: the prompt LLM looks at a 512px preview plus the selections, a creative
   direction per variant and the user's recent prompts. It returns N distinct, product-preserving
   prompts and a product summary. Variants then render in parallel through the tier's provider chain,
   and each output is cropped to the exact aspect ratio and stored.
4. The client polls `GET /api/generations/:id` every 1.5s, and images appear as they finish.
5. Failed images are **refunded automatically** (idempotent). Jobs stuck for more than 10 minutes
   (for example a killed lambda) are reaped and refunded.

Credits use an append-only ledger with a unique idempotency key per movement, and the balance has a
`CHECK >= 0`. Signup bonus, debits, refunds and purchases are therefore exactly-once even under races.
Payments are fulfilled by both the checkout callback and the webhook, and only the first one credits.

## Product detection (classifier)

On upload, a vision LLM classifies the photo. It runs alongside storage, so it adds no extra upload time. It
uses the same preference order as the prompt LLM: Gemini Flash-Lite → Groq Llama 4 Scout → Claude Haiku.
It returns the **category** (clothing / jewellery / other), the **product type** (saree, kurta, necklace,
earrings, ring…), a **confidence**, a one-line description and photo issues (multiple products, blurry, cut
off, poor lighting).

- **Studio** pre-selects the detected category and type. It shows a warning when the seller picks something
  else, plus an "I'm sure — use my selection" override.
- **Server** (`reconcileProduct`, `src/lib/classify/reconcile.ts`): a detection with confidence ≥ 0.75 corrects a
  mismatched category or type. Options from the wrong category are replaced with that category's first preset.
  The correction is stored on the generation and shown to the seller. Photos that are confidently not
  clothing or jewellery are refused with 422, without charging. Low-confidence or failed detection never
  blocks: the seller's choice is used as is.
- **Prompts** use the precise product noun, the classifier's description and where the piece is worn (for
  example "earrings on both ears") for on-model shots, so the model doesn't put a necklace on a wrist.
- `CLASSIFIER_MODE=mock` (tests) uses a brightness heuristic: dark photo → ring, otherwise dress. `off`
  disables detection.

## Adding a product category

Add an entry in `src/lib/catalog/options.ts` with its option groups (each choice carries a prompt
fragment), presets and any directions in `src/lib/prompt/shared.ts`. The Studio UI and prompt builder
pick it up automatically. Add its `productTypes` too, and the classifier will learn the new labels.

## Local development (no external accounts needed)

```bash
npm install
# Postgres running locally
createdb dukaanshot && createdb dukaanshot_test
cp .env.example .env.local   # then set the values below
```

Minimal `.env.local` for fully-offline dev:

```
DATABASE_URL=postgres://USER:PASS@localhost:5432/dukaanshot
AUTH_PROVIDER=dev
STORAGE_DRIVER=local
IMAGE_PROVIDER_MODE=mock
PAYMENTS_MOCK=true
PROMPT_LLM=template
ALLOW_INSECURE_DEV_MODE=true
```

```bash
npm run db:migrate
npm run dev
```

Add `GEMINI_API_KEY` / `FAL_KEY` / `OPENAI_API_KEY` and set `IMAGE_PROVIDER_MODE=live` to use real
models. A production build **refuses to start** with dev auth or mocks unless `ALLOW_INSECURE_DEV_MODE=true`.

## Testing with free models (₹0)

To run the real pipeline without spending anything:

| What | Free option | Get a key |
|---|---|---|
| Prompt LLM | **Groq**: `meta-llama/llama-4-scout-17b-16e-instruct` (vision, very fast) | console.groq.com, no card |
| Prompt LLM | **Gemini 2.5 Flash-Lite** free tier | aistudio.google.com |
| Image edit | **Cloudflare Workers AI**: FLUX.2 klein 4B with a reference image (10k neurons/day) | dash.cloudflare.com → Workers AI → API token |
| Image edit | Gemini Flash Image, *if* your free-tier key has image quota (Google has changed this several times) | aistudio.google.com |

```bash
# .env.local
PROMPT_LLM=groq
GROQ_API_KEY=gsk_...
IMAGE_PROVIDER_MODE=free
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...

npm run smoke -- path/to/product.jpg jewellery   # prints the prompt plan and saves images to .data/smoke/
npm run dev                                      # or test the whole app with free models
```

In `free` mode every tier uses the free chain (Cloudflare first, then Gemini). Paid providers are never
called, even if their keys are present. Free models are good enough to test the flow but keep the product
less faithfully than the paid tiers, so don't judge final quality from them. You can swap in the larger
`@cf/black-forest-labs/flux-2-dev` via `CLOUDFLARE_IMAGE_MODEL`.

## Tests

```bash
npm test          # unit + DB integration (credits races, payments idempotency, generation lifecycle, refunds,
                  # AI SDK prompt/image routing with mock models, Cloudflare free provider request shape)
npm run test:e2e  # Playwright against a production build: signup → upload → generate → 402 → top-up → webhook → library
```

Set `PLAYWRIGHT_CHROMIUM_PATH` if you use a system Chromium. Both suites use the `dukaanshot_test` database.

## Production setup checklist

1. **Supabase:** create a project. Copy the URL, anon key and service-role key. Use the *transaction pooler*
   connection string for `DATABASE_URL`. Create a **private** storage bucket `dukaanshot`.
2. **Auth:** enable Email (OTP) and Google providers. Add `https://YOUR_DOMAIN/auth/callback` to the
   redirect URLs. Include `{{ .Token }}` in the magic-link email template so users can type the code.
3. Run `npm run db:migrate` against production.
4. **Razorpay:** add the API keys, and create a webhook to `https://YOUR_DOMAIN/api/webhooks/razorpay` for
   `payment.captured`, `order.paid` and `payment.failed`, using the same secret as `RAZORPAY_WEBHOOK_SECRET`.
   Enable auto-capture.
5. **Providers:** set `GEMINI_API_KEY` (prompt LLM + Studio), `FAL_KEY` (Quick + fallbacks) and
   `OPENAI_API_KEY` (Premium). Tiers whose providers are all missing are shown as unavailable.
6. Deploy (Vercel recommended). `/api/generations` sets `maxDuration = 300` for background jobs.
7. Review `docs/PRICING.md` and set the credit prices in `src/lib/pricing.ts`.

## Known limitations / next steps

- The rate limiter is per instance (in-memory). Put Upstash/Redis behind `rateLimit()` before scaling out.
- Jobs run inside the request lambda via `after()`. For very high volume, move them to a queue
  (Inngest, Trigger.dev or Supabase Queues). `runGeneration()` is already idempotent and claim-based.
- Batch upload (many products → one look) is a natural next feature, and the router already supports it.
