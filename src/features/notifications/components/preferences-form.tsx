"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BellRing, Mail, Send } from "lucide-react";

import { NOTIFICATION_TYPE_META } from "@/lib/enums";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { FormActions } from "@/components/shared/form-actions";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { useActionToast } from "@/components/shared/use-action-toast";

import {
  saveNotificationPreferencesAction,
  sendTestNotificationAction,
} from "@/features/notifications/actions";
import type { PreferenceRow } from "@/features/notifications/schemas";

/**
 * The Preferences tab: one row per notification type, two switches per row.
 *
 * The matrix is edited locally and saved in one submit rather than saving on
 * every toggle. Fourteen types times two channels is a lot of round trips,
 * and an operator turning off five noisy types wants one "saved" toast, not
 * ten. The action only writes the rows that actually changed, so the audit
 * diff is the decision, not the whole grid.
 *
 * Each row also states WHICH permission gates the type. That is the part
 * operators get wrong: turning "in-app" on for PAYOUT_DUE does nothing if you
 * do not hold payouts.approve, because the fan-out never picks you as a
 * recipient (service.ts, E3). Saying so here saves a support ticket.
 */
export function PreferencesForm({
  rows,
  actorPermissions,
}: {
  rows: PreferenceRow[];
  actorPermissions: string[];
}) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [state, setState] = React.useState(rows);

  const held = React.useMemo(() => new Set(actorPermissions), [actorPermissions]);
  const dirty = React.useMemo(
    () =>
      state.some((row, index) => row.inApp !== rows[index]?.inApp || row.email !== rows[index]?.email),
    [state, rows],
  );

  function toggle(type: PreferenceRow["type"], channel: "inApp" | "email", value: boolean) {
    setState((current) =>
      current.map((row) => (row.type === type ? { ...row, [channel]: value } : row)),
    );
  }

  async function save() {
    await run(
      () =>
        saveNotificationPreferencesAction({
          preferences: state.map((row) => ({ type: row.type, inApp: row.inApp, email: row.email })),
        }),
      { onSuccess: () => router.refresh() },
    );
  }

  /** Does the actor actually qualify to receive this type at all? */
  function receives(row: PreferenceRow): boolean {
    return row.permission === null || held.has(row.permission);
  }

  const table = (
    <DataTable>
      <DataTableHead>
        <Th>Notification</Th>
        <Th>Who receives it</Th>
        <Th align="center" width="6rem">
          <span className="inline-flex items-center gap-1">
            <BellRing className="size-3.5" /> In-app
          </span>
        </Th>
        <Th align="center" width="6rem">
          <span className="inline-flex items-center gap-1">
            <Mail className="size-3.5" /> Email
          </span>
        </Th>
      </DataTableHead>
      <DataTableBody>
        {state.map((row) => (
          <Tr key={row.type}>
            <Td>
              <span className="text-sm font-medium">{row.label}</span>
            </Td>
            <Td>
              <PermissionNote row={row} qualifies={receives(row)} />
            </Td>
            <Td align="center">
              <Switch
                checked={row.inApp}
                disabled={pending}
                aria-label={`In-app notifications for ${row.label}`}
                onCheckedChange={(value) => toggle(row.type, "inApp", value)}
              />
            </Td>
            <Td align="center">
              <Switch
                checked={row.email}
                disabled={pending}
                aria-label={`Email notifications for ${row.label}`}
                onCheckedChange={(value) => toggle(row.type, "email", value)}
              />
            </Td>
          </Tr>
        ))}
      </DataTableBody>
    </DataTable>
  );

  const cards = state.map((row) => (
    <MobileCard key={row.type} title={row.label} subtitle={NOTIFICATION_TYPE_META[row.type]?.permission ?? "Everyone"}>
      <MobileCardField label="In-app">
        <Switch
          checked={row.inApp}
          disabled={pending}
          aria-label={`In-app notifications for ${row.label}`}
          onCheckedChange={(value) => toggle(row.type, "inApp", value)}
        />
      </MobileCardField>
      <MobileCardField label="Email">
        <Switch
          checked={row.email}
          disabled={pending}
          aria-label={`Email notifications for ${row.label}`}
          onCheckedChange={(value) => toggle(row.type, "email", value)}
        />
      </MobileCardField>
    </MobileCard>
  ));

  return (
    <div className="space-y-4">
      <ResponsiveTable table={table} cards={cards} />
      <FormActions
        dirty={dirty}
        pending={pending}
        onSubmit={() => void save()}
        submitLabel="Save preferences"
        onCancel={dirty ? () => setState(rows) : undefined}
        cancelLabel="Discard"
        status={dirty ? "Unsaved changes" : "In-app is on by default; email is opt-in per type."}
      />
    </div>
  );
}

function PermissionNote({ row, qualifies }: { row: PreferenceRow; qualifies: boolean }) {
  if (row.permission === null) {
    return <span className="text-muted-foreground text-xs">Every active admin</span>;
  }
  return (
    <span className="text-xs">
      <code className="bg-muted rounded px-1 py-0.5 text-[11px]">{row.permission}</code>
      {qualifies ? null : (
        <span className="text-warning ml-1.5">— your role does not hold it, so you never receive this type</span>
      )}
    </span>
  );
}

/**
 * "Send me a test notification": writes one row for the actor and, when they
 * have SYSTEM email on, queues the same body to their address. It is the only
 * way to prove the bell, the preferences and SMTP all work without waiting
 * for a real order.
 */
export function TestNotificationButton() {
  const router = useRouter();
  const { pending, run } = useActionToast();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => void run(() => sendTestNotificationAction(), { onSuccess: () => router.refresh() })}
    >
      <Send /> Send me a test notification
    </Button>
  );
}
