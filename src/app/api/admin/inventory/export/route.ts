import { parseListQuery, withAdminApi } from "@/lib/api/admin";
import { parseExportFormat } from "@/lib/export";
import { resolveDateRangeParams } from "@/components/shared/date-range";
import { exportInventoryLevels, exportStockMovements } from "@/features/inventory/export";
import {
  INVENTORY_SORTS,
  hasDateWindow,
  parseExportScope,
  parseInventoryFilters,
  parseInventorySort,
  parseMovementFilters,
} from "@/features/inventory/schemas";

/**
 * GET /api/admin/inventory/export?format=csv|xlsx&scope=levels|movements&<the tab's filters>   (inventory.view)
 *
 * Streams the rows the corresponding table would show, in pages (§11.28),
 * and audits the export with its filter and row count (D13). `print` is
 * accepted for completeness but the tables print from the page itself.
 */
export const GET = withAdminApi(
  async ({ searchParams, actor, ip }) => {
    const format = parseExportFormat(searchParams.get("format"));
    const scope = parseExportScope(searchParams.get("scope"));

    if (scope === "movements") {
      const window = hasDateWindow(searchParams, { from: "from", to: "to", preset: "range" })
        ? resolveDateRangeParams(searchParams)
        : null;
      return exportStockMovements({
        format,
        filters: { ...parseMovementFilters(searchParams, window), q: searchParams.get("q") ?? undefined },
        actor,
        ip,
      });
    }

    const query = parseListQuery(searchParams, {
      defaultSort: "available",
      defaultOrder: "asc",
      allowedSorts: INVENTORY_SORTS,
    });
    return exportInventoryLevels({
      format,
      q: query.q,
      sort: parseInventorySort(query.sort),
      order: query.order,
      filters: parseInventoryFilters(searchParams),
      actor,
      ip,
    });
  },
  { permission: "inventory.view", rateLimit: { limit: 10, windowMs: 60_000 } },
);
