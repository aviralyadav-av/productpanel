import { parseListQuery, withAdminApi } from "@/lib/api/admin";
import { listInventory } from "@/features/inventory/queries";
import { INVENTORY_SORTS, parseInventoryFilters, parseInventorySort } from "@/features/inventory/schemas";

/**
 * GET /api/admin/inventory?page&pageSize&q&sort&order&stock&category&seller&ids   (inventory.view)
 *
 * `{ data: InventoryRow[], meta, counts: { all, IN_STOCK, LOW_STOCK, OUT_OF_STOCK, BACKORDER, untracked } }`
 * Sorts: product | sku | onHand | available | reserved | updated. `category`
 * includes its descendants; `ids` may repeat to fetch a known set.
 */
export const GET = withAdminApi(
  async ({ searchParams }) => {
    const query = parseListQuery(searchParams, {
      defaultSort: "available",
      defaultOrder: "asc",
      allowedSorts: INVENTORY_SORTS,
    });
    const result = await listInventory(
      { ...query, sort: parseInventorySort(query.sort) },
      parseInventoryFilters(searchParams),
    );
    return Response.json(
      { data: result.rows, meta: result.meta, counts: result.counts },
      { headers: { "Cache-Control": "no-store" } },
    );
  },
  { permission: "inventory.view" },
);
