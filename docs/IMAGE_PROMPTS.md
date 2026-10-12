# Image brief for Dukaanshot (paste into Antigravity)

Every site image is a plain placeholder until this brief is run. Copy everything between the lines below into Antigravity as one task.

---

You are working in the Dukaanshot repo, a Next.js app that turns one product photo into catalogue shots for Indian clothing and jewellery sellers. Your job is to **generate and save real images for every image slot on the website**, replacing the plain placeholder files. Do not change application code, layout or styles. Only replace image files, and update alt text in `src/lib/site-images.ts` if your image differs from the description.

## Rules for every image
- **Format and size:** save as **WebP** at the **exact path and pixel size** listed. Overwrite the existing placeholder and keep the filename. Target under 300 KB per file (quality 75–82).
- **Style:** premium, photorealistic, warm, natural light. Editorial e-commerce photography, the kind of quality a top Indian fashion or jewellery brand would publish. Shallow depth of field where it fits. True-to-life colours.
- **Brand palette:** use as accents where natural: awning orange `#FA743C`, deep navy `#2B2F78`, warm cream `#FBF6EC`, marigold `#F6AD2F`. Don't force them.
- **People:** Indian (South Asian) adults unless stated. Natural skin texture, correct hands and anatomy, modest and tasteful styling, no celebrities or look-alikes.
- **Never include:** text, captions, watermarks, logos, brand names, UI screenshots, or AI artefacts (warped hands, melted jewellery, extra fingers).
- **Backgrounds behind headlines** (hero, login, CTA) must be **calm with low detail in the centre and top**, so overlaid text stays readable. Keep busy detail at the edges and bottom.

## The showcase set (most important): keep one product consistent
The hero shows a seller's phone photo and four AI catalogue shots of **the same garment**. All five showcase images must show **the identical dress**: a **red cotton A-line midi dress with small gold block-print buti motifs, a round neck, short sleeves and a subtle maroon neckline piping**. Same colour, print, length and cut in every image. Generate the input first, then use it as the reference image for the four outputs.

| File | Size | Prompt |
|---|---|---|
| `public/images/showcase/input-product.webp` | 800×1000 | An amateur phone photo of the red A-line midi dress with small gold buti print, hanging on a plain wooden hanger against a slightly creased off-white wall in a small Indian shop. Flat indoor lighting, a little uneven, as a small seller would shoot it on a phone. The whole dress is visible and centred. |
| `public/images/showcase/output-studio.webp` | 800×1000 | Professional e-commerce catalogue photo: a South Asian woman in her late 20s wearing the exact same red A-line midi dress with gold buti print. Full body, standing relaxed and facing the camera, seamless pure white studio background, soft even studio lighting with a gentle floor shadow. Marketplace-ready. |
| `public/images/showcase/output-street.webp` | 800×1000 | Lifestyle fashion photo: the same woman wearing the exact same red buti-print A-line dress, walking mid-stride on a clean modern Indian city street (pastel buildings, softly blurred background), natural daylight, candid confident expression. Full body. |
| `public/images/showcase/output-heritage.webp` | 800×1000 | Fashion photo: the same woman in the exact same red buti-print A-line dress, standing in a Rajasthani haveli courtyard with sandstone arches and jharokha windows, warm golden-hour light, elegant pose. Full body. |
| `public/images/showcase/output-festive.webp` | 800×1000 | Festive evening fashion photo: the same woman in the exact same red buti-print A-line dress, on a terrace decorated with warm fairy lights and a few brass diyas, soft bokeh, Diwali mood, the dress clearly lit and true to colour. Full body. |

## Page images

| File | Size | Prompt |
|---|---|---|
| `public/images/hero/hero-background.webp` | 2400×1400 | Wide, airy lifestyle backdrop for a website hero: a bright, sun-washed Indian boutique interior at morning. Cream walls, rails of colourful sarees and kurtas softly out of focus at the **left and right edges**, a few warm marigold accents and a striped orange-and-cream shop awning visible at the edges. The **centre and top third are calm, light and nearly empty** (soft cream/sky tones) for headline text. Gentle depth of field, soft warm light, no people in focus. |
| `public/images/categories/clothing.webp` | 1200×800 | Flat-lay catalogue arrangement of Indian clothing on a warm cream linen surface: a folded silk saree with a zari border, an embroidered cotton kurta, a pastel dupatta and a pair of juttis. Overhead shot, soft natural window light, neat styling with negative space. |
| `public/images/categories/jewellery.webp` | 1200×800 | Luxury jewellery still life: a gold kundan necklace with matching jhumka earrings and a few stacked bangles on deep navy velvet, with a hint of marigold petals. Soft spotlight, crisp detail on the stones, elegant negative space. |
| `public/images/auth/login-background.webp` | 1920×1200 | Soft, out-of-focus background of a tidy Indian clothing boutique: warm cream tones, blurred garment rails and a hint of orange awning stripes at the edges. **Very low detail in the centre**, where a sign-in card sits. Bright and calm. |
| `public/images/studio/empty-state.webp` | 1600×1000 | A clean product-photography setup in a small Indian shop: a phone on a small tripod pointing at a neatly hung kurta, a soft light panel and a cream backdrop. Calm and inviting, **centre kept fairly plain** for an overlaid message card. |
| `public/images/cta/cta-background.webp` | 2400×1000 | Wide, moody evening view of a bustling Indian bazaar lane with clothing and jewellery shops, warm string lights and soft bokeh. Mostly dark navy and deep blue tones (a navy overlay sits on top). Low detail in the centre. |

## When done
1. Confirm every file above exists at the exact path and size, as WebP under about 300 KB.
2. Run `npm run dev`, then check `/`, `/login` and `/studio` (sign in with any email when `AUTH_PROVIDER=dev`). Make sure headlines stay readable on the hero, login and CTA backgrounds, and that the four showcase outputs clearly show the same dress as the input photo.
3. If an alt text no longer matches an image, update it in `src/lib/site-images.ts`. Change nothing else.

---
