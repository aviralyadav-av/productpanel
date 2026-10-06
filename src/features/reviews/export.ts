import "server-only";

import { writeAudit, type AuditActor } from "@/lib/audit";
import { exportRows, paginateAll, type ExportColumn, type ExportFormat } from "@/lib/export";
import type { ListParams } from "@/lib/list-params";
import { getSettingString } from "@/lib/settings";

import { listReviews } from "./queries";
import type { ReviewListFilters, ReviewSort } from "./schemas";
import type { ReviewListRow } from "./types";

/** Review export (E4, D13): streams the CURRENT filter; audited with filter + row count. */
export const REVIEW_EXPORT_COLUMNS: readonly ExportColumn[] = [
  { key: "id", label: "ID" },
  { key: "productTitle", label: "Product" },
  { key: "productSlug", label: "Product slug" },
  { key: "sellerName", label: "Seller" },
  { key: "authorName", label: "Author" },
  { key: "authorLocation", label: "Location" },
  { key: "rating", label: "Rating", type: "number" },
  { key: "title", label: "Title" },
  { key: "body", label: "Review" },
  { key: "status", label: "Status" },
  { key: "isVerifiedPurchase", label: "Verified purchase", type: "boolean" },
  { key: "isFeatured", label: "Featured", type: "boolean" },
  { key: "imageCount", label: "Images", type: "number" },
  { key: "hasReply", label: "Replied", type: "boolean" },
  { key: "createdAt", label: "Submitted", type: "date" },
];

export async function exportReviews(input: {
  format: ExportFormat;
  params: ListParams & { sort: ReviewSort };
  filters: ReviewListFilters;
  actor: AuditActor;
  ip?: string | null;
}): Promise<Response> {
  const storeName = await getSettingString("store.name").catch(() => "DIY Baazar");
  const stamp = new Date().toISOString().slice(0, 10);
  return exportRows({
    format: input.format,
    filename: `reviews-${stamp}`,
    title: `Reviews - ${stamp}`,
    storeName,
    columns: REVIEW_EXPORT_COLUMNS,
    rows: paginateAll<ReviewListRow>(
      async (skip, take) =>
        (await listReviews({ ...input.params, skip, page: Math.floor(skip / take) + 1, pageSize: take }, input.filters)).rows,
      { pageSize: 1000, map: (row) => ({ ...row, imageCount: row.images.length, sellerName: row.sellerName ?? "Platform" }) },
    ),
    onComplete: (rowCount) =>
      writeAudit({
        actor: input.actor,
        action: "review.export",
        entityType: "Review",
        summary: `Exported ${rowCount} review row(s) as ${input.format.toUpperCase()}.`,
        diff: { format: input.format, rowCount, filters: JSON.parse(JSON.stringify(input.filters)) },
        ip: input.ip,
      }),
  });
}
