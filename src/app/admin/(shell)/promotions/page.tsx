import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { Plus } from "lucide-react";

import { can, requirePermission } from "@/lib/auth/guards";
import { parseListParams, type SearchParams } from "@/lib/list-params";
import { Button } from "@/components/ui/button";
import { PaginationBar } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";

import { PromotionsTable } from "@/features/promotions/components/promotions-table";
import { PromotionsToolbar } from "@/features/promotions/components/promotions-toolbar";
import { listPromotions } from "@/features/promotions/queries";
import { parsePromotionListFilters, resolvePromotionSort } from "@/features/promotions/schemas";

export const metadata: Metadata = { title: "Promotions" };

/**
 * /admin/promotions (blueprint §1 Promotions, §14.A4). URL state: q, status,
 * type, fundedBy, sort, order, page.
 */
export default async function PromotionsPage({ searchParams }: PageProps<"/admin/promotions">) {
  const actor = await requirePermission("promotions.view");

  const params = (await searchParams) as SearchParams;
  const listParams = parseListParams(params, { defaultSort: "startsAt", defaultOrder: "desc" });
  const filters = parsePromotionListFilters(params);
  const sort = resolvePromotionSort(listParams.sort);
  const canManage = can(actor, "promotions.manage");

  const list = await listPromotions({ ...listParams, sort }, filters);
  const hasFilters = Boolean(listParams.q || filters.status || filters.type || filters.fundedBy);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Promotions"
        description="Scheduled price campaigns over categories, sellers or products. Products show the lower of their sale price and the best promotion; prices switch at the window boundaries automatically."
        actions={
          canManage ? (
            <Button asChild size="sm">
              <Link href={"/admin/promotions/new" as Route}>
                <Plus /> New promotion
              </Link>
            </Button>
          ) : undefined
        }
      />

      <PromotionsToolbar statusCounts={list.statusCounts} />

      <PromotionsTable rows={list.rows} meta={list.meta} sort={sort} order={listParams.order} canManage={canManage} hasFilters={hasFilters} />

      {list.meta.totalPages > 1 ? <PaginationBar meta={list.meta} itemLabel="promotions" /> : null}
    </div>
  );
}
