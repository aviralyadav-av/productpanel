import type { Metadata } from "next";

import { requireAdmin } from "@/lib/auth/guards";
import { safeCallbackPath } from "@/features/account/redirects";
import { PasswordForm } from "@/features/account/components/password-form";
import { PageHeader } from "@/components/shared/page-header";

export const metadata: Metadata = { title: "Change password" };

/**
 * Also the landing for a forced password change (D10): requireAdmin() lets a
 * flagged account reach this page and nothing else until it succeeds.
 */
export default async function PasswordPage({ searchParams }: PageProps<"/admin/account/password">) {
  const actor = await requireAdmin();
  const params = await searchParams;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Change password"
        description="Your password is the first factor for every sign-in. Changing it signs out every other device."
      />
      <div className="max-w-2xl">
        <PasswordForm
          forced={actor.forcePasswordChange}
          redirectTo={actor.forcePasswordChange ? safeCallbackPath(params.callbackUrl) : undefined}
        />
      </div>
    </div>
  );
}
