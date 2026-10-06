import { apiOk, withAdminApi } from "@/lib/api/admin";

import { listSellerActivity } from "@/features/sellers/detail-queries";

/** GET /api/admin/sellers/:id/events?limit=   SellerEvent timeline merged with audit rows, newest first   (sellers.view) */
export const GET = withAdminApi<{ id: string }>(
  async ({ params, searchParams }) => {
    const limit = Math.min(500, Math.max(1, Number(searchParams.get("limit")) || 100));
    return apiOk(await listSellerActivity(params.id, limit));
  },
  { permission: "sellers.view" },
);
