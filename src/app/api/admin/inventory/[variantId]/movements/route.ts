import { apiList, parseListQuery, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";
import { resolveDateRangeParams } from "@/components/shared/date-range";
import { listStockMovements } from "@/features/inventory/queries";
import {
  MOVEMENT_SORTS,
  hasDateWindow,
  parseMovementFilters,
  variantIdSchema,
} from "@/features/inventory/schemas";

/**
 * GET /api/admin/inventory/:variantId/movements?page&pageSize&type&range|from&to   (inventory.view)
 *
 * The ledger for one variant, newest first. Without a date window it covers
 * all time; `range=30d` or `from=YYYY-MM-DD&to=` (IST days) narrows it.
 */
export const GET = withAdminApi<{ variantId: string }>(
  async ({ params, searchParams }) => {
    const id = variantIdSchema.safeParse(params.variantId);
    if (!id.success) throw notFound("Variant");

    const query = parseListQuery(searchParams, {
      defaultSort: "createdAt",
      defaultOrder: "desc",
      allowedSorts: MOVEMENT_SORTS,
    });
    const window = hasDateWindow(searchParams, { from: "from", to: "to", preset: "range" })
      ? resolveDateRangeParams(searchParams)
      : null;
    const filters = { ...parseMovementFilters(searchParams, window), variantId: id.data };
    const result = await listStockMovements(query, filters);
    return apiList(result.rows, result.meta);
  },
  { permission: "inventory.view" },
);
