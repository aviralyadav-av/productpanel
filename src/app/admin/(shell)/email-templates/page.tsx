import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { Inbox, Mail, SearchX } from "lucide-react";

import { can, requirePermission } from "@/lib/auth/guards";
import { EMAIL_OUTBOX_STATUSES, EMAIL_OUTBOX_STATUS_META } from "@/lib/enums";
import { formatIstDateTime } from "@/lib/dates";
import { formatNumber } from "@/lib/money";
import { one, parseListParams, type SearchParams } from "@/lib/list-params";
import { Button } from "@/components/ui/button";
import { DataTableToolbar } from "@/components/shared/data-table-toolbar";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterTabs, PaginationBar, SearchInput } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";

import { OutboxDetailSheet, OutboxFilterBar, OutboxTable } from "@/features/email/components/outbox-table";
import { TemplateTable } from "@/features/email/components/template-table";
import {
  getOutboxDetail,
  listEmailTemplates,
  listOutbox,
  outboxOverview,
  outboxStatusCounts,
  outboxTemplateKeys,
} from "@/features/email/queries";
import {
  hasOutboxFilters,
  hasTemplateFilters,
  parseOutboxFilters,
  parseTemplateFilters,
  resolveEmailTab,
  resolveTemplateSort,
} from "@/features/email/templates-schemas";

export const metadata: Metadata = { title: "Email templates" };

/**
 * /admin/email-templates (blueprint §1 "Email templates", §4.9, E3).
 *
 * Two tabs on one route because they answer two halves of the same question:
 * the Templates tab is what we WILL send, the Outbox tab is what we DID.
 * Operators move between them constantly ("the shipped email looks wrong" →
 * open the template; "did it go out?" → open the outbox filtered by that key),
 * so both live in one URL space with shared search and date filters.
 */
export default async function EmailTemplatesPage({ searchParams }: PageProps<"/admin/email-templates">) {
  const actor = await requirePermission("email_templates.view");

  const params = (await searchParams) as SearchParams;
  const tab = resolveEmailTab(one(params, "tab"));
  const canSeeOutbox = can(actor, "email_outbox.view");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Email templates"
        description="Every transactional email the platform sends, with its {{variables}}, a live preview and the outbox that proves it went out. Disabling a template stops that email without touching the flow that triggers it."
      />

      <div className="surface overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
          <nav aria-label="Email tabs" className="bg-muted inline-flex items-center gap-0.5 rounded-lg p-0.5">
            <TabLink href="/admin/email-templates" active={tab === "templates"} label="Templates" />
            {canSeeOutbox ? (
              <TabLink href="/admin/email-templates?tab=outbox" active={tab === "outbox"} label="Outbox" />
            ) : null}
          </nav>
        </div>

        {tab === "outbox" && canSeeOutbox ? <OutboxTab params={params} /> : <TemplatesTab params={params} />}
      </div>
    </div>
  );
}

function TabLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href as Route}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "bg-background text-foreground rounded-md px-2.5 py-1 text-xs font-medium shadow-xs"
          : "text-muted-foreground hover:text-foreground rounded-md px-2.5 py-1 text-xs font-medium"
      }
    >
      {label}
    </Link>
  );
}

async function TemplatesTab({ params }: { params: SearchParams }) {
  const list = parseListParams(params, { defaultSort: "key", defaultOrder: "asc", pageSize: 25 });
  const sort = resolveTemplateSort(list.sort);
  const filters = parseTemplateFilters(params);
  const result = await listEmailTemplates({ ...list, sort }, filters);

  return (
    <>
      <DataTableToolbar
        search={<SearchInput placeholder="Search key, name, subject or body…" />}
        filters={
          <FilterTabs
            paramKey="active"
            allLabel={`All ${result.total}`}
            options={[
              { value: "1", label: "Active", count: result.activeCount },
              { value: "0", label: "Disabled" },
            ]}
          />
        }
      />

      {result.rows.length === 0 ? (
        hasTemplateFilters(filters) ? (
          <EmptyState
            icon={SearchX}
            title="No templates match these filters"
            description="Try a different search, or clear the filters."
            action={
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/email-templates">Clear filters</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Mail}
            title="No email templates"
            description="Templates are seeded from the event matrix (prisma/seed/modules/templates.ts). Run the seed to create them."
          />
        )
      ) : (
        <>
          <TemplateTable rows={result.rows} sort={sort} order={list.order} />
          <PaginationBar meta={result.meta} itemLabel="templates" />
        </>
      )}
    </>
  );
}

async function OutboxTab({ params }: { params: SearchParams }) {
  const list = parseListParams(params, { defaultSort: "createdAt", defaultOrder: "desc", pageSize: 25 });
  const filters = parseOutboxFilters(params);
  const openId = one(params, "email");

  const [result, counts, stats, templateKeys, detail] = await Promise.all([
    listOutbox(list, filters),
    outboxStatusCounts(filters),
    outboxOverview(),
    outboxTemplateKeys(),
    openId ? getOutboxDetail(openId) : Promise.resolve(null),
  ]);

  return (
    <>
      <section aria-label="Outbox health" className="grid grid-cols-2 gap-3 border-b p-4 xl:grid-cols-4">
        <StatCard label="Queued" value={formatNumber(stats.byStatus.QUEUED + stats.byStatus.SENDING)} hint="Waiting for the worker" />
        <StatCard label="Sent" value={formatNumber(stats.byStatus.SENT)} />
        <StatCard
          label="Failed"
          value={formatNumber(stats.byStatus.FAILED)}
          higherIsBetter={false}
          hint={`${formatNumber(stats.failedLast24h)} in the last 24 h`}
        />
        <StatCard
          label="Oldest due"
          value={stats.oldestDueQueuedAt ? formatIstDateTime(new Date(stats.oldestDueQueuedAt)) : "—"}
          hint="A growing gap means the worker is not running"
        />
      </section>

      <DataTableToolbar
        search={<SearchInput placeholder="Search recipient, subject or error…" />}
        filters={
          <>
            <FilterTabs
              paramKey="status"
              allLabel={`All ${counts.all}`}
              options={EMAIL_OUTBOX_STATUSES.map((status) => ({
                value: status,
                label: EMAIL_OUTBOX_STATUS_META[status].label,
                count: counts[status],
              }))}
            />
            <OutboxFilterBar templateKeys={templateKeys} />
          </>
        }
      />

      {result.rows.length === 0 ? (
        hasOutboxFilters(filters) ? (
          <EmptyState
            icon={SearchX}
            title="No emails match these filters"
            description="Try a different search, widen the date range, or clear the filters."
            action={
              <Button asChild variant="outline" size="sm">
                <Link href={"/admin/email-templates?tab=outbox" as Route}>Clear filters</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Inbox}
            title="Nothing has been emailed yet"
            description="Every email the platform queues lands here first, then the email.send job delivers it. Send yourself a test from any template to see one."
          />
        )
      ) : (
        <>
          <OutboxTable rows={result.rows} sort={list.sort} order={list.order} />
          <PaginationBar meta={result.meta} itemLabel="emails" />
        </>
      )}

      <OutboxDetailSheet email={detail} />
    </>
  );
}
