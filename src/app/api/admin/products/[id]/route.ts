import { apiNoContent, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";

import { getProductDetail } from "@/features/products/queries";
import { productPatchSchema } from "@/features/products/schemas";
import { softDeleteProduct, updateProduct } from "@/features/products/service";

/**
 * GET    /api/admin/products/:id   full editor payload (variants, images, options, effective attributes, publish checklist)   (products.view)
 * PUT    /api/admin/products/:id   any subset of the product form; returns { product, categoryChange }                        (products.edit)
 * DELETE /api/admin/products/:id?reason=   soft delete (blueprint 11.34)                                                       (products.delete)
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const product = await getProductDetail(params.id);
    if (!product) throw notFound("Product");
    return apiOk(product);
  },
  { permission: "products.view" },
);

export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const patch = await parseJsonBody(req, productPatchSchema);
    return apiOk(await updateProduct(params.id, patch, actor, { ip }));
  },
  { permission: "products.edit" },
);

export const DELETE = withAdminApi<{ id: string }>(
  async ({ searchParams, params, actor, ip }) => {
    await softDeleteProduct(params.id, actor, { ip, reason: searchParams.get("reason") });
    return apiNoContent();
  },
  { permission: "products.delete" },
);
