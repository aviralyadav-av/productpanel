import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { getSellerCommissionInfo } from "@/features/sellers/detail-queries";
import { commissionOverrideSchema } from "@/features/sellers/schemas";
import { deleteCommissionOverride, upsertCommissionOverride } from "@/features/sellers/service";

/**
 * GET    /api/admin/sellers/:id/commission                       resolved rate + override + global   (commissions.view | sellers.view)
 * PUT    /api/admin/sellers/:id/commission { rateBps, fixedPaise?, note? }   upsert SELLER:<id>   (commissions.manage)
 * DELETE /api/admin/sellers/:id/commission                       remove the override               (commissions.manage)
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => apiOk(await getSellerCommissionInfo(params.id)),
  { permission: ["commissions.view", "sellers.view"] },
);

export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor }) => {
    const input = await parseJsonBody(req, commissionOverrideSchema);
    return apiOk(await upsertCommissionOverride(params.id, input, actor));
  },
  { permission: "commissions.manage" },
);

export const DELETE = withAdminApi<{ id: string }>(
  async ({ params, actor }) => apiOk(await deleteCommissionOverride(params.id, actor)),
  { permission: "commissions.manage" },
);
