import type { Metadata } from "next";
import Link from "next/link";
import { Percent, SearchX } from "lucide-react";

import { can, requirePermission } from "@/lib/auth/guards";
import { COMMISSION_SCOPES, COMMISSION_SCOPE_META } from "@/lib/enums";
import { parseListParams, type SearchParams } from "@/lib/list-params";
import { Button } from "@/components/ui/button";
import { DataTableToolbar } from "@/components/shared/data-table-toolbar";
import { DateRangePicker } from "@/components/shared/date-range-picker";
import { resolveDateRangeParams } from "@/components/shared/date-range";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterTabs, PaginationBar, SearchInput } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGate } from "@/components/shared/permission-gate";

import { ChargesEditor } from "@/features/finance/components/charges-editor";
import { CommissionSummaryPanel } from "@/features/finance/components/commission-summary";
import { CommissionRulesTable, NewCommissionRuleButton } from "@/features/finance/components/commission-rules";
import { GlobalRuleCard } from "@/features/finance/components/global-rule-card";
import { CommissionResolverCard } from "@/features/finance/components/resolver-card";
import {
  commissionScopeCounts,
  commissionSummary,
  getCommissionFilterRefs,
  getGlobalCommissionRule,
  getMarketplaceCharges,
  listCommissionRules,
  resolveCommissionForProduct,
} from "@/features/finance/queries";
import {
  hasCommissionFilters,
  parseCommissionFilters,
  parseCommissionSort,
} from "@/features/finance/ui-schemas";

export const metadata: Metadata = { title: "Commissions" };

/**
 * /admin/commissions (blueprint §1 Finance, §14.B3).
 *
 * Four things on one screen because they answer one another: the global
 * fallback rate, the rules that override it, a tester that shows which rule a
 * given product actually lands on, and what the platform earned in a range.
 * Everything filterable lives in the URL.
 */
export default async function CommissionsPage({ searchParams }: PageProps<"/admin/commissions">) {
  const actor = await requirePermission("commissions.view");

  const params = (await searchParams) as SearchParams;
  const list = parseListParams(params, { defaultSort: "updatedAt", defaultOrder: "desc", pageSize: 25 });
  const sort = parseCommissionSort(list.sort);
  const filters = parseCommissionFilters(params);
  const range = resolveDateRangeParams(params, "30d");
  const canManage = can(actor, "commissions.manage");

  const [globalRule, rules, counts, charges, summary, refs] = await Promise.all([
    getGlobalCommissionRule(),
    listCommissionRules({ ...list, sort }, filters),
    commissionScopeCounts(filters),
    getMarketplaceCharges(),
    commissionSummary(range),
    getCommissionFilterRefs(filters),
  ]);

  // Resolved server-side so a ?product= link paints its answer on first render.
  const initialResolution = filters.productId
    ? await resolveCommissionForProduct(filters.productId)
    : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Commissions"
        description="What the marketplace charges sellers: one global fallback, overrides per category, seller or product, and the charges deducted on top."
        actions={
          <PermissionGate require="commissions.manage">
            <NewCommissionRuleButton />
          </PermissionGate>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <GlobalRuleCard rule={globalRule} canManage={canManage} />
        <CommissionResolverCard initialProduct={refs.product} initialResolution={initialResolution} />
        <ChargesEditor charges={charges} canManage={canManage} />
      </div>

      <div className="surface overflow-hidden">
        <DataTableToolbar
          search={<SearchInput placeholder="Search a rule, target or note…" />}
          filters={
            <>
              <FilterTabs
                paramKey="scope"
                allLabel={`All ${counts.all}`}
                options={COMMISSION_SCOPES.map((scope) => ({
                  value: scope,
                  label: COMMISSION_SCOPE_META[scope].label,
                  count: counts[scope],
                }))}
              />
              <FilterTabs
                paramKey="active"
                allLabel="Any status"
                options={[
                  { value: "1", label: "Active" },
                  { value: "0", label: "Inactive" },
                ]}
              />
            </>
          }
        />

        {rules.rows.length === 0 ? (
          hasCommissionFilters(filters) ? (
            <EmptyState
              icon={SearchX}
              title="No rules match these filters"
              description="Try a different search, or clear the filters to see every commission rule."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/admin/commissions">Clear filters</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Percent}
              title="No commission rules yet"
              description="Set the global rate above, then add overrides for the categories, sellers or products that need a different rate."
              action={
                <PermissionGate require="commissions.manage">
                  <NewCommissionRuleButton />
                </PermissionGate>
              }
            />
          )
        ) : (
          <>
            <CommissionRulesTable
              rows={rules.rows}
              sort={sort}
              order={list.order}
              canManage={canManage}
            />
            <PaginationBar meta={rules.meta} itemLabel="rules" />
          </>
        )}
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Commission earned</h2>
            <p className="text-muted-foreground text-xs">{range.label}</p>
          </div>
          <DateRangePicker align="end" />
        </div>
        <CommissionSummaryPanel summary={summary} rangeLabel={range.label} />
      </section>
    </div>
  );
}
