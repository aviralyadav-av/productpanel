import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { BellOff, SearchX } from "lucide-react";

import { requirePermission } from "@/lib/auth/guards";
import { formatIstDateTime } from "@/lib/dates";
import { formatNumber } from "@/lib/money";
import { one, parseListParams, type SearchParams } from "@/lib/list-params";
import { Button } from "@/components/ui/button";
import { DataTableToolbar } from "@/components/shared/data-table-toolbar";
import { EmptyState } from "@/components/shared/empty-state";
import { SearchInput } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";

import { MarkAllReadButton, NotificationList } from "@/features/notifications/components/notification-list";
import { NotificationFilters } from "@/features/notifications/components/notification-toolbar";
import { PreferencesForm, TestNotificationButton } from "@/features/notifications/components/preferences-form";
import {
  listNotifications,
  notificationOverview,
  notificationTypeCounts,
} from "@/features/notifications/queries";
import {
  hasNotificationFilters,
  parseNotificationFilters,
  resolveNotificationTab,
} from "@/features/notifications/schemas";
import { getPreferences } from "@/features/notifications/service";

export const metadata: Metadata = { title: "Notifications" };

/**
 * /admin/notifications (blueprint §1 Notifications, §10, E3).
 *
 * Two tabs on one route: the actor's own inbox (`?tab=inbox`, the default)
 * and their delivery preferences (`?tab=preferences`). Both are personal -
 * `notifications.view` is the only permission involved, because an inbox is
 * yours and nobody else's; what varies per operator is WHICH types reach them
 * at all, which the preferences tab spells out per row.
 */
export default async function NotificationsPage({ searchParams }: PageProps<"/admin/notifications">) {
  const actor = await requirePermission("notifications.view");

  const params = (await searchParams) as SearchParams;
  const tab = resolveNotificationTab(one(params, "tab"));
  const filters = parseNotificationFilters(params);
  const list = parseListParams(params, { defaultSort: "createdAt", defaultOrder: "desc", pageSize: 30 });

  const overview = await notificationOverview(actor.id);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Notifications"
        description="Everything the platform wanted you to know: new orders, failed payments, stock hitting zero, approvals waiting on you. Rows are created per recipient, so marking one read here never touches anyone else's inbox."
        actions={tab === "inbox" ? <MarkAllReadButton unread={overview.unread} /> : <TestNotificationButton />}
      />

      <section aria-label="Inbox summary" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard
          label="Unread"
          value={formatNumber(overview.unread)}
          href={"/admin/notifications?unread=1" as Route}
          higherIsBetter={false}
          hint={overview.unread === 0 ? "Inbox zero" : "Waiting for you"}
        />
        <StatCard
          label="Unread critical"
          value={formatNumber(overview.unreadCritical)}
          href={"/admin/notifications?unread=1&severity=critical" as Route}
          higherIsBetter={false}
          hint="Payment failures, stock-outs"
        />
        <StatCard label="Today" value={formatNumber(overview.today)} hint="Received since midnight IST" />
        <StatCard
          label="Total"
          value={formatNumber(overview.total)}
          hint={overview.lastAt ? `Last ${formatIstDateTime(new Date(overview.lastAt))}` : "Nothing yet"}
        />
      </section>

      <div className="surface overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
          <nav aria-label="Notification tabs" className="bg-muted inline-flex items-center gap-0.5 rounded-lg p-0.5">
            {(["inbox", "preferences"] as const).map((item) => (
              <Link
                key={item}
                href={(item === "inbox" ? "/admin/notifications" : "/admin/notifications?tab=preferences") as Route}
                aria-current={tab === item ? "page" : undefined}
                className={
                  tab === item
                    ? "bg-background text-foreground rounded-md px-2.5 py-1 text-xs font-medium shadow-xs"
                    : "text-muted-foreground hover:text-foreground rounded-md px-2.5 py-1 text-xs font-medium"
                }
              >
                {item === "inbox" ? "Inbox" : "Preferences"}
              </Link>
            ))}
          </nav>
        </div>

        {tab === "preferences" ? (
          <PreferencesTab userId={actor.id} permissions={[...actor.permissions]} />
        ) : (
          <InboxTab filters={filters} list={list} userId={actor.id} />
        )}
      </div>
    </div>
  );
}

async function InboxTab({
  userId,
  filters,
  list,
}: {
  userId: string;
  filters: ReturnType<typeof parseNotificationFilters>;
  list: ReturnType<typeof parseListParams>;
}) {
  const [counts, result] = await Promise.all([
    notificationTypeCounts(userId, filters),
    listNotifications(userId, list, filters),
  ]);

  return (
    <>
      <DataTableToolbar
        search={<SearchInput placeholder="Search title, body or entity id…" />}
        filters={<NotificationFilters counts={counts} />}
      />

      {result.rows.length === 0 ? (
        hasNotificationFilters(filters) ? (
          <EmptyState
            icon={SearchX}
            title="Nothing matches these filters"
            description="Try a different search, widen the date range, or clear the filters."
            action={
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/notifications">Clear filters</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={BellOff}
            title="No notifications yet"
            description="Orders, payments, stock alerts and approvals land here as they happen. Use “Send me a test notification” on the Preferences tab to check the plumbing."
          />
        )
      ) : (
        <NotificationList rows={result.rows} meta={result.meta} />
      )}
    </>
  );
}

async function PreferencesTab({ userId, permissions }: { userId: string; permissions: string[] }) {
  const rows = await getPreferences(userId);

  return (
    <div className="space-y-4 p-4">
      <p className="text-muted-foreground max-w-3xl text-xs leading-relaxed">
        In-app delivery writes a row to your inbox; email delivery also queues a copy to your address through the
        outbox (so it is retried if SMTP is down, and visible on{" "}
        <Link className="text-brand hover:underline" href={"/admin/email-templates?tab=outbox" as Route}>
          the email outbox
        </Link>
        ). A type only ever reaches you if your role holds the permission listed beside it — super-admins qualify
        for everything.
      </p>
      <PreferencesForm rows={rows} actorPermissions={permissions} />
    </div>
  );
}
