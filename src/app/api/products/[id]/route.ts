import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { api, HttpError } from "@/lib/api";
import { requireProfile } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  sku: z.string().trim().max(40).nullish(),
});

export const PATCH = api(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const profile = await requireProfile();
  const { id } = await ctx.params;
  const body = patchSchema.parse(await req.json());
  const [row] = await db()
    .update(products)
    .set({ ...(body.name ? { name: body.name } : {}), ...(body.sku !== undefined ? { sku: body.sku || null } : {}) })
    .where(and(eq(products.id, id), eq(products.userId, profile.id)))
    .returning({ id: products.id });
  if (!row) throw new HttpError(404, "Product not found", "not_found");
  return NextResponse.json({ ok: true });
});

/** Removes the product from the catalogue. Generated images stay in the Library. */
export const DELETE = api(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const profile = await requireProfile();
  const { id } = await ctx.params;
  await db().delete(products).where(and(eq(products.id, id), eq(products.userId, profile.id)));
  return NextResponse.json({ ok: true });
});
