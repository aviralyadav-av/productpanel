import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { variantAxesSchema } from "@/features/products/schemas";
import { generateProductVariants } from "@/features/products/variants-service";

/** POST /api/admin/products/:id/variants/generate { axes: [{ attributeId, valueIds[] }] } → { created, kept, deactivated, variantIds }   (products.edit, blueprint A5) */
export const POST = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const input = await parseJsonBody(req, variantAxesSchema);
    return apiOk(await generateProductVariants(params.id, input, actor, { ip }));
  },
  { permission: "products.edit" },
);
