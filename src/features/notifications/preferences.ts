import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { NOTIFICATION_TYPE_META, type NotificationType } from "@/lib/enums";
import { diffOf, writeAudit, type AuditActor } from "@/lib/audit";
import { adminNotificationHtml, queueRawEmail } from "@/features/email/service";

import { getPreferences, setPreferences, type NotificationPreferenceRow } from "./service";

/**
 * The write side of the notification centre that is NOT in the frozen
 * `service.ts`: saving one operator's delivery matrix, and the "send me a
 * test notification" probe. Both are shared by the Server Action and the REST
 * route so the two can never drift (house rule: one service, two thin callers).
 *
 * No `next/*` or `server-only` imports - a check script and the worker can
 * call these directly.
 *
 * Read state changes are deliberately NOT audited (they are personal UI state
 * and D13 does not list them). Preference changes ARE: turning off the
 * low-stock email is a decision someone may later have to explain.
 */

export type PreferenceInput = { type: NotificationType; inApp: boolean; email: boolean };

/**
 * Only the rows that actually differ, so the audit diff is the change the
 * operator made rather than the whole 14-row matrix.
 */
export function changedPreferences(
  before: readonly NotificationPreferenceRow[],
  next: readonly PreferenceInput[],
): PreferenceInput[] {
  const byType = new Map(before.map((row) => [row.type, row]));
  return next.filter((row) => {
    const current = byType.get(row.type);
    return !current || current.inApp !== row.inApp || current.email !== row.email;
  });
}

export type SavePreferencesResult = { saved: number; changed: NotificationType[] };

export async function savePreferences(
  actor: AuditActor,
  next: readonly PreferenceInput[],
  meta: { ip?: string; userAgent?: string | null } = {},
): Promise<SavePreferencesResult> {
  const before = await getPreferences(actor.id);
  const byType = new Map(before.map((row) => [row.type, row]));
  const changed = changedPreferences(before, next);
  if (changed.length === 0) return { saved: 0, changed: [] };

  await db.$transaction(async (tx) => {
    await setPreferences(actor.id, changed, tx);
    await writeAudit(tx, {
      actor,
      action: "notification.preferences_update",
      entityType: "NotificationPreference",
      entityId: actor.id,
      entityLabel: actor.email,
      summary: `Updated notification delivery for ${changed.length} type${changed.length === 1 ? "" : "s"}.`,
      diff: diffOf(
        Object.fromEntries(
          changed.map((row) => {
            const current = byType.get(row.type);
            return [row.type, { inApp: current?.inApp ?? true, email: current?.email ?? false }];
          }),
        ),
        Object.fromEntries(changed.map((row) => [row.type, { inApp: row.inApp, email: row.email }])),
      ),
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  });

  return { saved: changed.length, changed: changed.map((row) => row.type) };
}

export type TestNotificationResult = { id: string; emailQueued: boolean; email: string };

/**
 * Writes ONE row for the actor (never a fan-out) and, when they have SYSTEM
 * email delivery on, queues the same body to their address - the only way to
 * prove the bell, the preference and SMTP all work without waiting for a real
 * order.
 */
export async function sendTestNotification(
  actor: AuditActor & { name?: string | null },
  tx?: Prisma.TransactionClient,
): Promise<TestNotificationResult> {
  const client = tx ?? db;

  const preference = await client.notificationPreference.findUnique({
    where: { userId_type: { userId: actor.id, type: "SYSTEM" } },
    select: { email: true },
  });

  const title = "Test notification";
  const body = `Sent by ${actor.name ?? actor.email} to check that the notification centre is working. It is safe to mark this read.`;

  const row = await client.notification.create({
    data: {
      userId: actor.id,
      type: "SYSTEM",
      severity: "info",
      title,
      body,
      href: "/admin/notifications",
      entityType: "User",
      entityId: actor.id,
    },
    select: { id: true },
  });

  let emailQueued = false;
  if (preference?.email) {
    const result = await queueRawEmail({
      to: { email: actor.email, name: actor.name },
      subject: `[Test] ${title}`,
      html: adminNotificationHtml({ storeName: "Admin", title, body, href: null }),
      text: `${title}\n\n${body}`,
      // No dedupe key: every press of the button must produce a new email.
      dedupeKey: null,
      tx,
    });
    emailQueued = result.queued;
  }

  return { id: row.id, emailQueued, email: actor.email };
}

/** Label for the "you will not receive this" hint on the preferences tab. */
export function permissionFor(type: NotificationType): string | null {
  return NOTIFICATION_TYPE_META[type].permission;
}
