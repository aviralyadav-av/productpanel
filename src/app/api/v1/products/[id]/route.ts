import { db } from "@/lib/db";
import { productInclude, toPublicProduct } from "@/lib/serializers/public";
import { notFoundJson, publicJson } from "../../_lib/response";

/**
 * GET /api/v1/products/:id
 *
 * Replaces getProductById(). The storefront passes the legacy id
 * ("handbag-001"), and product ids were preserved verbatim at import for
 * exactly this reason. Slugs are accepted too, since ProductDetails could
 * reasonably move to them later.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const product = await db.product.findFirst({
    where: {
      OR: [{ id }, { slug: id }],
      status: "PUBLISHED",
      deletedAt: null,
    },
    include: productInclude,
  });

  if (!product) return notFoundJson("Product");

  return publicJson(toPublicProduct(product));
}
