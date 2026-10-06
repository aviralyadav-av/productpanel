"use client";

import { BANNER_PLACEMENTS, BANNER_PLACEMENT_META } from "@/lib/enums";
import { DataTableToolbar } from "@/components/shared/data-table-toolbar";
import { FilterTabs, SearchInput } from "@/components/shared/list-controls";

import { ParamSelect } from "@/features/coupons/components/coupons-toolbar";

import { BANNER_STATUSES, BANNER_STATUS_META, type BannerStatus } from "../schemas";

/** URL-backed filters for the banner board: status tabs, search, placement. */
export function BannersToolbar({ statusCounts }: { statusCounts: Record<BannerStatus, number> }) {
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <FilterTabs paramKey="status" options={BANNER_STATUSES.map((status) => ({ value: status, label: BANNER_STATUS_META[status].label, count: statusCounts[status] }))} />
      </div>
      <DataTableToolbar
        search={<SearchInput placeholder="Search title, subtitle or URL…" className="w-full sm:w-64" />}
        filters={
          <ParamSelect
            paramKey="placement"
            label="All placements"
            className="w-48"
            options={BANNER_PLACEMENTS.map((placement) => ({ value: placement, label: BANNER_PLACEMENT_META[placement].label }))}
          />
        }
      />
    </div>
  );
}
