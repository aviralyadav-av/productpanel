import { z } from "zod";

import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/errors";

import { setStatusSchema } from "@/features/products/schemas";
import { setProductStatus } from "@/features/products/service";

/**
 * PUT /api/admin/products/:id/status { status: DRAFT|PUBLISHED|ARCHIVED, reason? }   (products.publish)
 * Publishing a product that fails blueprint 11.5 returns 422 with one detail per problem code.
 */
const bodySchema = setStatusSchema.extend({ reason: z.string().trim().max(200).optional() });

export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const body = await parseJsonBody(req, bodySchema);
    const result = await setProductStatus(params.id, body.status, actor, { ip, reason: body.reason });
    if (!result.ok) {
      throw new ApiError(
        422,
        "VALIDATION_ERROR",
        "This product is not ready to publish.",
        Object.fromEntries(result.problems.map((problem) => [problem.code, problem.message])),
      );
    }
    return apiOk(result.product);
  },
  { permission: "products.publish" },
);
