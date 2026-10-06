"use client";

import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { LogOut, MonitorSmartphone, ShieldCheck, ShieldOff } from "lucide-react";

import { revokeOtherSessions, revokeOwnSession } from "@/features/account/account-actions";
import type { OwnSessionRow } from "@/lib/auth/session";
import { useActionToast } from "@/components/shared/use-action-toast";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Panel } from "@/components/shared/panel";
import { StatusPill } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";

export function SessionsList({ sessions }: { sessions: OwnSessionRow[] }) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();
  const others = sessions.filter((row) => !row.isCurrent).length;

  async function revokeOne(row: OwnSessionRow) {
    if (row.isCurrent) {
      const answer = await confirm({
        title: "Sign out of this device?",
        description: "This is the session you are using right now. You will be returned to the sign-in page.",
        confirmLabel: "Sign out",
        destructive: true,
      });
      if (!answer.ok) return;
    }
    await run(() => revokeOwnSession(row.id), {
      onSuccess: ({ wasCurrent }) => {
        if (wasCurrent) router.push("/admin/login");
      },
    });
  }

  async function revokeOthers() {
    const answer = await confirm({
      title: `Sign out ${others} other device${others === 1 ? "" : "s"}?`,
      description: "Every other browser signed in as you will have to sign in again. This device stays signed in.",
      confirmLabel: "Sign out others",
      destructive: true,
    });
    if (!answer.ok) return;
    await run(() => revokeOtherSessions());
  }

  return (
    <Panel
      title="Signed-in devices"
      description="Every live session for your account. Revoking one takes effect on that device's next request."
      bodyClassName="p-0"
      action={
        others > 0 ? (
          <Button variant="outline" size="xs" onClick={revokeOthers} disabled={pending}>
            <LogOut className="size-3.5" />
            Sign out others
          </Button>
        ) : undefined
      }
    >
      {sessions.length === 0 ? (
        <EmptyState
          compact
          icon={MonitorSmartphone}
          title="No live sessions"
          description="This should not happen while you are signed in - reload the page."
        />
      ) : (
        <DataTable>
          <DataTableHead>
            <Th>Device</Th>
            <Th>IP</Th>
            <Th>Signed in</Th>
            <Th>Last active</Th>
            <Th>Expires</Th>
            <Th align="right">Action</Th>
          </DataTableHead>
          <DataTableBody>
            {sessions.map((row) => (
              <Tr key={row.id}>
                <Td>
                  <div className="flex items-center gap-2">
                    {row.mfaVerifiedAt ? (
                      <ShieldCheck className="text-success size-3.5 shrink-0" aria-label="Two-factor verified" />
                    ) : (
                      <ShieldOff className="text-muted-foreground size-3.5 shrink-0" aria-label="Not two-factor verified" />
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-medium">{row.deviceLabel ?? "Unknown device"}</p>
                      <p className="text-muted-foreground max-w-xs truncate text-[11px]" title={row.userAgent ?? ""}>
                        {row.userAgent ?? "No user agent"}
                      </p>
                    </div>
                    {row.isCurrent ? <StatusPill label="This device" tone="brand" dot={false} /> : null}
                  </div>
                </Td>
                <Td className="font-mono text-[11px]">{row.ip ?? "—"}</Td>
                <Td className="text-muted-foreground">
                  {formatDistanceToNow(row.createdAt, { addSuffix: true })}
                </Td>
                <Td className="text-muted-foreground">
                  {formatDistanceToNow(row.lastSeenAt, { addSuffix: true })}
                </Td>
                <Td className="text-muted-foreground">
                  {formatDistanceToNow(row.expiresAt, { addSuffix: true })}
                </Td>
                <Td align="right">
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-destructive"
                    onClick={() => revokeOne(row)}
                    disabled={pending}
                  >
                    {row.isCurrent ? "Sign out" : "Revoke"}
                  </Button>
                </Td>
              </Tr>
            ))}
          </DataTableBody>
        </DataTable>
      )}
      {confirmDialog}
    </Panel>
  );
}
