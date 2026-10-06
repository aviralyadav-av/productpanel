import type { Metadata } from "next";

import { requireAdmin } from "@/lib/auth/guards";
import { getSettingBoolean } from "@/lib/settings";
import { twoFactorStatus } from "@/features/account/two-factor";
import { TwoFactorPanel } from "@/features/account/components/two-factor-panel";
import { PageHeader } from "@/components/shared/page-header";

export const metadata: Metadata = { title: "Two-factor security" };

export default async function SecurityPage() {
  const actor = await requireAdmin();
  const [status, requireForSuperAdmin] = await Promise.all([
    twoFactorStatus(actor.id),
    getSettingBoolean("security.require_2fa_for_super_admin"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Two-factor security"
        description="A second factor means a stolen password alone cannot open the admin. Codes come from an authenticator app; recovery codes cover a lost phone."
      />
      <div className="max-w-2xl">
        <TwoFactorPanel status={status} required={actor.isSuperAdmin && requireForSuperAdmin} />
      </div>
    </div>
  );
}
