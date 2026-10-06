import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { badRequest } from "@/lib/api/errors";

import { quoteRequestSchema } from "@/features/shipping/schemas";
import { priceQuoteItems, quoteShipping } from "@/features/shipping/service";

/**
 * POST /api/admin/shipping/quote   (shipping.view) - admin preview of what checkout would offer.
 * { pinCode, state?, items:[{ productId?, variantId?, quantity }], paymentMethod?, discountedSubtotalPaise? }
 * → { data: ShippingQuote & { subtotalPaise, missing } }   (all money in paise on the admin API)
 */
export const POST = withAdminApi(
  async ({ req }) => {
    const input = await parseJsonBody(req, quoteRequestSchema);
    const priced = await priceQuoteItems(input.items);
    if (priced.items.length === 0) throw badRequest("None of those items exist in the catalogue.", { items: "Unknown products." });
    const quote = await quoteShipping({
      pinCode: input.pinCode,
      state: input.state,
      items: priced.items,
      discountedSubtotalPaise: input.discountedSubtotalPaise ?? priced.subtotalPaise,
      paymentMethod: input.paymentMethod,
    });
    return apiOk({ ...quote, subtotalPaise: priced.subtotalPaise, missing: priced.missing });
  },
  { permission: "shipping.view" },
);
