import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { applyAttributeImport, previewAttributeImport } from "@/features/products/attribute-csv";
import { attributeImportSchema } from "@/features/products/schemas";

/**
 * POST /api/admin/products/attributes/import { categoryId, csv, createValues?, apply? }   (products.bulk, blueprint A7)
 * apply=false (default) validates and returns the report; apply=true writes when the report has no errors.
 */
export const POST = withAdminApi(
  async ({ req, actor, ip }) => {
    const input = await parseJsonBody(req, attributeImportSchema);
    return apiOk(input.apply ? await applyAttributeImport(input, actor, { ip }) : await previewAttributeImport(input));
  },
  { permission: "products.bulk" },
);
