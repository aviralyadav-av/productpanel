import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { pincodeBulkSchema } from "@/features/shipping/schemas";
import { bulkUpdatePincodes } from "@/features/shipping/service";

/**
 * POST /api/admin/shipping/pincodes/bulk   (shipping.manage)
 * { pincodes: string[] (≤500), action: serviceable_on|serviceable_off|cod_on|cod_off|assign_zone, zoneId? }
 * → { data: { action, requested, updated } }   (§11.33: one transaction, audited with the count)
 */
export const POST = withAdminApi(
  async ({ req, actor, ip }) => {
    const input = await parseJsonBody(req, pincodeBulkSchema);
    return apiOk(await bulkUpdatePincodes(input, actor, { ip, userAgent: req.headers.get("user-agent") }));
  },
  { permission: "shipping.manage" },
);
