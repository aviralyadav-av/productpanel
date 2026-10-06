import { parseListQuery, withAdminApi } from "@/lib/api/admin";
import { writeAudit } from "@/lib/audit";
import { exportRows, paginateAll, parseExportFormat, type ExportColumn } from "@/lib/export";
import { getSettingString } from "@/lib/settings";

import { listSellersForExport } from "@/features/sellers/queries";
import { parseSellerFilters } from "@/features/sellers/schemas";

/**
 * GET /api/admin/sellers/export?format=csv|xlsx&<same filters as the list>   (sellers.view)
 *
 * Streams every seller matching the current filters. Audited with the filter
 * set and the row count once the last row is written (D13). Tax ids are
 * exported masked, as they appear on screen.
 */
const COLUMNS: readonly ExportColumn[] = [
  { key: "displayName", label: "Seller" },
  { key: "slug", label: "Slug" },
  { key: "legalName", label: "Legal name" },
  { key: "ownerName", label: "Owner" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "status", label: "Status" },
  { key: "gstin", label: "GSTIN (masked)" },
  { key: "documentsVerified", label: "Docs verified", type: "number" },
  { key: "documentsTotal", label: "Docs total", type: "number" },
  { key: "productCount", label: "Products", type: "number" },
  { key: "publishedProductCount", label: "Published", type: "number" },
  { key: "orderCount", label: "Orders", type: "number" },
  { key: "grossSalesPaise", label: "Gross sales", type: "money" },
  { key: "ratingAvg", label: "Rating", type: "number" },
  { key: "reviewCount", label: "Reviews", type: "number" },
  { key: "commissionPct", label: "Commission %", type: "number" },
  { key: "availablePaise", label: "Available payable", type: "money" },
  { key: "openPayout", label: "Open payout" },
  { key: "registeredAt", label: "Registered", type: "date" },
];

export const GET = withAdminApi(
  async ({ searchParams, actor, ip }) => {
    const query = parseListQuery(searchParams);
    const filters = parseSellerFilters(query.raw);
    const format = parseExportFormat(searchParams.get("format"));
    const storeName = await getSettingString("store.name").catch(() => "DIY Baazar");

    return exportRows({
      format,
      filename: `sellers-${new Date().toISOString().slice(0, 10)}`,
      title: filters.status ? `Sellers - ${filters.status.toLowerCase()}` : "Sellers",
      storeName,
      columns: COLUMNS,
      rows: paginateAll((skip, take) => listSellersForExport(filters, skip, take), {
        pageSize: 1000,
        map: (row) => ({
          displayName: row.displayName,
          slug: row.slug,
          legalName: row.legalName,
          ownerName: row.ownerName,
          email: row.email,
          phone: row.phone,
          city: row.city,
          state: row.state,
          status: row.status,
          gstin: row.gstinMasked,
          documentsVerified: row.documents.verified,
          documentsTotal: row.documents.total,
          productCount: row.productCount,
          publishedProductCount: row.publishedProductCount,
          orderCount: row.orderCount,
          grossSalesPaise: row.grossSalesPaise,
          ratingAvg: row.ratingAvg,
          reviewCount: row.reviewCount,
          commissionPct: row.commission.rateBps / 100,
          availablePaise: row.payout.availablePaise,
          openPayout: row.payout.openPayout?.number ?? "",
          registeredAt: new Date(row.registeredAt),
        }),
      }),
      onComplete: (rowCount) =>
        writeAudit({
          actor,
          action: "seller.export",
          entityType: "Seller",
          summary: `Exported ${rowCount} sellers as ${format.toUpperCase()}.`,
          diff: { format, rowCount, filters: { ...filters } },
          ip,
          userAgent: null,
        }),
    });
  },
  { permission: "sellers.view", rateLimit: { limit: 20, windowMs: 60_000 } },
);
