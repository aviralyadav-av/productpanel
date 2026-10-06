import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_META,
  notificationSeveritySchema,
  notificationTypeSchema,
  type NotificationSeverity,
  type NotificationType,
} from "@/lib/enums";
import { SUPER_ADMIN_ROLE_SLUG, hasPermission } from "@/lib/permissions";
import {
  adminNotificationHtml,
  queueEmail,
  queueRawEmail,
  type QueueEmailResult,
} from "@/features/email/service";
import { readSettingStrings } from "@/features/finance/settings-reader";
import {
  COMPANION_NOTIFICATIONS,
  NOTIFICATION_EVENTS,
  type NotificationEventKey,
  type NotificationEventPayloads,
  type NotificationEventDefinition,
} from "./events";

/**
 * Admin notifications (blueprint §10, E3).
 *
 * Notifications are PER USER rows, fanned out at write time to every active
 * admin who holds the permission the type requires. Fan-out on write rather
 * than filter on read is deliberate: "unread count" becomes one indexed count
 * per user, marking read is a plain update, and a user who loses a permission
 * keeps the history they were entitled to when it happened.
 *
 * Preferences default to in-app ON and email OFF. Email is opt-in per type
 * because a busy store would otherwise send every operator dozens of mails a
 * day, and they would filter all of them - including the critical ones.
 */

type Db = Prisma.TransactionClient;

export type NotifyInput = {
  type: NotificationType;
  severity?: NotificationSeverity;
  title: string;
  body?: string | null;
  href?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  /** Overrides the type's default permission; null = every active admin. */
  permission?: string | null;
  tx?: Db;
};

export type NotifyResult = {
  recipients: number;
  inApp: number;
  emailed: number;
};

type Recipient = {
  id: string;
  email: string;
  name: string | null;
  isSuperAdmin: boolean;
  permissions: Set<string>;
};

async function loadCandidates(client: Db | typeof db): Promise<Recipient[]> {
  const users = await client.user.findMany({
    where: { isActive: true, deletedAt: null, roleId: { not: null } },
    select: {
      id: true,
      email: true,
      name: true,
      role: {
        select: {
          slug: true,
          permissions: { select: { permission: { select: { code: true } } } },
        },
      },
    },
  });

  return users.map((user) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    isSuperAdmin: user.role?.slug === SUPER_ADMIN_ROLE_SLUG,
    permissions: new Set(user.role?.permissions.map((row) => row.permission.code) ?? []),
  }));
}

function eligible(recipient: Recipient, permission: string | null): boolean {
  if (recipient.isSuperAdmin) return true;
  if (!permission) return true;
  return hasPermission(recipient.permissions, permission);
}

/**
 * Create one Notification per eligible admin and queue an email for those who
 * opted in. Safe inside a transaction (pass `tx`) - the rows commit with the
 * business change they announce.
 */
export async function notify(input: NotifyInput): Promise<NotifyResult> {
  const client = input.tx ?? db;
  const type = notificationTypeSchema.parse(input.type);
  const severity = notificationSeveritySchema.parse(input.severity ?? "info");
  const permission =
    input.permission === undefined
      ? NOTIFICATION_TYPE_META[type].permission
      : input.permission;

  const recipients = (await loadCandidates(client)).filter((user) =>
    eligible(user, permission),
  );
  if (recipients.length === 0) return { recipients: 0, inApp: 0, emailed: 0 };

  const preferences = await client.notificationPreference.findMany({
    where: { type, userId: { in: recipients.map((user) => user.id) } },
    select: { userId: true, inApp: true, email: true },
  });
  const preferenceByUser = new Map(preferences.map((row) => [row.userId, row]));

  const inAppUsers = recipients.filter(
    (user) => preferenceByUser.get(user.id)?.inApp ?? true,
  );
  const emailUsers = recipients.filter(
    (user) => preferenceByUser.get(user.id)?.email ?? false,
  );

  if (inAppUsers.length > 0) {
    await client.notification.createMany({
      data: inAppUsers.map((user) => ({
        userId: user.id,
        type,
        severity,
        title: input.title,
        body: input.body ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        href: input.href ?? null,
      })),
    });
  }

  let emailed = 0;
  if (emailUsers.length > 0) {
    emailed = await emailAdmins(input.tx, emailUsers, {
      type,
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
    });
  }

  return { recipients: recipients.length, inApp: inAppUsers.length, emailed };
}

/**
 * Admin emails use the `admin_notification` template when an operator has
 * created one (it is not seeded) and a plain built-in body otherwise, so the
 * feature works on day one and is brandable later.
 */
