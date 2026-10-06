import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";

import { resolveCommissionForProduct } from "@/features/finance/queries";
import { resolveCommissionSchema } from "@/features/finance/ui-schemas";

/**
 * POST /api/admin/commissions/resolve { productId }   (commissions.view)
 *
 * Returns the resolved rate AND the whole PRODUCT → SELLER → category
 * ancestors → GLOBAL chain, including the rules that exist but lost and why -
 * "what rate does this product get" is never answerable from the rules list
 * alone.
 */
export const POST = withAdminApi(
  async ({ req }) => {
    const { productId } = await parseJsonBody(req, resolveCommissionSchema);
    const resolution = await resolveCommissionForProduct(productId);
    if (!resolution) throw notFound("Product");
    return apiOk(resolution);
  },
  { permission: "commissions.view" },
);
