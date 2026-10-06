"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LogOut, MonitorSmartphone, ShieldAlert } from "lucide-react";

import { formatIstDateTime } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { useActionToast } from "@/components/shared/use-action-toast";

import {
  revokeAllUserSessionsAction,
  revokeUserSessionAction,
} from "@/features/users/actions";
import type { UserActivityRow, UserPermissions, UserSessionRow } from "@/features/users/schemas";

/**
 * Live sessions for one admin (§11.17).
 *
 * Revoking marks `AdminSession.revokedAt`; it takes effect on that device's
 * NEXT request, because every guard re-reads the session row rather than
 * trusting the JWT. The panel says so, so nobody expects an instant kick.
 */
export function UserSessionsCard({
  userId,
  sessions,
  permissions,
}: {
  userId: string;
  sessions: UserSessionRow[];
  permissions: UserPermissions;
}) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();

  async function revokeOne(session: UserSessionRow) {
    const result = await confirm({
      title: "Sign this device out?",
      description: `${session.deviceLabel ?? "Unknown device"} · last seen ${formatIstDateTime(new Date(session.lastSeenAt))}. It stops working on its next request.`,
      confirmLabel: "Sign out",
      destructive: true,
    });
    if (!result.ok) return;
    await run(() => revokeUserSessionAction(userId, session.id), {
      onSuccess: () => router.refresh(),
    });
  }

  async function revokeAll() {
    const result = await confirm({
      title: `Sign out all ${sessions.length} session(s)?`,
      description: "Every device this person is signed in on stops working on its next request.",
      confirmLabel: "Sign out all",
      destructive: true,
    });
    if (!result.ok) return;
    await run(() => revokeAllUserSessionsAction(userId), {
      onSuccess: () => router.refresh(),
    });
  }

  return (
    <section className="surface">
      <header className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <MonitorSmartphone className="text-muted-foreground size-4" />
          Sessions
          <span data-numeric className="text-muted-foreground text-xs font-normal">
            {sessions.length}
          </span>
        </h2>
        {permissions.canRevokeSessions && sessions.length > 0 ? (
          <Button variant="outline" size="xs" disabled={pending} onClick={revokeAll}>
            <LogOut className="size-3.5" />
            Sign out all
          </Button>
        ) : null}
      </header>

      {sessions.length === 0 ? (
        <EmptyState
          icon={MonitorSmartphone}
          title="No live sessions"
          description="Nobody is signed in on this account right now."
        />
      ) : (
        <ul className="divide-y">
          {sessions.map((session) => (
            <li key={session.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0 space-y-0.5">
                <p className="flex items-center gap-1.5 truncate text-xs font-medium">
                  {session.deviceLabel ?? "Unknown device"}
                  {session.isCurrent ? (
                    <Badge variant="secondary" className="h-4 px-1 text-[10px] font-normal">
                      this device
                    </Badge>
                  ) : null}
                  {session.mfaVerifiedAt === null ? (
                    <span
                      title="Two-factor challenge still pending on this session"
                      className="text-warning inline-flex items-center gap-1 text-[10px]"
                    >
                      <ShieldAlert className="size-3" />
                      pending 2FA
                    </span>
                  ) : null}
                </p>
                <p className="text-muted-foreground text-[11px]">
                  {session.ip ?? "unknown IP"} · last seen{" "}
                  {formatIstDateTime(new Date(session.lastSeenAt))} · expires{" "}
                  {formatIstDateTime(new Date(session.expiresAt))}
                </p>
              </div>
              {permissions.canRevokeSessions ? (
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={pending}
                  onClick={() => revokeOne(session)}
                >
                  Sign out
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {confirmDialog}
    </section>
  );
}

/**
 * What this person did and what was done to them. Both directions matter: a
 * role change made by somebody else belongs on the profile it happened to.
 */
export function UserActivityCard({ rows }: { rows: UserActivityRow[] }) {
  return (
    <section className="surface">
      <header className="border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold tracking-tight">Activity</h2>
      </header>
      {rows.length === 0 ? (
        <EmptyState title="No activity yet" description="Audit entries appear here as they happen." />
      ) : (
        <ul className="divide-y">
          {rows.map((row) => (
            <li key={row.id} className="px-4 py-2">
              <p className="text-xs">{row.summary}</p>
              <p className="text-muted-foreground text-[11px]">
                <code>{row.action}</code> · {row.actorEmail} ·{" "}
                {formatIstDateTime(new Date(row.createdAt))}
                {row.ip ? ` · ${row.ip}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
