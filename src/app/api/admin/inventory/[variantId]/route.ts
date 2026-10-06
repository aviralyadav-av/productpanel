import { apiOk, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";
import { getVariantInventory } from "@/features/inventory/queries";
import { variantIdSchema } from "@/features/inventory/schemas";

/**
 * GET /api/admin/inventory/:variantId   (inventory.view)
 *
 * The stock row for one variant plus `series` (on-hand balance after each of
 * the last 60 movements, oldest first) and `movementCount`.
 */
export const GET = withAdminApi<{ variantId: string }>(
  async ({ params }) => {
    const id = variantIdSchema.safeParse(params.variantId);
    if (!id.success) throw notFound("Variant");
    const detail = await getVariantInventory(id.data);
    if (!detail) throw notFound("Variant");
    return apiOk(detail);
  },
  { permission: "inventory.view" },
);
