"use client";

import { PROMOTION_TYPES, PROMOTION_TYPE_META } from "@/lib/enums";
import { DataTableToolbar } from "@/components/shared/data-table-toolbar";
import { FilterTabs, SearchInput } from "@/components/shared/list-controls";

import { ParamSelect } from "@/features/coupons/components/coupons-toolbar";

import { PROMOTION_STATUSES, PROMOTION_STATUS_META, type PromotionStatus } from "../schemas";

/** URL-backed filters for /admin/promotions (status tabs, search, type, funder). */
export function PromotionsToolbar({ statusCounts }: { statusCounts: Record<PromotionStatus, number> }) {
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <FilterTabs
          paramKey="status"
          options={PROMOTION_STATUSES.map((status) => ({ value: status, label: PROMOTION_STATUS_META[status].label, count: statusCounts[status] }))}
        />
      </div>
      <DataTableToolbar
        search={<SearchInput placeholder="Search name, slug or badge…" className="w-full sm:w-64" />}
        filters={
          <>
            <ParamSelect paramKey="type" label="All types" options={PROMOTION_TYPES.map((type) => ({ value: type, label: PROMOTION_TYPE_META[type].label }))} />
            <ParamSelect
              paramKey="fundedBy"
              label="Any funder"
              options={[
                { value: "PLATFORM", label: "Platform-funded" },
                { value: "SELLER", label: "Seller-funded" },
              ]}
            />
          </>
        }
      />
    </div>
  );
}
