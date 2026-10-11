import type { Metadata } from "next";
import { requireProfile } from "@/lib/auth/session";
import { listGenerations } from "@/lib/generation/service";
import { LibraryClient } from "./LibraryClient";

export const metadata: Metadata = { title: "Library" };

export default async function LibraryPage() {
  const profile = await requireProfile();
  const items = await listGenerations(profile.id, 24);
  return <LibraryClient initial={items} />;
}
