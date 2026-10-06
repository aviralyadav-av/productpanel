import { apiNoContent, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";

import { getSellerDetail } from "@/features/sellers/detail-queries";
import { sellerProfileSchema } from "@/features/sellers/schemas";
import { softDeleteSeller, updateSeller } from "@/features/sellers/service";

/**
 * GET    /api/admin/sellers/:id            header + balance + activation readiness   (sellers.view)
 * PUT    /api/admin/sellers/:id { ...profile }                                        (sellers.edit)
 * DELETE /api/admin/sellers/:id            soft delete; 409 while products/orders exist (sellers.delete)
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const seller = await getSellerDetail(params.id);
    if (!seller) throw notFound("Seller");
    return apiOk(seller);
  },
  { permission: "sellers.view" },
);

export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor }) => {
    const profile = await parseJsonBody(req, sellerProfileSchema);
    const seller = await updateSeller(params.id, profile, actor);
    return apiOk({ id: seller.id, slug: seller.slug, status: seller.status, updatedAt: seller.updatedAt });
  },
  { permission: "sellers.edit" },
);

export const DELETE = withAdminApi<{ id: string }>(
  async ({ params, actor, searchParams }) => {
    await softDeleteSeller(params.id, actor, searchParams.get("reason"));
    return apiNoContent();
  },
  { permission: "sellers.delete" },
);
