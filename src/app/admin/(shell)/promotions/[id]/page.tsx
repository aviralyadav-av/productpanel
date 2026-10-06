import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { can, requirePermission } from "@/lib/auth/guards";
import { one, parseListParams, type SearchParams } from "@/lib/list-params";
import { formatPaise } from "@/lib/money";
import { FilterTabs } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { StatusPill } from "@/components/shared/status-badge";

import { AffectedProductsTable } from "@/features/promotions/components/affected-products-table";
import { PromotionForm } from "@/features/promotions/components/promotion-form";
import { getPromotionEditor, listAffectedProducts } from "@/features/promotions/queries";
import { PROMOTION_STATUS_META, describePromotionDiscount } from "@/features/promotions/schemas";

export const metadata: Metadata = { title: "Promotion" };

/** /admin/promotions/[id] - Details | Affected products, selected by `?tab=`. */
export default async function PromotionPage({ params, searchParams }: PageProps<"/admin/promotions/[id]">) {
  const actor = await requirePermission("promotions.view");
  const { id } = await params;
  const query = (await searchParams) as SearchParams;
  const tab = one(query, "tab") === "products" ? "products" : "details";

  const promotion = await getPromotionEditor(id);
  if (!promotion) notFound();

  const affected = tab === "products" ? await listAffectedProducts(id, parseListParams(query, { pageSize: 25 })) : null;
  const status = PROMOTION_STATUS_META[promotion.status];

  return (
    <div className="space-y-4">
      <PageHeader
        title={promotion.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusPill label={status.label} tone={status.tone} />
            <span>{describePromotionDiscount(promotion, formatPaise)}</span>
            <span className="text-muted-foreground">
              {promotion.affectedProducts} product{promotion.affectedProducts === 1 ? "" : "s"} carrying it
            </span>
          </span>
        }
        actions={<FilterTabs paramKey="tab" allLabel="Details" options={[{ value: "products", label: "Affected products", count: promotion.affectedProducts }]} />}
      />

      {tab === "details" ? <PromotionForm mode="edit" promotion={promotion} canManage={can(actor, "promotions.manage")} /> : null}
      {tab === "products" && affected ? <AffectedProductsTable rows={affected.rows} meta={affected.meta} /> : null}
    </div>
  );
}
