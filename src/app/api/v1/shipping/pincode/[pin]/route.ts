import { badRequest } from "@/lib/api/errors";
import { handleOptions, publicCachedJson, withPublicApi } from "@/lib/api/public";
import { rupees } from "@/lib/serializers/public";
import { pincodeSchema } from "@/lib/validation";

import { checkPincode } from "@/features/shipping/service";

/**
 * GET /api/v1/shipping/pincode/:pin   (blueprint §5.3)
 *
 * `{ data: { pincode, serviceable, codAvailable, estimatedDays, city, state, freeShippingAbove } }`
 * `freeShippingAbove` is in rupees (public API rule) or null when the store
 * has no threshold. Cached for five minutes: serviceability changes by the
 * import, not by the minute, and the pincode box on a product page is hit on
 * every keystroke.
 */
export const GET = withPublicApi<{ pin: string }>(async ({ params }) => {
  const parsed = pincodeSchema.safeParse(params.pin);
  if (!parsed.success) throw badRequest("Pincodes are six digits.", { pin: "Enter a 6-digit PIN code." });

  const check = await checkPincode(parsed.data);
  return publicCachedJson(
    {
      pincode: check.pincode,
      serviceable: check.serviceable,
      codAvailable: check.codAvailable,
      estimatedDays: check.estimatedDays,
      city: check.city,
      state: check.state,
      freeShippingAbove: rupees(check.freeAbovePaise),
    },
    { maxAge: 300, swr: 600 },
  );
});

export const OPTIONS = handleOptions;
