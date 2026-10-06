import { withAdminApi } from "@/lib/api/admin";
import { writeAudit } from "@/lib/audit";
import { exportRows, paginateAll, parseExportFormat, type ExportColumn } from "@/lib/export";

import { pageCouponsForExport } from "@/features/coupons/queries";
import { parseCouponListFilters } from "@/features/coupons/schemas";
import { describeDiscount } from "@/features/coupons/summary";

const COLUMNS: readonly ExportColumn[] = [
  { key: "code", label: "Code" },
  { key: "name", label: "Name" },
  { key: "type", label: "Type" },
  { key: "discount", label: "Discount" },
  { key: "minOrderPaise", label: "Minimum order", type: "money" },
  { key: "scope", label: "Scope" },
  { key: "usageCount", label: "Used", type: "number" },
  { key: "usageLimit", label: "Limit", type: "number" },
  { key: "status", label: "Status" },
  { key: "fundedBy", label: "Funded by" },
  { key: "isPublic", label: "Public", type: "boolean" },
  { key: "startsAt", label: "Starts", type: "date" },
  { key: "endsAt", label: "Ends", type: "date" },
];

/**
 * GET /api/admin/coupons/export?format=csv|xlsx&<same filters as the list>   (coupons.view)
 * Streams pages of 5,000 (§11.28) and audits filter + row count (D13).
 */
export const GET = withAdminApi(
  async ({ actor, searchParams, ip }) => {
    const format = parseExportFormat(searchParams.get("format"));
    const filters = { ...parseCouponListFilters(searchParams), q: searchParams.get("q")?.trim() || undefined };
    const now = new Date();

    return exportRows({
      format,
      filename: `coupons-${now.toISOString().slice(0, 10)}`,
      title: "Coupons",
      columns: COLUMNS,
      rows: paginateAll((skip, take) => pageCouponsForExport(filters, skip, take, now), {
        map: (row) => ({ ...row, discount: describeDiscount(row), scope: row.scopeLabel }),
      }),
      onComplete: (rowCount) =>
        writeAudit({
          actor,
          action: "coupon.export",
          entityType: "coupon",
          summary: `Exported ${rowCount} coupon${rowCount === 1 ? "" : "s"} as ${format.toUpperCase()}.`,
          diff: { filters: JSON.parse(JSON.stringify(filters)), rowCount },
          ip,
        }),
    });
  },
  { permission: "coupons.view" },
);