async function emailAdmins(
  tx: Db | undefined,
  users: Recipient[],
  notification: {
    type: NotificationType;
    title: string;
    body: string | null;
    href: string | null;
    entityType: string | null;
    entityId: string | null;
  },
): Promise<number> {
  const client = tx ?? db;
  const settings = await readSettingStrings(client, ["store.name"]);
  const storeName = settings["store.name"] || "DIY Baazar";
  const appOrigin = process.env.APP_ORIGIN ?? "";
  const absoluteHref = notification.href
    ? notification.href.startsWith("http")
      ? notification.href
      : `${appOrigin}${notification.href}`
    : null;

  const template = await client.emailTemplate.findUnique({
    where: { key: "admin_notification" },
    select: { isActive: true },
  });
  let sent = 0;
  for (const user of users) {
    const entityKey = notification.entityId
      ? `${notification.type}:${notification.entityType}:${notification.entityId}:${user.id}`
      : null;

    let result: QueueEmailResult;
    if (template?.isActive) {
      result = await queueEmail({
        templateKey: "admin_notification",
        to: { email: user.email, name: user.name },
        vars: {
          name: user.name ?? user.email,
          notification_type: NOTIFICATION_TYPE_META[notification.type].label,
          title: notification.title,
          body: notification.body ?? "",
          href: absoluteHref ?? "",
        },
        dedupeKey: entityKey,
        tx,
      });
    } else {
      result = await queueRawEmail({
        to: { email: user.email, name: user.name },
        subject: `[${storeName}] ${notification.title}`,
        html: adminNotificationHtml({
          storeName,
          title: notification.title,
          body: notification.body,
          href: absoluteHref,
        }),
        text: [notification.title, notification.body, absoluteHref].filter(Boolean).join("\n\n"),
        entity:
          notification.entityType && notification.entityId
            ? { type: notification.entityType, id: notification.entityId }
            : undefined,
        dedupeKey: entityKey,
        tx,
      });
    }
    if (result.queued) sent += 1;
  }
  return sent;
}

export type EmitResult = {
  notification: NotifyResult | null;
  companion: NotifyResult | null;
  email: QueueEmailResult | null;
};

/**
 * Fire a business event through the E3 matrix: admin notification(s) for the
 * permitted audience plus the customer/seller email the row names. Callers
 * pass typed payloads; nothing about titles, links or template variables lives
 * outside events.ts.
 */
export async function emitEvent<K extends NotificationEventKey>(
  key: K,
  payload: NotificationEventPayloads[K],
  tx?: Db,
): Promise<EmitResult> {
  const definition = NOTIFICATION_EVENTS[key] as NotificationEventDefinition<
    NotificationEventPayloads[K]
  >;
  const entity = definition.entity?.(payload);

  let notification: NotifyResult | null = null;
  if (definition.notificationType) {
    notification = await notify({
      type: definition.notificationType,
      severity: definition.severity,
      permission: definition.permission,
      title: definition.title(payload),
      body: definition.body?.(payload),
      href: definition.href?.(payload),
      entityType: entity?.type,
      entityId: entity?.id,
      tx,
    });
  }

  let companion: NotifyResult | null = null;
  const extra = COMPANION_NOTIFICATIONS[key];
  if (extra) {
    companion = await notify({
      type: extra.notificationType,
      severity: extra.severity,
      title: definition.title(payload),
      body: definition.body?.(payload),
      href: definition.href?.(payload),
      entityType: entity?.type,
      entityId: entity?.id,
      tx,
    });
  }

  let email: QueueEmailResult | null = null;
  if (definition.emailTemplateKey && definition.recipient) {
    const to = definition.recipient(payload);
    if (to?.email) {
      email = await queueEmail({
        templateKey: definition.emailTemplateKey,
        to,
        vars: definition.emailVars?.(payload) ?? {},
        entity,
        tx,
      });
    }
  }

  return { notification, companion, email };
}

// ---------------------------------------------------------------------------
// Per-user reads and writes
// ---------------------------------------------------------------------------

export async function unreadCount(userId: string, tx?: Db): Promise<number> {
  return (tx ?? db).notification.count({ where: { userId, readAt: null } });
}

/** Mark the given notifications (or every unread one) read. Returns how many changed. */
export async function markRead(
  userId: string,
  ids: readonly string[] | "all",
  tx?: Db,
): Promise<number> {
  const result = await (tx ?? db).notification.updateMany({
    where: {
      userId,
      readAt: null,
      ...(ids === "all" ? {} : { id: { in: [...ids] } }),
    },
    data: { readAt: new Date() },
  });
  return result.count;
}

export type NotificationPreferenceRow = {
  type: NotificationType;
  label: string;
  permission: string | null;
  inApp: boolean;
  email: boolean;
};

/** Every type with its effective setting (defaults filled in for missing rows). */
export async function getPreferences(
  userId: string,
  tx?: Db,
): Promise<NotificationPreferenceRow[]> {
  const rows = await (tx ?? db).notificationPreference.findMany({
    where: { userId },
    select: { type: true, inApp: true, email: true },
  });
  const byType = new Map(rows.map((row) => [row.type, row]));

  return NOTIFICATION_TYPES.map((type) => ({
    type,
    label: NOTIFICATION_TYPE_META[type].label,
    permission: NOTIFICATION_TYPE_META[type].permission,
    inApp: byType.get(type)?.inApp ?? true,
    email: byType.get(type)?.email ?? false,
  }));
}

export async function setPreferences(
  userId: string,
  prefs: ReadonlyArray<{ type: NotificationType; inApp: boolean; email: boolean }>,
  tx?: Db,
): Promise<void> {
  const client = tx ?? db;
  for (const pref of prefs) {
    const type = notificationTypeSchema.parse(pref.type);
    await client.notificationPreference.upsert({
      where: { userId_type: { userId, type } },
      create: { userId, type, inApp: pref.inApp, email: pref.email },
      update: { inApp: pref.inApp, email: pref.email },
    });
  }
}
