import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { Mail, SearchX } from "lucide-react";

import { requirePermission } from "@/lib/auth/guards";
import { NEWSLETTER_STATUSES, NEWSLETTER_STATUS_META } from "@/lib/enums";
import { parseListParams, type SearchParams } from "@/lib/list-params";
import { formatNumber } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Sparkline } from "@/components/charts/sparkline";
import { DataTableToolbar } from "@/components/shared/data-table-toolbar";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterTabs, PaginationBar, SearchInput } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGate } from "@/components/shared/permission-gate";
import { StatCard } from "@/components/shared/stat-card";

import { AddSubscriberButton } from "@/features/newsletter/components/add-subscriber-dialog";
import { ImportSubscribersButton } from "@/features/newsletter/components/import-dialog";
import { NewsletterExportButton, NewsletterFilters } from "@/features/newsletter/components/newsletter-toolbar";
import { SubscriberTable } from "@/features/newsletter/components/subscriber-table";
import { listSubscriberSources, listSubscribers, newsletterKpis, subscriberStatusCounts } from "@/features/newsletter/queries";
import { hasNewsletterFilters, parseNewsletterFilters, parseNewsletterSort } from "@/features/newsletter/schemas";

export const metadata: Metadata = { title: "Newsletter" };

/**
 * /admin/newsletter (blueprint §1 Newsletter). One screen: how the list is
 * doing, who is on it, and the two ways addresses get added by hand (a single
 * subscriber, or a CSV). Everything else arrives from the storefront through
 * POST /api/v1/newsletter/subscribe.
 */
export default async function NewsletterPage({ searchParams }: PageProps<"/admin/newsletter">) {
  await requirePermission("newsletter.view");

  const params = (await searchParams) as SearchParams;
  const list = parseListParams(params, { defaultSort: "subscribedAt", defaultOrder: "desc", pageSize: 25 });
  const sort = parseNewsletterSort(list.sort);
  const filters = parseNewsletterFilters(params);

  const [kpis, counts, result, sources] = await Promise.all([
    newsletterKpis(),
    subscriberStatusCounts(filters),
    listSubscribers({ ...list, sort }, filters),
    listSubscriberSources(),
  ]);

  const netGrowth = kpis.growth.at(-1) ?? 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Newsletter"
        description="Everyone who asked to hear from the store. Subscriptions arrive from the storefront; unsubscribes happen through the one-click link in every email and are honoured immediately."
        actions={
          <PermissionGate require="newsletter.manage">
            <div className="flex flex-wrap items-center gap-2">
              <ImportSubscribersButton />
              <AddSubscriberButton />
            </div>
          </PermissionGate>
        }
      />

      <section aria-label="Newsletter metrics" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Subscribed" value={formatNumber(kpis.subscribed)} href={"/admin/newsletter?status=SUBSCRIBED" as Route} hint="Currently receiving campaigns" />
        <StatCard
          label="Unsubscribed this month"
          value={formatNumber(kpis.unsubscribedThisMonth)}
          href={"/admin/newsletter?status=UNSUBSCRIBED" as Route}
          higherIsBetter={false}
          hint="Opted out since the 1st"
        />
        <StatCard label="Bounced" value={formatNumber(kpis.bounced)} href={"/admin/newsletter?status=BOUNCED" as Route} higherIsBetter={false} hint="Delivery failed" />
        <div className="surface flex flex-col justify-between p-3">
          <span className="text-muted-foreground text-xs font-medium">Net growth</span>
          <div className="mt-1 flex items-end justify-between gap-2">
            <span data-numeric className="text-2xl font-semibold tracking-tight">
              {netGrowth > 0 ? `+${formatNumber(netGrowth)}` : formatNumber(netGrowth)}
            </span>
            <Sparkline values={kpis.growth} label="Net new subscribers per month, last 12 months" width="100%" />
          </div>
          <span className="text-muted-foreground mt-1 text-[11px]">
            {kpis.addedThisMonth} joined this month · last 12 months
          </span>
        </div>
      </section>

      <div className="surface overflow-hidden">
        <DataTableToolbar
          search={<SearchInput placeholder="Search email or name…" />}
          filters={
            <>
              <FilterTabs
                paramKey="status"
                allLabel={`All ${counts.all}`}
                options={NEWSLETTER_STATUSES.map((status) => ({ value: status, label: NEWSLETTER_STATUS_META[status].label, count: counts[status] }))}
              />
              <NewsletterFilters sources={sources} />
            </>
          }
          actions={
            <PermissionGate require="newsletter.export">
              <NewsletterExportButton />
            </PermissionGate>
          }
        />

        {result.rows.length === 0 ? (
          hasNewsletterFilters(filters) ? (
            <EmptyState
              icon={SearchX}
              title="No subscribers match these filters"
              description="Try a different search, or clear the filters."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/admin/newsletter">Clear filters</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Mail}
              title="No subscribers yet"
              description="Sign-ups from the storefront (POST /api/v1/newsletter/subscribe) land here. You can also add one by hand or import a CSV."
              action={
                <PermissionGate require="newsletter.manage">
                  <AddSubscriberButton />
                </PermissionGate>
              }
            />
          )
        ) : (
          <>
            <SubscriberTable rows={result.rows} sort={sort} order={list.order} />
            <PaginationBar meta={result.meta} itemLabel="subscribers" />
          </>
        )}
      </div>
    </div>
  );
}
