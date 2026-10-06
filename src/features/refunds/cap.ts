import { SELLER_FAULT_RETURN_REASONS, type ReturnReason } from "@/lib/enums";

/**
 * The refund cap (blueprint §14.B6, B5) as pure arithmetic.
 *
 * Kept free of Prisma and Next so it can be unit-tested (`cap.test.ts`) and
 * reused by the returns service, the refunds service and the "create refund"
 * dialog - the last one matters, because an operator should be told the
 * ceiling before they type an amount rather than after the server refuses it.
 *
 * Every figure is integer paise. Nothing here rounds in the customer's
 * favour by accident: the per-unit share is floored, so a three-unit line
 * refunded one unit at a time can never sum to more than the line total.
 */

/**
 * Reasons that also entitle the customer to the shipping they paid (B6).
 * The seller-fault set plus LATE_DELIVERY: the delivery itself is what
 * failed, so charging for it would be indefensible.
 */
export const SHIPPING_REFUNDABLE_REASONS: readonly ReturnReason[] = [
  ...SELLER_FAULT_RETURN_REASONS,
  "LATE_DELIVERY",
];

/** Reasons where the customer may be asked to carry the pickup fee (B5). */
export const CUSTOMER_FAULT_RETURN_REASONS: readonly ReturnReason[] = ["CHANGED_MIND", "SIZE_ISSUE"];

export function isSellerFaultReason(reason: string): boolean {
  return (SELLER_FAULT_RETURN_REASONS as readonly string[]).includes(reason);
}

export function isShippingRefundableReason(reason: string): boolean {
  return (SHIPPING_REFUNDABLE_REASONS as readonly string[]).includes(reason);
}

export function isCustomerFaultReason(reason: string): boolean {
  return (CUSTOMER_FAULT_RETURN_REASONS as readonly string[]).includes(reason);
}

export type ReturnCapInput = {
  /** OrderItem.lineTotalPaise - the tax-inclusive value of the whole line. */
  lineTotalPaise: number;
  /** OrderItem.quantity. */
  itemQuantity: number;
  /** Units this RMA covers. */
  returnQuantity: number;
  /** OrderItem.refundedPaise already settled against this line. */
  itemRefundedPaise: number;
  /** Order.shippingPaise - added only when the rule below allows it. */
  shippingPaise: number;
  /** True when every ACTIVE line on the order is fully returned. */
  allLinesReturned: boolean;
  reason: string;
  /** settings `returns.pickup_fee_paise`. */
  pickupFeePaise: number;
  /** settings `returns.customer_pays_pickup`. */
  customerPaysPickup: boolean;
  /** Refundable headroom left on the ORDER: paid − Σ counted refunds. */
  orderRemainingPaise: number;
};

export type ReturnCapBreakdown = {
  /** Value of the returned units, floored per unit. */
  itemSharePaise: number;
  /** Already refunded against this line, subtracted from the share. */
  alreadyRefundedPaise: number;
  /** Shipping added back, or 0. */
  shippingPaise: number;
  /** Pickup fee the customer carries, subtracted, or 0 (B5). */
  pickupFeePaise: number;
  /** The cap before the order-level headroom is applied. */
  rmaCapPaise: number;
  /** paid − Σ counted refunds on the order. */
  orderRemainingPaise: number;
  /** What a refund on this RMA may actually be: min of the two, never < 0. */
  capPaise: number;
  /** Human sentences the detail screen shows under the amount field. */
  notes: string[];
};

/** Value of `units` of a line, floored so partials can never over-refund. */
export function unitShare(lineTotalPaise: number, itemQuantity: number, units: number): number {
  if (itemQuantity <= 0 || units <= 0) return 0;
  if (units >= itemQuantity) return lineTotalPaise;
  return Math.floor((lineTotalPaise * units) / itemQuantity);
}

export function returnRefundCap(input: ReturnCapInput): ReturnCapBreakdown {
  const itemSharePaise = unitShare(input.lineTotalPaise, input.itemQuantity, input.returnQuantity);
  const alreadyRefundedPaise = Math.max(0, input.itemRefundedPaise);

  const shippingAllowed = input.allLinesReturned || isShippingRefundableReason(input.reason);
  const shippingPaise = shippingAllowed ? Math.max(0, input.shippingPaise) : 0;

  const pickupFeePaise =
    input.customerPaysPickup && isCustomerFaultReason(input.reason) ? Math.max(0, input.pickupFeePaise) : 0;

  const rmaCapPaise = Math.max(0, itemSharePaise - alreadyRefundedPaise + shippingPaise - pickupFeePaise);
  const orderRemainingPaise = Math.max(0, input.orderRemainingPaise);
  const capPaise = Math.max(0, Math.min(rmaCapPaise, orderRemainingPaise));

  const notes: string[] = [];
  if (shippingAllowed && shippingPaise > 0) {
    notes.push(
      input.allLinesReturned
        ? "Shipping is refundable because every line on the order is being returned."
        : "Shipping is refundable for this return reason.",
    );
  }
  if (pickupFeePaise > 0) notes.push("The pickup fee is deducted: the customer carries it for this reason.");
  if (alreadyRefundedPaise > 0) notes.push("Refunds already settled against this line are deducted.");
  if (orderRemainingPaise < rmaCapPaise) notes.push("Capped by what is still refundable on the order as a whole.");
  notes.push("The COD fee is never refunded after dispatch.");

  return {
    itemSharePaise,
    alreadyRefundedPaise,
    shippingPaise,
    pickupFeePaise,
    rmaCapPaise,
    orderRemainingPaise,
    capPaise,
    notes,
  };
}
