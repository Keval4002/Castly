import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { CreditsProvider } from "@/components/CreditsProvider";
import { getCurrentProfile } from "@/lib/auth/session";

// Signed-in pages are per-user: never prerender them at build time.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  // First sign-in: a quick 3-tap setup before the workspace.
  if (!profile.onboardedAt) redirect("/onboarding");
  return (
    <CreditsProvider initial={profile.credits}>
      <AppHeader email={profile.email} />
      <main className="flex-1">{children}</main>
    </CreditsProvider>
  );
}
