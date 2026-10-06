import { z } from "zod";

import { badRequest } from "@/lib/api/errors";
import { handleOptions, privateJson, withPublicApi } from "@/lib/api/public";
import { paiseToRupees } from "@/lib/money";
import { emailSchema, pincodeSchema } from "@/lib/validation";

import { loadCartLines } from "@/features/coupons/cart-lines";
import { normalizeCouponCode, validateCouponForCart } from "@/features/coupons/service";

/**
 * POST /api/v1/coupons/validate (blueprint §5.3, §11.8, §14.D9, G4)
 *
 * body  { code, items: [{ productId, variantId?, quantity }], email?, pinCode? }
 * 200   { data: { valid: true, code, type, discount, freeShipping, message } }
 * 200   { data: { valid: false, message: "This coupon cannot be applied." } }
 *
 * Every rejection - unknown code, expired, wrong customer, cart out of scope -
 * returns the SAME body and status, so the endpoint cannot be used to
 * enumerate codes or probe another customer's eligibility. 30 requests per
 * minute per IP; the real decision is made again inside the order transaction.
 * `discount` is in rupees (A10: public money is rupees) and `pinCode` is
 * accepted for forward compatibility with shipping-aware quotes.
 */

const bodySchema = z.object({
  code: z.string().trim().min(1).max(64),
  items: z
    .array(
      z.object({
        productId: z.string().trim().min(1).max(64),
        variantId: z.string().trim().min(1).max(64).nullish(),
        quantity: z.coerce.number().int().min(1).max(999),
      }),
    )
    .min(1, "The cart is empty.")
    .max(100),
  email: emailSchema.nullish(),
  pinCode: pincodeSchema.nullish(),
});

const UNIFORM_FAILURE = { valid: false as const, message: "This coupon cannot be applied." };

export const POST = withPublicApi(
  async ({ req }) => {
    let json: unknown;
    try {
      json = await req.json();
    } catch {
      throw badRequest("Send a JSON body.");
    }
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) throw badRequest("Invalid request body.");
    const body = parsed.data;

    const cart = await loadCartLines(body.items);
    if (cart.lines.length === 0 || cart.missing.length > 0) {
      return privateJson(UNIFORM_FAILURE, { req });
    }

    const result = await validateCouponForCart({
      code: normalizeCouponCode(body.code),
      lines: cart.lines,
      customerEmail: body.email ?? null,
      subtotalPaise: cart.subtotalPaise,
    });

    if (!result.ok) return privateJson(UNIFORM_FAILURE, { req });

    const message = result.freeShipping
      ? "Free shipping applied."
      : `You save ₹${paiseToRupees(result.discountPaise).toLocaleString("en-IN", { maximumFractionDigits: 2 })}.`;

    return privateJson(
      {
        valid: true as const,
        code: result.coupon.code,
        type: result.coupon.type,
        discount: paiseToRupees(result.discountPaise),
        freeShipping: result.freeShipping,
        message,
      },
      { req },
    );
  },
  { rateLimit: { limit: 30, windowMs: 60_000 } },
);

export const OPTIONS = handleOptions;
