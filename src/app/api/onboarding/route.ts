import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/lib/api";
import { requireProfile } from "@/lib/auth/session";
import { PURPOSES, SELLS } from "@/lib/catalog/simple";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const schema = z.object({
  shopName: z.string().trim().min(1).max(60),
  sells: z.enum(SELLS),
  purpose: z.enum(PURPOSES),
});

export const POST = api(async (req) => {
  const profile = await requireProfile();
  const body = schema.parse(await req.json());
  await db()
    .update(profiles)
    .set({ shopName: body.shopName, sells: body.sells, defaultPurpose: body.purpose, onboardedAt: new Date(), updatedAt: new Date() })
    .where(eq(profiles.id, profile.id));
  return NextResponse.json({ ok: true });
});
