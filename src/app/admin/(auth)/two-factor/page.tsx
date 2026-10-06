import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import { getActor, LOGIN_PATH } from "@/lib/auth/guards";
import { getSettingString } from "@/lib/settings";
import { safeCallbackPath } from "@/features/account/redirects";
import { AuthShell } from "@/components/layout/auth-shell";
import { TwoFactorChallengeForm } from "@/features/account/components/two-factor-challenge-form";

export const metadata: Metadata = { title: "Two-factor verification" };

/**
 * The step between a correct password and the shell (D2). Only a session
 * that is signed in AND still pending may see it: signed-out visitors go to
 * login, verified sessions go straight to where they were heading.
 */
export default async function TwoFactorPage({ searchParams }: PageProps<"/admin/two-factor">) {
  const params = await searchParams;
  const callbackUrl = safeCallbackPath(params.callbackUrl);

  const actor = await getActor();
  if (!actor) redirect(`${LOGIN_PATH}?reason=session_ended`);
  if (!actor.pendingMfa) redirect(callbackUrl);

  const storeName = (await getSettingString("store.name")) || "DIY Baazar";

  return (
    <AuthShell
      storeName={storeName}
      icon={ShieldCheck}
      title="Two-factor verification"
      description={
        <>
          Signed in as <span className="text-foreground font-medium">{actor.email}</span>. Enter the
          6-digit code from your authenticator app to continue.
        </>
      }
    >
      <TwoFactorChallengeForm callbackUrl={callbackUrl} />
    </AuthShell>
  );
}
