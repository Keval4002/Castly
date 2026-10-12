import type { Metadata } from "next";
import { getOwnedAsset, uploadDTO } from "@/lib/assets";
import { requireProfile } from "@/lib/auth/session";
import { PURPOSE_DEFAULTS, type Purpose } from "@/lib/catalog/simple";
import { listGenerations } from "@/lib/generation/service";
import { getOwnedProduct } from "@/lib/products";
import { StudioClient } from "./StudioClient";

export const metadata: Metadata = { title: "Studio" };

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const profile = await requireProfile();
  const sp = await searchParams;
  const product = sp.product && /^[0-9a-f-]{36}$/i.test(sp.product) ? await getOwnedProduct(profile.id, sp.product) : null;
  const sourceAsset = product ? await getOwnedAsset(profile.id, product.sourceAssetId) : null;
  const [asset, recent] = await Promise.all([
    sourceAsset ? uploadDTO(sourceAsset) : null,
    listGenerations(profile.id, 6, undefined, product?.id),
  ]);
  const defaults = PURPOSE_DEFAULTS[(profile.defaultPurpose as Purpose) ?? "marketplace"] ?? PURPOSE_DEFAULTS.marketplace;
  const category = product?.category ?? (profile.sells === "jewellery" ? "jewellery" : "clothing");
  return (
    <StudioClient
      key={product?.id ?? "new"}
      initialAsset={asset}
      initialCategory={category as "clothing" | "jewellery"}
      initialProductType={product?.productType ?? null}
      defaultLook={defaults.look}
      defaultSize={defaults.size}
      initial={recent}
    />
  );
}
