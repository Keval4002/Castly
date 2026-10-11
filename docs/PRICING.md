# Per-image cost comparison & credit pricing

All numbers are **estimates gathered in Oct 2026** from provider pricing pages and
aggregators. Check each provider's live price page before launch. USD→INR assumed
at **₹88**.

## 1. What one image costs us (provider list price)

| Provider / model | Used for tier | USD / image | ≈ INR / image | Notes |
|---|---|---|---|---|
| fal · ByteDance Seedream v4 Edit | **Quick** (default) | $0.030 | ₹2.6 | Cheapest good product-preserving edit model |
| Google · Gemini 2.5 Flash Image ("Nano Banana") | **Studio** (default), Quick fallback | $0.039 | ₹3.4 | ~1,290 output tokens × $30/M; input image tokens negligible |
| fal · FLUX.1 Kontext Pro | Studio / Premium fallback | $0.040 | ₹3.5 | |
| fal · Nano Banana Pro (alternative premium) | — (optional) | $0.150 | ₹13.2 | Strong text/detail; option to cut Premium cost |
| OpenAI · gpt-image-1, quality *high*, portrait + high-fidelity input | **Premium** (default) | ~$0.25 + ~$0.04 input | ≈ ₹25.5 | Slowest (~30–60s) |
| OpenAI · gpt-image-1, *medium* | — (option) | ~$0.063 + input | ≈ ₹8 | |
| OpenAI · gpt-image-1-mini, *medium* / *high* | — (option) | $0.015 / $0.052 | ₹1.3 / ₹4.6 | Cheapest, but weaker at keeping the product identical |
| Prompt LLM: Gemini 2.5 Flash-Lite (default) or Claude Haiku 5.5 | per batch | ~$0.0005 | ₹0.04 | ~1.5k input + 0.6k output tokens incl. a 512px preview |

| **Free (testing): Cloudflare Workers AI FLUX.2 klein** | `IMAGE_PROVIDER_MODE=free` | $0 within 10k neurons/day | ₹0 | Then $0.011 / 1k neurons |
| **Free (testing): Groq Llama 4 Scout** prompt LLM | any | $0 on free tier | ₹0 | Rate-limited (~30 req/min) |

Storage and egress (Supabase) come to roughly ₹0.01 per image and can be ignored.

## 2. What a credit earns us (net)

Prices include 18% GST. Razorpay takes ~2% + GST on the fee (2.36%).

| Pack | Price | Credits | Gross ₹/credit | **Net ₹/credit** (after GST + Razorpay) |
|---|---|---|---|---|
| Starter | ₹199 | 40 | 4.98 | **4.12** |
| Growth | ₹499 | 110 | 4.54 | **3.75** |
| Business | ₹1,499 | 360 | 4.16 | **3.44** |

## 3. Margin per image at current defaults (worst case: Business pack)

| Tier | Credits / image | Net revenue | Primary cost | Margin | If it falls back to the next provider |
|---|---|---|---|---|---|
| Quick | 1 | ₹3.44 | ₹2.6 (Seedream) | **~24%** | Gemini ₹3.4 → ~0% |
| Studio | 2 | ₹6.88 | ₹3.4 (Gemini) | **~50%** | Kontext ₹3.5 → ~49% |
| Premium HD | 8 | ₹27.5 | ₹25.5 (gpt-image-1 high) | **~7%** | Gemini ₹3.4 → ~88% |

> Premium was 6 credits in the first draft, which **lost money** (₹20.6 < ₹25.5). It is now 8.
> For a healthy Premium margin, either charge **10 credits**, or route Premium to
> **Nano Banana Pro (₹13.2)** or **gpt-image-1 medium (≈ ₹8)** at 6 credits.

Free tier: 10 signup credits cost us at most **₹17 per new user** (5 Studio images), or ₹26 if
they're spent on Quick and every image falls back to Gemini.

## 4. Recommendations to decide on

1. **Quick tier margin is thin.** Options: keep it as the acquisition tier; raise Quick to
   1.5× by making packs ~10% smaller; or route Quick to gpt-image-1-mini (₹1.3).
2. **Premium:** 10 credits with gpt-image-1 high, *or* 6 credits with Nano Banana Pro.
3. **Pack ladder:** ~₹5 → ₹4.5 → ₹4.2 per credit is a sensible discount curve. Keep the Business pack
   above ₹4/credit gross so Quick stays non-negative.
4. **Abuse control on free credits:** Supabase verifies email, but consider phone OTP or device
   fingerprinting before raising the free grant.

Everything here is configured in `src/lib/pricing.ts` (credits, packs, signup bonus) and
`src/lib/image/router.ts` (which provider serves each tier).
