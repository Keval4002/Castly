# Castly — AI catalogue photos for clothing & jewellery

Upload one product photo and get on-model, lifestyle and studio catalogue images for WhatsApp Business,
Instagram, marketplaces and your website. Credit-based and paid: new users get free credits, then top up via Razorpay.

## Stack

| Concern | Choice |
|---|---|
| App | Next.js 16 (App Router, route handlers, `after()` background jobs), React 19, Tailwind v4 |
| Auth | Supabase Auth: email OTP / magic link + Google |
| DB | Supabase Postgres via Drizzle ORM (RLS enabled, server-only access) |
| Storage | Supabase Storage, private bucket, signed URLs |
| Prompt LLM | Gemini 2.5 Flash-Lite (default) or Claude Haiku 5.5, with a deterministic template fallback |
| Image models | Tiered router: **Quick** Seedream v4 (fal) → **Studio** Gemini 2.5 Flash Image → **Premium** OpenAI gpt-image-1, each with automatic fallback |
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

## Adding a product category

Add an entry in `src/lib/catalog/options.ts` with its option groups (each choice carries a prompt
fragment), presets and any directions in `src/lib/prompt/shared.ts`. The Studio UI and prompt builder
pick it up automatically.

## Local development (no external accounts needed)

```bash
npm install
# Postgres running locally
createdb castly && createdb castly_test
cp .env.example .env.local   # then set the values below
```

Minimal `.env.local` for fully-offline dev:

```
DATABASE_URL=postgres://USER:PASS@localhost:5432/castly
AUTH_PROVIDER=dev
STORAGE_DRIVER=local
IMAGE_PROVIDER_MOCK=true
PAYMENTS_MOCK=true
PROMPT_LLM=template
ALLOW_INSECURE_DEV_MODE=true
```

```bash
npm run db:migrate
npm run dev
```

Add `GEMINI_API_KEY` / `FAL_KEY` / `OPENAI_API_KEY` and set `IMAGE_PROVIDER_MOCK=false` to use real
models. A production build **refuses to start** with dev auth or mocks unless `ALLOW_INSECURE_DEV_MODE=true`.

## Tests

```bash
npm test          # unit + DB integration (credits races, payments idempotency, generation lifecycle, refunds)
npm run test:e2e  # Playwright against a production build: signup → upload → generate → 402 → top-up → webhook → library
```

Set `PLAYWRIGHT_CHROMIUM_PATH` if you use a system Chromium. Both suites use the `castly_test` database.

## Production setup checklist

1. **Supabase:** create a project. Copy the URL, anon key and service-role key. Use the *transaction pooler*
   connection string for `DATABASE_URL`. Create a **private** storage bucket `castly`.
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
