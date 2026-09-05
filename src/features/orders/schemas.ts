import { z } from "zod";

import { orderStatusSchema } from "@/lib/enums";

/**
 * Every write path into an order goes through one of these schemas. The client
 * forms are convenience; these are the contract.
 */

/**
 * Cancellation reasons are a fixed list rather than free text so cancellations
 * can be counted by reason later without clustering strings. "Other" keeps the
 * detail field honest for anything the list does not cover.
 */
export const CANCEL_REASONS = [
  "Customer changed their mind",
  "Customer unreachable",
  "Address or pin code not serviceable",
  "Item out of stock",
  "Duplicate or test order",
  "Payment not received",
  "Other",
] as const;

export const changeOrderStatusSchema = z
  .object({
    orderId: z.string().min(1),
    toStatus: orderStatusSchema,
    reason: z.string().trim().max(120).optional(),
    detail: z.string().trim().max(500).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.toStatus === "CANCELLED" && !value.reason) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Choose why this order is being cancelled.",
      });
    }
  });

export type ChangeOrderStatusInput = z.input<typeof changeOrderStatusSchema>;

export const addOrderNoteSchema = z.object({
  orderId: z.string().min(1),
  message: z
    .string()
    .trim()
    .min(1, "Write the note before saving it.")
    .max(2000, "Keep notes under 2000 characters."),
});

export type AddOrderNoteInput = z.input<typeof addOrderNoteSchema>;

/**
 * REFUNDED and PARTIALLY_REFUNDED are deliberately not settable here - they are
 * derived from the refund ledger by recordRefund, so an operator cannot mark an
 * order refunded without saying how much.
 */
export const MANUAL_PAYMENT_STATUSES = ["PENDING", "PAID", "FAILED"] as const;

export const markPaymentStatusSchema = z.object({
  orderId: z.string().min(1),
  paymentStatus: z.enum(MANUAL_PAYMENT_STATUSES),
  note: z.string().trim().max(300).optional(),
});

export type MarkPaymentStatusInput = z.input<typeof markPaymentStatusSchema>;

/** Operators type rupees. The action converts to paise before it touches the DB. */
export const recordRefundSchema = z.object({
  orderId: z.string().min(1),
  amountRupees: z.coerce
    .number()
    .positive("Enter a refund amount greater than zero."),
  reason: z.string().trim().max(300).optional(),
});

export type RecordRefundInput = z.input<typeof recordRefundSchema>;

export const updateShippingAddressSchema = z.object({
  orderId: z.string().min(1),
  shipFullName: z.string().trim().min(2, "Enter the recipient's name."),
  shipEmail: z.email({ message: "Enter a valid email address." }),
  shipPhone: z.string().trim().min(6, "Enter a contact number."),
  shipAddress: z.string().trim().min(4, "Enter the street address."),
  shipCity: z.string().trim().min(2, "Enter the city."),
  shipState: z.string().trim().min(2, "Enter the state."),
  shipPinCode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Indian pin codes are six digits."),
});

export type UpdateShippingAddressInput = z.input<
  typeof updateShippingAddressSchema
>;
