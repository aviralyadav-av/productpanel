import { apiCreated, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { listRates } from "@/features/shipping/queries";
import { rateInputSchema, shippingIdSchema } from "@/features/shipping/schemas";
import { createRate } from "@/features/shipping/service";

/**
 * GET  /api/admin/shipping/rates?zone=<id>   (shipping.view)   { data: RateRow[] }
 * POST /api/admin/shipping/rates  RateInput  (shipping.manage) 201 { data: ShippingRate }
 */
export const GET = withAdminApi(
  async ({ searchParams }) => {
    const zone = searchParams.get("zone");
    const zoneId = zone && shippingIdSchema.safeParse(zone).success ? zone : undefined;
    return apiOk(await listRates({ zoneId }));
  },
  { permission: "shipping.view" },
);

export const POST = withAdminApi(
  async ({ req, actor, ip }) => {
    const data = await parseJsonBody(req, rateInputSchema);
    return apiCreated(await createRate(data, actor, { ip, userAgent: req.headers.get("user-agent") }));
  },
  { permission: "shipping.manage" },
);
