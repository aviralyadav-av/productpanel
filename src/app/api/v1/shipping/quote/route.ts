import { z } from "zod";

import { badRequest, validationError, zodDetails } from "@/lib/api/errors";
import { handleOptions, privateJson, withPublicApi } from "@/lib/api/public";
import { rupees, toIso } from "@/lib/serializers/public";
import { pincodeSchema } from "@/lib/validation";

import { quoteItemSchema } from "@/features/shipping/schemas";
import { priceQuoteItems, quoteShipping } from "@/features/shipping/service";

/**
 * POST /api/v1/shipping/quote   (blueprint §5.3, D9: 60/min/IP)
 *
 * Body `{ pinCode, items:[{ productId, variantId?, quantity }], paymentMethod?: 'COD'|'ONLINE' }`
 * → `{ data: { serviceable, rates:[{ id, name, method, price, isFree, codAvailable, codFee,
 *              estimatedDays:{ min, max }, estimatedDelivery }], defaultRateId } }`
 *
 * Money is rupees here (public API rule). Items are re-priced from the
 * catalogue - the website never tells the server what things cost - and the
 * free-above threshold is judged on that subtotal; coupons are applied at
 * checkout by the ORDERS module, which calls the same `quoteShipping`.
 */
const bodySchema = z.object({
  pinCode: pincodeSchema,
  state: z.string().trim().max(120).optional(),
  items: z.array(quoteItemSchema).min(1).max(100),
  paymentMethod: z.enum(["COD", "ONLINE"]).default("ONLINE"),
});

export const POST = withPublicApi(
  async ({ req }) => {
    const raw = await req.json().catch(() => null);
    if (raw === null) throw badRequest("Send a JSON body.");
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) throw validationError(zodDetails(parsed.error));

    const priced = await priceQuoteItems(parsed.data.items);
    if (priced.items.length === 0) throw validationError({ items: "Unknown products." }, "None of those items exist.");

    const quote = await quoteShipping({
      pinCode: parsed.data.pinCode,
      state: parsed.data.state,
      items: priced.items,
      discountedSubtotalPaise: priced.subtotalPaise,
      paymentMethod: parsed.data.paymentMethod,
    });

    return privateJson(
      {
        serviceable: quote.serviceable,
        rates: quote.rates.map((rate) => ({
          id: rate.rateId,
          name: rate.name,
          method: rate.method,
          price: rupees(rate.ratePaise),
          isFree: rate.isFree,
          codAvailable: rate.codAvailable,
          codFee: rupees(rate.codFeePaise),
          estimatedDays: { min: rate.estimatedDaysMin, max: rate.estimatedDaysMax },
          estimatedDelivery: toIso(rate.estimatedDeliveryAt),
        })),
        defaultRateId: quote.defaultRateId,
      },
      { req },
    );
  },
  { rateLimit: { limit: 60, windowMs: 60_000 } },
);

export const OPTIONS = handleOptions;
