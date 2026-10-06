"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Check, CheckCheck, Info, OctagonAlert, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "cn";

import { formatIstDateTime } from "@/lib/dates";
import { NOTIFICATION_SEVERITY_META, NOTIFICATION_TYPE_META, type NotificationSeverity } from "@/lib/enums";
import type { PageMeta } from "@/lib/list-params";
import { Button } from "@/components/ui/button";
import { BulkActionBar, type BulkAction } from "@/components/shared/bulk-action-bar";
import { PaginationBar } from "@/components/shared/list-controls";
import { RowCheckbox, useRowSelection } from "@/components/shared/row-selection";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";

import { markNotificationsReadAction } from "@/features/notifications/actions";
import { groupNotifications, type NotificationRow } from "@/features/notifications/schemas";

/**
 * The inbox itself: unread block first, then one block per IST day (the
 * grouping is the pure function in schemas.ts, so it can never drift from the
 * ORDER BY that produced the rows).
 *
 * This is a list, not a table: a notification is a sentence with a link, and
 * forcing it into columns would truncate the one part that matters. Selection
 * still works the same way as the tables, so "mark these six read" behaves
 * like every other bulk action in the admin.
 */

const SEVERITY_ICONS: Record<NotificationSeverity, LucideIcon> = {
  info: Info,
  warning: TriangleAlert,
  critical: OctagonAlert,
};

const SEVERITY_CLASSES: Record<NotificationSeverity, string> = {
  info: "text-info",
  warning: "text-warning",
  critical: "text-destructive",
};

export function SeverityIcon({ severity, className }: { severity: NotificationSeverity; className?: string }) {
  const Icon = SEVERITY_ICONS[severity] ?? Info;
  return (
    <Icon
      aria-label={NOTIFICATION_SEVERITY_META[severity]?.label ?? severity}
      className={cn("size-4 shrink-0", SEVERITY_CLASSES[severity] ?? "text-info", className)}
    />
  );
}

export function NotificationList({
  rows,
  meta,
}: {
  rows: NotificationRow[];
  meta: PageMeta;
}) {
  const router = useRouter();
  const { run, pending } = useActionToast();
  const selection = useRowSelection(rows.map((row) => row.id));
  const groups = React.useMemo(() => groupNotifications(rows), [rows]);

  async function markRead(ids: string[]) {
    if (ids.length === 0) return;
    await run(() => markNotificationsReadAction({ ids }), {
      onSuccess: () => {
        selection.clear();
        router.refresh();
      },
    });
  }

  const bulkActions: BulkAction[] = [
    { label: "Mark read", icon: CheckCheck, onSelect: () => markRead([...selection.selectedIds]) },
  ];

  return (
    <>
      <div className="divide-y">
        {groups.map((group) => (
          <section key={group.key} aria-label={group.label}>
            <h2 className="bg-muted/40 text-muted-foreground sticky top-0 z-1 px-4 py-1.5 text-[11px] font-semibold tracking-wide uppercase">
              {group.label}
              <span data-numeric className="ml-1.5 font-normal">
                {group.rows.length}
              </span>
            </h2>
            <ul className="divide-y">
              {group.rows.map((row) => (
                <li
                  key={row.id}
                  className={cn(
                    "flex items-start gap-3 px-4 py-3",
                    selection.isSelected(row.id) && "bg-muted/50",
                    !row.readAt && "bg-brand-muted/25",
                  )}
                >
                  <span className="pt-0.5">
                    <RowCheckbox {...selection.rowProps(row.id)} label={`Select "${row.title}"`} />
                  </span>
                  <SeverityIcon severity={row.severity} className="mt-0.5" />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={cn("text-sm", row.readAt ? "font-medium" : "font-semibold")}>{row.title}</span>
                      <StatusPill
                        label={NOTIFICATION_TYPE_META[row.type]?.label ?? row.type}
                        tone={NOTIFICATION_TYPE_META[row.type]?.tone ?? "neutral"}
                      />
                      {row.readAt ? null : <span className="bg-brand size-1.5 rounded-full" aria-label="Unread" />}
                    </div>
                    {row.body ? (
                      <p className="text-muted-foreground mt-0.5 text-xs break-words">{row.body}</p>
                    ) : null}
                    <div className="text-muted-foreground/80 mt-1 flex flex-wrap items-center gap-3 text-[11px]">
                      <time dateTime={row.createdAt}>{formatIstDateTime(new Date(row.createdAt))}</time>
                      {row.href ? (
                        <Link
                          href={row.href as Route}
                          className="text-brand inline-flex items-center gap-0.5 font-medium hover:underline"
                        >
                          Open {row.entityType ? row.entityType.toLowerCase() : "item"}
                          <ArrowUpRight className="size-3" />
                        </Link>
                      ) : null}
                    </div>
                  </div>

                  {row.readAt ? (
                    <span className="text-muted-foreground/70 shrink-0 pt-0.5 text-[11px]">Read</span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={pending}
                      onClick={() => void markRead([row.id])}
                      aria-label={`Mark "${row.title}" read`}
                    >
                      <Check /> Mark read
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <PaginationBar meta={meta} itemLabel="notifications" />
      <BulkActionBar
        count={selection.count}
        actions={bulkActions}
        onClear={selection.clear}
        itemLabel="notifications selected"
      />
    </>
  );
}

/** Header action: clears the whole unread queue, not just this page. */
export function MarkAllReadButton({ unread }: { unread: number }) {
  const router = useRouter();
  const { run, pending } = useActionToast();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending || unread === 0}
      onClick={() =>
        void run(() => markNotificationsReadAction({ all: true }), { onSuccess: () => router.refresh() })
      }
    >
      <CheckCheck /> Mark all read{unread > 0 ? ` (${unread})` : ""}
    </Button>
  );
}
