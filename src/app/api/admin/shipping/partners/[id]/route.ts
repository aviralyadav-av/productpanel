import { apiNoContent, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { partnerInputSchema } from "@/features/shipping/schemas";
import { deletePartner, updatePartner } from "@/features/shipping/service";

/**
 * PUT    /api/admin/shipping/partners/:id  PartnerInput  (shipping.manage) { data: ShippingPartner }
 * DELETE /api/admin/shipping/partners/:id                (shipping.manage) 204; 409 while shipments reference it
 */
export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const data = await parseJsonBody(req, partnerInputSchema);
    return apiOk(await updatePartner(params.id, data, actor, { ip, userAgent: req.headers.get("user-agent") }));
  },
  { permission: "shipping.manage" },
);

export const DELETE = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    await deletePartner(params.id, actor, { ip, userAgent: req.headers.get("user-agent") });
    return apiNoContent();
  },
  { permission: "shipping.manage" },
);
