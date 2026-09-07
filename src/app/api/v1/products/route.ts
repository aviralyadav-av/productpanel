import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import {
  productInclude,
  toPublicProduct,
} from "@/lib/serializers/public";
import { publicJson } from "../_lib/response";

/**
 * GET /api/v1/products
 *
 * Replaces getAllProducts() and every filtered helper in the storefront's
 * productApi.js. The query parameters mirror the axios calls already written
 * (and commented out) in that file, so the cutover is uncommenting them:
 *
 *   ?featured=true      getFeaturedProducts()
 *   ?bestSeller=true    getBestSellerProducts()   - orderCount desc, limit 8
 *   ?newArrival=true    getNewArrivalProducts()   - createdAt desc, limit 8
 *   ?search=            searchProducts()          - title/category/description
 *   ?subcategory=       getProductsByCategory()
 *   ?minPrice=&maxPrice=getProductsByPriceRange() - values in RUPEES
 *
 * Returns a bare ARRAY, not a paginated envelope, because the storefront does
 * `Array.isArray(data)` and maps straight over the result. The admin's own list
 * screens use the paginated shape; these two are deliberately different.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const where: Prisma.ProductWhereInput = {
    status: "PUBLISHED",
    deletedAt: null,
  };

  if (params.get("featured") === "true") where.isFeatured = true;
  if (params.get("gender")) where.gender = params.get("gender")!;

  const subcategory = params.get("subcategory");
  if (subcategory) where.category = { slug: subcategory };

  const search = params.get("search")?.trim();
  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
      { category: { slug: { contains: search, mode: "insensitive" } } },
      { category: { parent: { slug: { contains: search, mode: "insensitive" } } } },
    ];
  }

  // Price filters arrive in rupees, matching the storefront's slider.
  const minPrice = params.get("minPrice");
  const maxPrice = params.get("maxPrice");
  if (minPrice || maxPrice) {
    where.pricePaise = {
      ...(minPrice ? { gte: Math.round(Number(minPrice) * 100) } : {}),
      ...(maxPrice ? { lte: Math.round(Number(maxPrice) * 100) } : {}),
    };
  }

  let orderBy: Prisma.ProductOrderByWithRelationInput[] = [
    { position: "asc" },
    { createdAt: "desc" },
  ];
  let take: number | undefined;

  if (params.get("bestSeller") === "true") {
    orderBy = [{ orderCount: "desc" }];
    take = Number(params.get("limit") ?? 8);
  } else if (params.get("newArrival") === "true") {
    orderBy = [{ createdAt: "desc" }];
    take = Number(params.get("limit") ?? 8);
  } else if (params.get("limit")) {
    take = Number(params.get("limit"));
  }

  const products = await db.product.findMany({
    where,
    orderBy,
    take,
    include: productInclude,
  });

  return publicJson(products.map(toPublicProduct));
}
