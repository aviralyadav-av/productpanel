import { apiCreated, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { listZones } from "@/features/shipping/queries";
import { reorderSchema, zoneInputSchema } from "@/features/shipping/schemas";
import { createZone, reorderZones } from "@/features/shipping/service";

/**
 * GET  /api/admin/shipping/zones                      (shipping.view)   { data: ZoneRow[] }
 * POST /api/admin/shipping/zones  ZoneInput           (shipping.manage) 201 { data: ShippingZone }
 * POST /api/admin/shipping/zones  { ids: string[] }   (shipping.manage) reorder → { data: { moved } }
 *
 * Zones are few (a handful per store) so the list is not paginated.
 */
export const GET = withAdminApi(async () => apiOk(await listZones()), { permission: "shipping.view" });

export const POST = withAdminApi(
  async ({ req, actor, ip }) => {
    const client = { ip, userAgent: req.headers.get("user-agent") };
    const body = (await req.clone().json().catch(() => null)) as { ids?: unknown } | null;
    if (body && Array.isArray(body.ids)) {
      const { ids } = reorderSchema.parse(body);
      return apiOk(await reorderZones(ids, actor, client));
    }
    const data = await parseJsonBody(req, zoneInputSchema);
    return apiCreated(await createZone(data, actor, client));
  },
  { permission: "shipping.manage" },
);
