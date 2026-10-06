import { apiNoContent, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { zoneInputSchema } from "@/features/shipping/schemas";
import { deleteZone, updateZone } from "@/features/shipping/service";

/**
 * PUT    /api/admin/shipping/zones/:id  ZoneInput   (shipping.manage) { data: ShippingZone }; 409 when un-defaulting the default
 * DELETE /api/admin/shipping/zones/:id              (shipping.manage) 204; 409 when default or rates remain
 */
export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const data = await parseJsonBody(req, zoneInputSchema);
    return apiOk(await updateZone(params.id, data, actor, { ip, userAgent: req.headers.get("user-agent") }));
  },
  { permission: "shipping.manage" },
);

export const DELETE = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    await deleteZone(params.id, actor, { ip, userAgent: req.headers.get("user-agent") });
    return apiNoContent();
  },
  { permission: "shipping.manage" },
);
