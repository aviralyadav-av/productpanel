import { apiNoContent, apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { badRequest, notFound } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { pincodeSchema } from "@/lib/validation";

import { pincodeUpdateSchema } from "@/features/shipping/schemas";
import { checkPincode, deletePincode, updatePincode } from "@/features/shipping/service";

/**
 * GET    /api/admin/shipping/pincodes/:pin                    (shipping.view)   { data: { row, check } } - the stored row (or null) plus the live resolution
 * PUT    /api/admin/shipping/pincodes/:pin  Partial<Pincode>  (shipping.manage) { data: PincodeServiceability }
 * DELETE /api/admin/shipping/pincodes/:pin                    (shipping.manage) 204
 */
function pin(params: { pin: string }): string {
  const parsed = pincodeSchema.safeParse(params.pin);
  if (!parsed.success) throw badRequest("Pincodes are six digits.");
  return parsed.data;
}

export const GET = withAdminApi<{ pin: string }>(
  async ({ params }) => {
    const pincode = pin(params);
    const [row, check] = await Promise.all([
      db.pincodeServiceability.findUnique({ where: { pincode }, include: { zone: { select: { id: true, name: true } } } }),
      checkPincode(pincode),
    ]);
    if (!row && !check.zone) throw notFound("Pincode");
    return apiOk({ row, check });
  },
  { permission: "shipping.view" },
);

export const PUT = withAdminApi<{ pin: string }>(
  async ({ req, params, actor, ip }) => {
    const patch = await parseJsonBody(req, pincodeUpdateSchema);
    return apiOk(await updatePincode(pin(params), patch, actor, { ip, userAgent: req.headers.get("user-agent") }));
  },
  { permission: "shipping.manage" },
);

export const DELETE = withAdminApi<{ pin: string }>(
  async ({ req, params, actor, ip }) => {
    await deletePincode(pin(params), actor, { ip, userAgent: req.headers.get("user-agent") });
    return apiNoContent();
  },
  { permission: "shipping.manage" },
);
