import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { adjustStockForActor } from "@/features/inventory/mutations";
import { adjustStockSchema } from "@/features/inventory/schemas";

/**
 * POST /api/admin/inventory/adjust   (inventory.adjust)
 * body { variantId, mode: add|remove|set, quantity, type: PURCHASE|ADJUSTMENT|CORRECTION|DAMAGE|RETURN, reason?, note? }
 *
 * Writes one StockMovement and updates the projection in one transaction.
 * 409 when the result would go negative on a variant without backorders;
 * 422 for a bad body; `moved: false` when the change resolved to zero units.
 */
export const POST = withAdminApi(
  async ({ req, actor }) => {
    const body = await parseJsonBody(req, adjustStockSchema);
    const outcome = await adjustStockForActor(actor, body);
    return apiOk(outcome);
  },
  { permission: "inventory.adjust", rateLimit: { limit: 120, windowMs: 60_000 } },
);
