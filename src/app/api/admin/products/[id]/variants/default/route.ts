import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { setDefaultVariantSchema, variantImagesSchema } from "@/features/products/schemas";
import { setDefaultVariant, setVariantImages } from "@/features/products/variants-service";
import { z } from "zod";

/**
 * PUT /api/admin/products/:id/variants/default { variantId }                 make a variant the default   (products.edit)
 * PUT /api/admin/products/:id/variants/default { variantId, mediaIds[] }     replace that variant's own images   (products.edit)
 */
const bodySchema = setDefaultVariantSchema.extend({ mediaIds: variantImagesSchema.shape.mediaIds.optional(), images: z.boolean().optional() });

export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const input = await parseJsonBody(req, bodySchema);
    if (input.mediaIds) return apiOk(await setVariantImages(params.id, input.variantId, input.mediaIds, actor, { ip }));
    return apiOk(await setDefaultVariant(params.id, input.variantId, actor, { ip }));
  },
  { permission: "products.edit" },
);
