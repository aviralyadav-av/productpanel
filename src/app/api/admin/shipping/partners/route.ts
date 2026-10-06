import { apiCreated, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { listPartners } from "@/features/shipping/queries";
import { partnerInputSchema } from "@/features/shipping/schemas";
import { createPartner } from "@/features/shipping/service";

/**
 * GET  /api/admin/shipping/partners                 (shipping.view)   { data: PartnerRow[] }
 * POST /api/admin/shipping/partners  PartnerInput   (shipping.manage) 201 { data: ShippingPartner }; 409 on a duplicate code
 */
export const GET = withAdminApi(async () => apiOk(await listPartners()), { permission: "shipping.view" });

export const POST = withAdminApi(
  async ({ req, actor, ip }) => {
    const data = await parseJsonBody(req, partnerInputSchema);
    return apiCreated(await createPartner(data, actor, { ip, userAgent: req.headers.get("user-agent") }));
  },
  { permission: "shipping.manage" },
);
