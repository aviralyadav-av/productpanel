import { apiCreated, withAdminApi } from "@/lib/api/admin";

import { duplicateProduct } from "@/features/products/service";

/** POST /api/admin/products/:id/duplicate → 201 { id, slug } of the new draft   (products.create) */
export const POST = withAdminApi<{ id: string }>(
  async ({ params, actor, ip }) => apiCreated(await duplicateProduct(params.id, actor, { ip })),
  { permission: "products.create" },
);
