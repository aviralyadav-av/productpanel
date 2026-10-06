/** Client-safe view models for the PAYMENTS screens (`queries.ts` is server-only). */

export type PaymentListRow = {
  id: string;
  provider: string;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  method: string;
  type: string;
  status: string;
  amountPaise: number;
  currency: string;
  createdAt: Date;
  capturedAt: Date | null;
  orderId: string;
  orderNumber: string;
  customerId: string | null;
  customerName: string;
  customerEmail: string;
  refundId: string | null;
  refundNumber: string | null;
};

export type PaymentWebhookRow = {
  id: string;
  provider: string;
  providerEventId: string;
  receivedAt: Date;
  processedAt: Date | null;
  error: string | null;
};

export type PaymentDetail = PaymentListRow & {
  failureCode: string | null;
  failureMessage: string | null;
  updatedAt: Date;
  /** Only sent to the client for actors with payments.manage (D4/D11). */
  rawPayload: unknown | null;
  order: {
    id: string;
    orderNumber: string;
    status: string;
    paymentStatus: string;
    paymentMethod: string;
    totalPaise: number;
    refundedPaise: number;
    placedAt: Date;
  };
  /** REFUND rows written when a refund on this order completed (B6). */
  relatedRefundPayments: Array<{
    id: string;
    provider: string;
    method: string;
    amountPaise: number;
    status: string;
    providerPaymentId: string | null;
    createdAt: Date;
    refundNumber: string | null;
    refundId: string | null;
  }>;
  refunds: Array<{ id: string; refundNumber: string; amountPaise: number; status: string; method: string; createdAt: Date }>;
  webhookEvents: PaymentWebhookRow[];
};

export type PaymentKpis = {
  collectedTodayPaise: number;
  collectedMonthPaise: number;
  pending: number;
  failed: number;
  refundedMonthPaise: number;
};
