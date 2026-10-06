/**
 * Client-safe view models for the REFUNDS screens (`queries.ts` is
 * `server-only`, so the table and the dialogs import their row shapes here).
 */

export type RefundListRow = {
  id: string;
  refundNumber: string;
  status: string;
  method: string;
  provider: string | null;
  amountPaise: number;
  reason: string | null;
  createdAt: Date;
  completedAt: Date | null;
  orderId: string;
  orderNumber: string;
  customerId: string | null;
  customerName: string;
  customerEmail: string;
  returnRequestId: string | null;
  rmaNumber: string | null;
  initiatedBy: string | null;
  approvedBy: string | null;
};

export type RefundDetail = RefundListRow & {
  providerRefundId: string | null;
  failureReason: string | null;
  notes: string | null;
  processedAt: Date | null;
  updatedAt: Date;
  orderPaymentId: string | null;
  order: {
    id: string;
    orderNumber: string;
    status: string;
    paymentMethod: string;
    paymentStatus: string;
    totalPaise: number;
    refundedPaise: number;
    placedAt: Date;
  };
  sourcePayment: {
    id: string;
    provider: string;
    method: string;
    amountPaise: number;
    providerPaymentId: string | null;
    status: string;
    createdAt: Date;
  } | null;
  /** The REFUND echo row written when this refund completed (B6). */
  settlementPayments: Array<{
    id: string;
    provider: string;
    method: string;
    amountPaise: number;
    providerPaymentId: string | null;
    status: string;
    createdAt: Date;
  }>;
  returnRequest: { id: string; rmaNumber: string; status: string; reason: string; quantity: number; itemTitle: string } | null;
  /** What may still be refunded on the order, this refund excluded. */
  refundableRemainingPaise: number;
};

export type RefundActivityRow = {
  id: string;
  action: string;
  summary: string;
  actorEmail: string;
  createdAt: Date;
};

export type RefundOrderOption = {
  id: string;
  orderNumber: string;
  customerName: string;
  totalPaise: number;
  paidPaise: number;
  refundableRemainingPaise: number;
  paymentMethod: string;
  hasGatewayPayment: boolean;
};
