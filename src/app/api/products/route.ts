import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { requireProfile } from "@/lib/auth/session";
import { listProducts } from "@/lib/products";

export const dynamic = "force-dynamic";

export const GET = api(async () => {
  const profile = await requireProfile();
  return NextResponse.json({ products: await listProducts(profile.id) });
});
