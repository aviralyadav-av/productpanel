import { db } from "@/lib/db";
import { productInclude, toPublicProduct } from "@/lib/serializers/public";
import { publicJson } from "../../../_lib/response";

/**
 * GET /api/v1/products/:id/suggestions
 *
 * Replaces getSuggestedProducts(), which today returns "the first six products
 * that are not this one". This version prefers the same subcategory and falls
 * back to filling from the wider catalogue, which is a strictly better
 * suggestion set for the same response shape.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const LIMIT = 6;

  const current = await db.product.findUnique({
    where: { id },
    select: { categoryId: true },
  });

  const sameCategory = current?.categoryId
    ? await db.product.findMany({
        where: {
          id: { not: id },
          categoryId: current.categoryId,
          status: "PUBLISHED",
          deletedAt: null,
        },
        orderBy: { orderCount: "desc" },
        take: LIMIT,
        include: productInclude,
      })
    : [];

  const remaining = LIMIT - sameCategory.length;

  const filler =
    remaining > 0
      ? await db.product.findMany({
          where: {
            id: { notIn: [id, ...sameCategory.map((product) => product.id)] },
            status: "PUBLISHED",
            deletedAt: null,
          },
          orderBy: { orderCount: "desc" },
          take: remaining,
          include: productInclude,
        })
      : [];

  return publicJson([...sameCategory, ...filler].map(toPublicProduct));
}
