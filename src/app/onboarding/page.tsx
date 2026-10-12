import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { getCurrentProfile } from "@/lib/auth/session";
import { SIGNUP_BONUS_CREDITS } from "@/lib/pricing";
import { OnboardingForm } from "./OnboardingForm";

export const metadata: Metadata = { title: "Set up your shop" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.onboardedAt) redirect("/workspace");
  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex justify-center">
          <Logo full />
        </div>
        <OnboardingForm bonus={SIGNUP_BONUS_CREDITS} />
      </div>
    </div>
  );
}
