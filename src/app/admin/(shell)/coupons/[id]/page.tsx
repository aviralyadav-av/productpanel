import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { can, requirePermission } from "@/lib/auth/guards";
import { COUPON_STATUS_META } from "@/lib/enums";
import { one, parseListParams, type SearchParams } from "@/lib/list-params";
import { CopyButton } from "@/components/shared/copy-button";
import { FilterTabs } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { StatusPill } from "@/components/shared/status-badge";

import { CouponActivity } from "@/features/coupons/components/coupon-activity";
import { CouponForm } from "@/features/coupons/components/coupon-form";
import { CouponUsageTable } from "@/features/coupons/components/coupon-usage-table";
import { getCouponEditor, listCouponActivity, listCouponUsages } from "@/features/coupons/queries";

export const metadata: Metadata = { title: "Coupon" };

type Tab = "details" | "usage" | "activity";

function resolveTab(raw: string | undefined): Tab {
  return raw === "usage" || raw === "activity" ? raw : "details";
}

/**
 * /admin/coupons/[id] - Details | Usage | Activity, selected by `?tab=` so a
 * link to the redemption list can be pasted. Only the active tab's data is
 * loaded.
 */
export default async function CouponPage({ params, searchParams }: PageProps<"/admin/coupons/[id]">) {
  const actor = await requirePermission("coupons.view");
  const { id } = await params;
  const query = (await searchParams) as SearchParams;
  const tab = resolveTab(one(query, "tab"));

  const coupon = await getCouponEditor(id);
  if (!coupon) notFound();

  const [usage, activity] = await Promise.all([
    tab === "usage" ? listCouponUsages(id, parseListParams(query, { pageSize: 25 })) : Promise.resolve(null),
    tab === "activity" ? listCouponActivity(id) : Promise.resolve(null),
  ]);

  const status = COUPON_STATUS_META[coupon.status];

  return (
    <div className="space-y-4">
      <PageHeader
        title={coupon.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold tracking-wide">{coupon.code}</span>
            <CopyButton value={coupon.code} label="Copy code" size="icon-xs" />
            <StatusPill label={status.label} tone={status.tone} />
            <span className="text-muted-foreground">
              {coupon.redemptions} redemption{coupon.redemptions === 1 ? "" : "s"}
            </span>
          </span>
        }
        actions={
          <FilterTabs
            paramKey="tab"
            allLabel="Details"
            options={[
              { value: "usage", label: "Usage", count: coupon.redemptions },
              { value: "activity", label: "Activity" },
            ]}
          />
        }
      />

      {tab === "details" ? <CouponForm mode="edit" coupon={coupon} canManage={can(actor, "coupons.manage")} /> : null}
      {tab === "usage" && usage ? <CouponUsageTable rows={usage.rows} meta={usage.meta} /> : null}
      {tab === "activity" && activity ? <CouponActivity rows={activity} /> : null}
    </div>
  );
}
