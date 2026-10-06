import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";

import { getActor } from "@/lib/auth/guards";
import { getSettingString } from "@/lib/settings";
import { signOutAction } from "@/features/account/auth-actions";
import { AuthShell } from "@/components/layout/auth-shell";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "No access" };

/**
 * The friendly landing for an account that authenticates but has no admin
 * role. Distinct from app/admin/unauthorized.tsx (the 401 interrupt) so the
 * operator gets a sentence about THEIR account, not a generic status page.
 */
export default async function UnauthorizedPage() {
  const [actor, storeName] = await Promise.all([getActor(), getSettingString("store.name")]);

  return (
    <AuthShell
      storeName={storeName || "DIY Baazar"}
      icon={ShieldAlert}
      title="This account cannot open the admin panel"
      description={
        actor ? (
          <>
            You are signed in as <span className="text-foreground font-medium">{actor.email}</span>, but no
            admin role has been assigned to it. Roles are granted per account by an existing
            administrator - it is not something you can request from this screen.
          </>
        ) : (
          <>Your session has ended. Sign in again to continue.</>
        )
      }
    >
      <form action={signOutAction}>
        <Button type="submit" variant="outline" size="sm" className="w-full">
          Sign in with a different account
        </Button>
      </form>
    </AuthShell>
  );
}
