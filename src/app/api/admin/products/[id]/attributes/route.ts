import { z } from "zod";

import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";

import { getProductDetail } from "@/features/products/queries";
import { attributeValuesSchema } from "@/features/products/schemas";
import { setProductAttributeValues } from "@/features/products/service";

/**
 * GET /api/admin/products/:id/attributes   { effectiveAttributes, values, orphanAttributes }   (products.view)
 * PUT /api/admin/products/:id/attributes   { values: [{ attributeId, valueIds? | textValue? | numberValue? | boolValue? }], replace?=true }   (products.edit, blueprint A8)
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const product = await getProductDetail(params.id);
    if (!product) throw notFound("Product");
    return apiOk({ effectiveAttributes: product.effectiveAttributes, values: product.attributeValues, orphanAttributes: product.orphanAttributes });
  },
  { permission: "products.view" },
);

const putSchema = z.object({ values: attributeValuesSchema, replace: z.boolean().default(true) });

export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const input = await parseJsonBody(req, putSchema);
    return apiOk(await setProductAttributeValues(params.id, input.values, actor, { replace: input.replace, ip }));
  },
  { permission: "products.edit" },
);
