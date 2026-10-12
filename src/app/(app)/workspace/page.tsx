import type { Metadata } from "next";
import { sql, eq, and } from "drizzle-orm";
import { requireProfile } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { generationImages, generations } from "@/lib/db/schema";
import { PURPOSE_DEFAULTS, type Purpose } from "@/lib/catalog/simple";
import { listProducts } from "@/lib/products";
import { WorkspaceClient } from "./WorkspaceClient";

export const metadata: Metadata = { title: "Workspace" };

export default async function WorkspacePage() {
  const profile = await requireProfile();
  const [initial, [{ images }]] = await Promise.all([
    listProducts(profile.id),
    db()
      .select({ images: sql<number>`count(*)::int` })
      .from(generationImages)
      .innerJoin(generations, eq(generations.id, generationImages.generationId))
      .where(and(eq(generations.userId, profile.id), eq(generationImages.status, "succeeded"))),
  ]);
  const defaults = PURPOSE_DEFAULTS[(profile.defaultPurpose as Purpose) ?? "marketplace"] ?? PURPOSE_DEFAULTS.marketplace;
  return (
    <WorkspaceClient
      shopName={profile.shopName ?? "Your shop"}
      initial={initial}
      totalImages={images}
      defaultLook={defaults.look}
      defaultSize={defaults.size}
    />
  );
}
