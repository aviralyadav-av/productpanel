import { apiCreated, apiList, parseJsonBody, parseListQuery, withAdminApi } from "@/lib/api/admin";

import { PRODUCT_SORTS, parseProductFilters } from "@/features/products/filters";
import { listProducts } from "@/features/products/queries";
import { productFormSchema } from "@/features/products/schemas";
import { createProduct } from "@/features/products/service";

/**
 * GET  /api/admin/products?q&status&category&includeDescendants&seller&stock&minPrice&maxPrice&from&to&flags&attr[code]&sort&order&page&pageSize   (products.view)
 * POST /api/admin/products  body = product form                                                                                                   (products.create)
 *
 * The GET vocabulary is the same the admin list page reads from its URL
 * (src/features/products/filters.ts), so a filtered admin view can be
 * replayed against the API verbatim.
 */
export const GET = withAdminApi(
  async ({ searchParams }) => {
    const query = parseListQuery(searchParams, { defaultSort: "updatedAt", defaultOrder: "desc", allowedSorts: PRODUCT_SORTS });
    const result = await listProducts(query, parseProductFilters(query.raw));
    return apiList(result.rows, result.meta);
  },
  { permission: "products.view" },
);

export const POST = withAdminApi(
  async ({ req, actor, ip }) => {
    const input = await parseJsonBody(req, productFormSchema);
    return apiCreated(await createProduct(input, actor, { ip }));
  },
  { permission: "products.create" },
);
