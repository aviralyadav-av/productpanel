"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { Bell, CheckCheck, Info, OctagonAlert, TriangleAlert } from "lucide-react";
import { cn } from "cn";

import { markNotificationsRead } from "@/features/shell/actions";
import { useActionToast } from "@/components/shared/use-action-toast";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";

/**
 * The actor's own notifications: the latest twelve, the unread count, and a
 * mark-all-read. Clicking a row marks just that row read and follows its link
 * (an optimistic dot removal, then the server action). The full centre with
 * filters and preferences is /admin/notifications.
 */

export type NotificationRow = {
  id: string;
  type: string;
  severity: string;
  title: string;
  body: string | null;
  href: string | null;
  createdAt: Date;
  readAt: Date | null;
};

const SEVERITY_ICON = {
  critical: OctagonAlert,
  warning: TriangleAlert,
  info: Info,
} as const;

const SEVERITY_CLASS = {
  critical: "text-destructive",
  warning: "text-warning",
  info: "text-info",
} as const;

export function NotificationBell({
  notifications,
  unreadCount,
}: {
  notifications: NotificationRow[];
  unreadCount: number;
}) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [readIds, setReadIds] = React.useState<Set<string>>(() => new Set());

  const localUnread = Math.max(
    0,
    unreadCount - notifications.filter((row) => !row.readAt && readIds.has(row.id)).length,
  );

  async function markAll() {
    await run(() => markNotificationsRead("all"), {
      successMessage: "All notifications marked read.",
    });
    setReadIds(new Set(notifications.map((row) => row.id)));
  }

  function open(row: NotificationRow) {
    if (!row.readAt && !readIds.has(row.id)) {
      setReadIds((current) => new Set(current).add(row.id));
      void run(() => markNotificationsRead([row.id]), { silent: true });
    }
    if (row.href) router.push(row.href as never);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative"
          aria-label={
            localUnread > 0 ? `Notifications, ${localUnread} unread` : "Notifications"
          }
        >
          <Bell className="size-4" />
          {localUnread > 0 ? (
            <span className="bg-destructive text-destructive-foreground absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-[9px] leading-none font-semibold">
              {localUnread > 9 ? "9+" : localUnread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <p className="text-sm font-medium">Notifications</p>
          <div className="flex items-center gap-1">
            {localUnread > 0 ? (
              <Button
                variant="ghost"
                size="xs"
                onClick={markAll}
                disabled={pending}
                aria-label="Mark all notifications read"
              >
                <CheckCheck className="size-3.5" />
                Mark all read
              </Button>
            ) : null}
          </div>
        </div>

        {notifications.length === 0 ? (
          <EmptyState
            compact
            icon={Bell}
            title="Nothing needs you right now"
            description="New orders, low stock, seller approvals and reviews awaiting moderation will appear here."
          />
        ) : (
          <ScrollArea className="max-h-80">
            <ul className="divide-y">
              {notifications.map((row) => {
                const Icon =
                  SEVERITY_ICON[row.severity as keyof typeof SEVERITY_ICON] ?? Info;
                const tone =
                  SEVERITY_CLASS[row.severity as keyof typeof SEVERITY_CLASS] ?? "text-info";
                const isUnread = !row.readAt && !readIds.has(row.id);

                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => open(row)}
                      className={cn(
                        "hover:bg-accent/60 flex w-full gap-2.5 px-3 py-2.5 text-left outline-none focus-visible:bg-accent/60",
                        !row.href && "cursor-default",
                      )}
                    >
                      <Icon className={cn("mt-0.5 size-3.5 shrink-0", tone)} />
                      <div className="min-w-0 flex-1">
                        <p className={cn("text-xs leading-snug", isUnread && "font-medium")}>
                          {row.title}
                        </p>
                        {row.body ? (
                          <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs leading-snug">
                            {row.body}
                          </p>
                        ) : null}
                        <p className="text-muted-foreground/70 mt-1 text-[11px]">
                          {formatDistanceToNow(row.createdAt, { addSuffix: true })}
                        </p>
                      </div>
                      {isUnread ? (
                        <span className="bg-brand mt-1 size-1.5 shrink-0 rounded-full" aria-label="Unread" />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}

        <div className="border-t px-3 py-2">
          <Button asChild variant="ghost" size="xs" className="w-full justify-center">
            <Link href="/admin/notifications">All notifications</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
