import { apiNoContent, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";

import { getRate } from "@/features/shipping/queries";
import { rateInputSchema } from "@/features/shipping/schemas";
import { deleteRate, updateRate } from "@/features/shipping/service";

/**
 * GET    /api/admin/shipping/rates/:id             (shipping.view)   { data: RateRow }
 * PUT    /api/admin/shipping/rates/:id  RateInput  (shipping.manage) { data: ShippingRate }
 * DELETE /api/admin/shipping/rates/:id             (shipping.manage) 204
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const rate = await getRate(params.id);
    if (!rate) throw notFound("Shipping rate");
    return apiOk(rate);
  },
  { permission: "shipping.view" },
);

export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const data = await parseJsonBody(req, rateInputSchema);
    return apiOk(await updateRate(params.id, data, actor, { ip, userAgent: req.headers.get("user-agent") }));
  },
  { permission: "shipping.manage" },
);

export const DELETE = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    await deleteRate(params.id, actor, { ip, userAgent: req.headers.get("user-agent") });
    return apiNoContent();
  },
  { permission: "shipping.manage" },
);
