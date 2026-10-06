import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound, MonitorSmartphone, ShieldCheck } from "lucide-react";

import { requireAdmin } from "@/lib/auth/guards";
import { formatIstDateTime } from "@/lib/dates";
import { getAccountProfile, getRecentSignIns } from "@/features/account/queries";
import { ProfileForm } from "@/features/account/components/profile-form";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusPill } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "My account" };

export default async function AccountPage() {
  const actor = await requireAdmin();
  const [profile, signIns] = await Promise.all([
    getAccountProfile(actor.id),
    getRecentSignIns(actor.email),
  ]);

  if (!profile) {
    return (
      <div className="surface">
        <EmptyState
          title="Your account row could not be read"
          description="You are signed in, but the user record behind this session is missing. Sign out and back in."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="My account"
        description={`${profile.roleName ?? "No role"} · member since ${formatIstDateTime(profile.createdAt)}`}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/account/password">
                <KeyRound />
                Password
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/account/security">
                <ShieldCheck />
                Two-factor
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/account/sessions">
                <MonitorSmartphone />
                Devices
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-3 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ProfileForm profile={profile} />
        </div>

        <div className="space-y-3">
          <Panel title="Security at a glance" bodyClassName="space-y-2 p-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Two-factor</span>
              <StatusPill
                label={profile.twoFactorEnabled ? "On" : "Off"}
                tone={profile.twoFactorEnabled ? "success" : "warning"}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Last sign-in</span>
              <span>{profile.lastLoginAt ? formatIstDateTime(profile.lastLoginAt) : "—"}</span>
            </div>
          </Panel>

          <Panel
            title="Recent sign-in attempts"
            description="Successes and failures against your email"
            bodyClassName="p-0"
          >
            {signIns.length === 0 ? (
              <p className="text-muted-foreground px-4 py-6 text-center text-xs">No attempts recorded yet.</p>
            ) : (
              <ul className="divide-y">
                {signIns.map((attempt) => (
                  <li key={attempt.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                    <StatusPill
                      label={attempt.success ? "OK" : "Failed"}
                      tone={attempt.success ? "success" : "danger"}
                      dot={false}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{formatIstDateTime(attempt.createdAt)}</p>
                      <p className="text-muted-foreground truncate font-mono text-[11px]">
                        {attempt.ip ?? "unknown ip"}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
