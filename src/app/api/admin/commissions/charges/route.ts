import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { invalidateSettingsCache } from "@/lib/settings";

import { CHARGES_SETTING_KEY, saveMarketplaceCharges } from "@/features/finance/commission-service";
import { getMarketplaceCharges } from "@/features/finance/queries";
import { chargesSchema } from "@/features/finance/ui-schemas";

/**
 * GET /api/admin/commissions/charges                      (commissions.view)
 * PUT /api/admin/commissions/charges { charges: [...] }    (commissions.manage)
 *
 * The whole array is replaced in one write: a half-applied charge list would
 * price orders with a rule set nobody chose.
 */
export const GET = withAdminApi(
  async () => apiOk({ charges: await getMarketplaceCharges() }),
  { permission: "commissions.view" },
);

export const PUT = withAdminApi(
  async ({ req, actor, ip }) => {
    const input = await parseJsonBody(req, chargesSchema);
    const charges = await saveMarketplaceCharges(input.charges, actor, { ip });
    // Pricing reads this setting uncached inside the order transaction; the
    // admin settings screens read it through the 60s cache.
    invalidateSettingsCache([CHARGES_SETTING_KEY]);
    return apiOk({ charges });
  },
  { permission: "commissions.manage" },
);
