import { after, NextResponse } from "next/server";
import { z } from "zod";
import { api, HttpError, rateLimit } from "@/lib/api";
import { requireProfile } from "@/lib/auth/session";
import { toCreateInput, simpleGenerationSchema } from "@/lib/catalog/request";
import { InsufficientCreditsError } from "@/lib/credits";
import { createGeneration, GenerationError, runQueue } from "@/lib/generation/service";
import { generationCost, DEFAULT_TIER } from "@/lib/pricing";
import { DEFAULT_COUNT } from "@/lib/catalog/simple";
import { getOwnedProduct, listProducts } from "@/lib/products";

export const dynamic = "force-dynamic";
// The queue is processed inside this function's lifetime (via after()).
export const maxDuration = 300;

/** Products per request; the Workspace splits larger selections. */
export const MAX_BULK = 12;

const schema = z.object({
  productIds: z.array(z.string().uuid()).min(1).max(MAX_BULK),
  look: simpleGenerationSchema.shape.look,
  aspectRatio: simpleGenerationSchema.shape.aspectRatio,
});

/** Queue one batch per product with the same look and size; they are processed a few at a time. */
export const POST = api(async (req) => {
  const profile = await requireProfile();
  rateLimit(`bulk:${profile.id}`, 6, 60_000);
  const body = schema.parse(await req.json());
  const ids = [...new Set(body.productIds)];

  const need = ids.length * generationCost(DEFAULT_TIER, DEFAULT_COUNT);
  if (profile.credits < need) throw new InsufficientCreditsError(need, profile.credits);

  const queued: string[] = [];
  const skipped: string[] = [];
  for (const id of ids) {
    const product = await getOwnedProduct(profile.id, id);
    if (!product) throw new HttpError(404, "Product not found", "not_found");
    try {
      const gen = await createGeneration(
        profile.id,
        toCreateInput({
          sourceAssetId: product.sourceAssetId,
          category: product.category as "clothing" | "jewellery",
          productType: product.productType,
          look: body.look,
          aspectRatio: body.aspectRatio,
        }),
        { look: body.look, skipActiveCheck: true },
      );
      queued.push(gen.id);
    } catch (err) {
      if (err instanceof InsufficientCreditsError) break;
      if (err instanceof GenerationError) {
        skipped.push(product.name);
        continue;
      }
      throw err;
    }
  }
  if (queued.length === 0 && skipped.length === 0) throw new InsufficientCreditsError(need, profile.credits);
  after(() => runQueue(queued));

  return NextResponse.json({ queued: queued.length, skipped, products: await listProducts(profile.id, ids) }, { status: 202 });
});
