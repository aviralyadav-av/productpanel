import { z } from "zod";

import {
  NOTIFICATION_SEVERITIES,
  NOTIFICATION_TYPES,
  notificationSeveritySchema,
  notificationTypeSchema,
  type NotificationSeverity,
  type NotificationType,
} from "@/lib/enums";
import { formatIstDate, istDayKey } from "@/lib/dates";
import { one, type SearchParams } from "@/lib/list-params";

/**
 * Client-safe vocabulary for /admin/notifications: what the URL may say, what
 * the two server actions accept, and the pure grouping the list renders with.
 *
 * The grouping lives here rather than in the component because it is the one
 * piece of display logic worth testing: "unread first, then by day" has to
 * agree with the ORDER BY in queries.ts or the sections come out interleaved.
 */

export const NOTIFICATION_TABS = ["inbox", "preferences"] as const;
export type NotificationTab = (typeof NOTIFICATION_TABS)[number];
export const NOTIFICATION_TAB_LABELS: Record<NotificationTab, string> = {
  inbox: "Inbox",
  preferences: "Preferences",
};

export function resolveNotificationTab(raw: string | undefined): NotificationTab {
  return (NOTIFICATION_TABS as readonly string[]).includes(raw ?? "")
    ? (raw as NotificationTab)
    : "inbox";
}

/** `from`/`to` are IST calendar days (the DateRangePicker writes yyyy-mm-dd). */
export function parseIstDayParam(value: string | undefined, end: boolean): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}+05:30`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export type NotificationFilters = {
  q: string;
  type?: NotificationType;
  severity?: NotificationSeverity;
  /** Only rows the actor has not read yet. */
  unreadOnly: boolean;
  from?: Date;
  to?: Date;
};

export function parseNotificationFilters(params: SearchParams): NotificationFilters {
  const type = one(params, "type");
  const severity = one(params, "severity");
  return {
    q: (one(params, "q") ?? "").trim(),
    type: (NOTIFICATION_TYPES as readonly string[]).includes(type ?? "")
      ? (type as NotificationType)
      : undefined,
    severity: (NOTIFICATION_SEVERITIES as readonly string[]).includes(severity ?? "")
      ? (severity as NotificationSeverity)
      : undefined,
    unreadOnly: one(params, "unread") === "1",
    from: parseIstDayParam(one(params, "from"), false),
    to: parseIstDayParam(one(params, "to"), true),
  };
}

export function hasNotificationFilters(filters: NotificationFilters): boolean {
  return Boolean(
    filters.q || filters.type || filters.severity || filters.unreadOnly || filters.from || filters.to,
  );
}

// ---------------------------------------------------------------------------
// Client-safe read models (dates as ISO strings, per the module convention)
// ---------------------------------------------------------------------------

export type NotificationRow = {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  href: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
};

export type NotificationGroup = {
  /** "unread" or an IST day key (yyyy-mm-dd); stable enough for a React key. */
  key: string;
  label: string;
  rows: NotificationRow[];
};

/**
 * Sections the list renders, in the order queries.ts returns rows: every
 * unread row in one "Unread" block, then the read ones by IST day. Grouping
 * consecutive rows (rather than sorting again here) is what keeps the two in
 * step - change the ORDER BY and this function still produces contiguous
 * sections.
 */
export function groupNotifications(
  rows: readonly NotificationRow[],
  now = new Date(),
): NotificationGroup[] {
  const groups: NotificationGroup[] = [];
  const today = istDayKey(now);
  const yesterday = istDayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));

  for (const row of rows) {
    const key = row.readAt ? istDayKey(new Date(row.createdAt)) : "unread";
    const last = groups.at(-1);
    if (last && last.key === key) {
      last.rows.push(row);
      continue;
    }
    groups.push({ key, label: dayLabel(key, today, yesterday), rows: [row] });
  }
  return groups;
}

function dayLabel(key: string, today: string, yesterday: string): string {
  if (key === "unread") return "Unread";
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  return formatIstDate(new Date(`${key}T00:00:00.000+05:30`));
}

// ---------------------------------------------------------------------------
// Action inputs
// ---------------------------------------------------------------------------

export const MARK_READ_MAX_IDS = 500;

export const markReadSchema = z
  .object({
    ids: z.array(z.string().min(1)).max(MARK_READ_MAX_IDS).optional(),
    all: z.boolean().optional(),
  })
  .refine((value) => value.all === true || (value.ids?.length ?? 0) > 0, {
    message: "Pass ids, or all: true.",
    path: ["ids"],
  });
export type MarkReadInput = z.input<typeof markReadSchema>;
export type MarkReadValues = z.output<typeof markReadSchema>;

export const preferenceRowSchema = z.object({
  type: notificationTypeSchema,
  inApp: z.boolean(),
  email: z.boolean(),
});

export const preferencesSchema = z.object({
  preferences: z.array(preferenceRowSchema).min(1).max(NOTIFICATION_TYPES.length),
});
export type PreferencesInput = z.input<typeof preferencesSchema>;
export type PreferencesValues = z.output<typeof preferencesSchema>;

/** The shape the preferences tab renders (service.getPreferences returns it). */
export type PreferenceRow = {
  type: NotificationType;
  label: string;
  permission: string | null;
  inApp: boolean;
  email: boolean;
};

export const testNotificationSeveritySchema = notificationSeveritySchema;
