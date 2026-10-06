import { apiCreated, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";

import { getProductDetail } from "@/features/products/queries";
import { createVariantSchema } from "@/features/products/schemas";
import { createVariant } from "@/features/products/variants-service";

/**
 * GET  /api/admin/products/:id/variants   live variants with inventory and per-variant images   (products.view)
 * POST /api/admin/products/:id/variants   manual variant { name, sku?, ..., attributeValues?, openingStock? }   (products.edit)
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const product = await getProductDetail(params.id);
    if (!product) throw notFound("Product");
    return apiOk(product.variants);
  },
  { permission: "products.view" },
);

export const POST = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const input = await parseJsonBody(req, createVariantSchema);
    return apiCreated(await createVariant(params.id, input, actor, { ip }));
  },
  { permission: "products.edit" },
);
