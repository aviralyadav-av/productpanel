import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";
import { setThresholdForActor } from "@/features/inventory/mutations";
import { thresholdBodySchema, variantIdSchema } from "@/features/inventory/schemas";

/**
 * PUT /api/admin/inventory/:variantId/threshold   (inventory.adjust)
 * body { lowStockThreshold: number, allowBackorder?: boolean }
 *
 * No ledger row: a threshold is a reporting rule, not stock. The item's
 * stockState is re-derived so badges follow the new rule immediately.
 */
export const PUT = withAdminApi<{ variantId: string }>(
  async ({ req, params, actor }) => {
    const id = variantIdSchema.safeParse(params.variantId);
    if (!id.success) throw notFound("Variant");
    const body = await parseJsonBody(req, thresholdBodySchema);
    const outcome = await setThresholdForActor(actor, { variantId: id.data, ...body });
    return apiOk(outcome);
  },
  { permission: "inventory.adjust" },
);
