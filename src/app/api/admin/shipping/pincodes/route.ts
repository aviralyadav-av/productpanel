import { apiCreated, apiList, apiOk, parseJsonBody, parseListQuery, withAdminApi } from "@/lib/api/admin";

import { listPincodes } from "@/features/shipping/queries";
import { PINCODE_SORTS, parsePincodeListFilters, pincodeInputSchema } from "@/features/shipping/schemas";
import { upsertPincode } from "@/features/shipping/service";

/**
 * GET  /api/admin/shipping/pincodes?page&pageSize&sort&order&q&zone&serviceable&cod   (shipping.view)
 *      `{ data: PincodeRow[], meta }`. `zone=none` = unassigned; `serviceable`/`cod` = yes|no.
 * POST /api/admin/shipping/pincodes  PincodeInput   (shipping.manage) 201 { data: { row, created } }
 *      Creates the row or fully replaces an existing one for that pincode.
 */
export const GET = withAdminApi(
  async ({ searchParams }) => {
    const query = parseListQuery(searchParams, { defaultSort: "pincode", defaultOrder: "asc", allowedSorts: PINCODE_SORTS, pageSize: 50 });
    const result = await listPincodes(query, parsePincodeListFilters(searchParams));
    return apiList(result.rows, result.meta);
  },
  { permission: "shipping.view" },
);

export const POST = withAdminApi(
  async ({ req, actor, ip }) => {
    const data = await parseJsonBody(req, pincodeInputSchema);
    const result = await upsertPincode(data, actor, { ip, userAgent: req.headers.get("user-agent") });
    return result.created ? apiCreated(result) : apiOk(result);
  },
  { permission: "shipping.manage" },
);
