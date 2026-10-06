import { apiCreated, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";

import { addProductImages } from "@/features/products/images-service";
import { getProductDetail } from "@/features/products/queries";
import { addImagesSchema } from "@/features/products/schemas";

/**
 * GET  /api/admin/products/:id/images                             gallery rows in order   (products.view)
 * POST /api/admin/products/:id/images { mediaIds[], variantId? }  append media-library images   (products.edit)
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const product = await getProductDetail(params.id);
    if (!product) throw notFound("Product");
    return apiOk(product.images);
  },
  { permission: "products.view" },
);

export const POST = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const input = await parseJsonBody(req, addImagesSchema);
    return apiCreated(await addProductImages(params.id, input.mediaIds, actor, { variantId: input.variantId ?? null, ip }));
  },
  { permission: "products.edit" },
);
