import { apiCreated, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { createCustomizationOption, listCustomizationOptions } from "@/features/products/customization-service";
import { customizationOptionSchema } from "@/features/products/schemas";

/**
 * GET  /api/admin/products/:id/customizations   options in position order   (products.view)
 * POST /api/admin/products/:id/customizations   new option (customizationOptionSchema)   (products.edit)
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => apiOk(await listCustomizationOptions(params.id)),
  { permission: "products.view" },
);

export const POST = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const input = await parseJsonBody(req, customizationOptionSchema);
    return apiCreated(await createCustomizationOption(params.id, input, actor, { ip }));
  },
  { permission: "products.edit" },
);
