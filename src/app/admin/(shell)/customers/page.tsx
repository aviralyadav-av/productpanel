import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { Plus } from "lucide-react";

import { requirePermission } from "@/lib/auth/guards";
import { parseListParams, type SearchParams } from "@/lib/list-params";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";

import { CustomerKpiStrip } from "@/features/customers/components/customer-kpis";
import { CustomerList } from "@/features/customers/components/customer-list";
import { CUSTOMER_SORTS, parseCustomerFilters, resolveCustomerSort } from "@/features/customers/filters";
import { getCustomerKpis, getSegmentCounts, getTagSuggestions, listCustomers, resolveSegmentThresholds } from "@/features/customers/queries";

export const metadata: Metadata = { title: "Customers" };

/**
 * /admin/customers - the CRM list (blueprint section 1 Customers, C7, brief
 * section 7). Filters, segment, sort and page live in the URL; this Server
 * Component reads them, queries once and hands serialisable rows to the
 * client list.
 */
export default async function CustomersPage({ searchParams }: PageProps<"/admin/customers">) {
  const actor = await requirePermission("customers.view");

  const params = (await searchParams) as SearchParams;
  const listParams = parseListParams(params, { defaultSort: "createdAt", defaultOrder: "desc", pageSize: 25 });
  if (!(CUSTOMER_SORTS as readonly string[]).includes(listParams.sort)) listParams.sort = "createdAt";
  const filters = parseCustomerFilters(params);
  const thresholds = await resolveSegmentThresholds();

  const [result, segmentCounts, kpis, tagSuggestions] = await Promise.all([
    listCustomers(listParams, filters, thresholds),
    getSegmentCounts(filters, thresholds),
    getCustomerKpis(thresholds),
    getTagSuggestions(),
  ]);

  const exportQuery = new URLSearchParams(
    Object.entries(params).flatMap(([key, value]) => (Array.isArray(value) ? value.map((item) => [key, item]) : value ? [[key, value]] : [])),
  );
  exportQuery.delete("page");
  exportQuery.delete("pageSize");

  const permissions = actor.isSuperAdmin ? ["*"] : [...actor.permissions];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Customers"
        description="Everyone who has registered or ordered on the website. Segments are computed from the thresholds in Settings; blocking signs a customer out everywhere."
        actions={
          permissions.includes("*") || permissions.includes("customers.create") ? (
            <Button asChild size="sm">
              <Link href={"/admin/customers/new" as Route}>
                <Plus /> New customer
              </Link>
            </Button>
          ) : null
        }
      />

      <CustomerKpiStrip kpis={kpis} />

      <CustomerList
        rows={result.rows}
        meta={result.meta}
        filters={filters}
        segmentCounts={segmentCounts}
        sort={resolveCustomerSort(listParams.sort)}
        order={listParams.order}
        tagSuggestions={tagSuggestions}
        permissions={permissions}
        exportQuery={exportQuery.toString()}
      />
    </div>
  );
}
