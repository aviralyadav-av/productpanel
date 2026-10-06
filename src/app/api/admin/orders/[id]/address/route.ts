import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { updateAddressSchema } from "@/features/orders/schemas";
import { updateOrderAddress } from "@/features/orders/service";

/**
 * PUT /api/admin/orders/:id/address  body = AddressInput & { type }   (orders.update)
 *
 * Shipping is frozen once the parcel leaves (the label was printed from this
 * row); billing stays correctable until the order closes, for the invoice.
 */
export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const { type, ...values } = await parseJsonBody(req, updateAddressSchema);
    const result = await updateOrderAddress({ orderId: params.id, type, values, actor, ip });
    return apiOk(result);
  },
  { permission: "orders.update" },
);
