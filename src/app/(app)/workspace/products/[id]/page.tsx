import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth/session";
import { listGenerations } from "@/lib/generation/service";
import { getOwnedProduct, listProducts } from "@/lib/products";
import { ProductDetail } from "./ProductDetail";

export const metadata: Metadata = { title: "Product" };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(await getOwnedProduct(profile.id, id))) notFound();
  const [[product], gens] = await Promise.all([listProducts(profile.id, [id]), listGenerations(profile.id, 24, undefined, id)]);
  return <ProductDetail product={product} initial={gens} />;
}
