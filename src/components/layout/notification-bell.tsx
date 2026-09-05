"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Bell, TriangleAlert, Info, OctagonAlert } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EmptyState } from "@/components/shared/empty-state";

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
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative"
          aria-label={
            unreadCount > 0
              ? `Notifications, ${unreadCount} unread`
              : "Notifications"
          }
        >
          <Bell className="size-4" />
          {unreadCount > 0 ? (
            <span className="bg-destructive absolute right-0.5 top-0.5 size-1.5 rounded-full" />
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-medium">Notifications</p>
          {unreadCount > 0 ? (
            <span className="text-muted-foreground text-xs" data-numeric>
              {unreadCount} unread
            </span>
          ) : null}
        </div>

        {notifications.length === 0 ? (
          <EmptyState
            compact
            icon={Bell}
            title="Nothing needs you right now"
            description="New orders, low stock and reviews awaiting moderation will appear here."
          />
        ) : (
          <ScrollArea className="max-h-80">
            <ul className="divide-y">
              {notifications.map((notification) => {
                const Icon =
                  SEVERITY_ICON[
                    notification.severity as keyof typeof SEVERITY_ICON
                  ] ?? Info;
                const tone =
                  SEVERITY_CLASS[
                    notification.severity as keyof typeof SEVERITY_CLASS
                  ] ?? "text-info";

                const content = (
                  <div className="flex gap-2.5 px-3 py-2.5">
                    <Icon className={cn("mt-0.5 size-3.5 shrink-0", tone)} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium leading-snug">
                        {notification.title}
                      </p>
                      {notification.body ? (
                        <p className="text-muted-foreground mt-0.5 text-xs leading-snug">
                          {notification.body}
                        </p>
                      ) : null}
                      <p className="text-muted-foreground/70 mt-1 text-[11px]">
                        {formatDistanceToNow(notification.createdAt, {
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                    {!notification.readAt ? (
                      <span className="bg-brand mt-1 size-1.5 shrink-0 rounded-full" />
                    ) : null}
                  </div>
                );

                return (
                  <li key={notification.id}>
                    {notification.href ? (
                      <Link
                        href={notification.href as never}
                        className="hover:bg-accent/60 block"
                      >
                        {content}
                      </Link>
                    ) : (
                      content
                    )}
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}
