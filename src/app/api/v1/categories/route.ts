import { db } from "@/lib/db";
import { productInclude, toPublicCategories } from "@/lib/serializers/public";
import { publicJson } from "../_lib/response";

/**
 * GET /api/v1/categories
 *
 * Replaces getCategories(). The storefront derives its category facets from the
 * product list and expects { gender, name, filter, image, count } - so this
 * endpoint derives them the same way rather than returning the Category tree.
 * Returning the tree instead would be tidier and would break CategorySection.jsx.
 */
export async function GET() {
  const products = await db.product.findMany({
    where: { status: "PUBLISHED", deletedAt: null },
    orderBy: { position: "asc" },
    include: productInclude,
  });

  return publicJson(toPublicCategories(products));
}
