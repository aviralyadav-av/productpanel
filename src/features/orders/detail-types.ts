import type { CustomizationSnapshotEntry } from "@/features/products/customization";

/**
 * View models for the order detail screen.
 *
 * They live apart from `detail-queries.ts` because that file is `server-only`
 * and the client components on the detail page need these shapes. Keeping the
 * types here means a client component never imports a server module, even for
 * a type - which is the accident that turns into "server-only cannot be
 * imported from a Client Component" at build time.
 */

export type OrderCustomizationEntry = CustomizationSnapshotEntry;

export type OrderAddressView = {
  type: string;
  fullName: string;
  phone: string;
  email: string | null;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  pinCode: string;
  country: string;
};

export type OrderDetailItem = {
  id: string;
  productId: string | null;
  productSlug: string | null;
  variantId: string | null;
  sellerId: string | null;
  sellerSlug: string | null;
  sellerName: string | null;
  titleSnapshot: string;
  variantSnapshot: string | null;
  skuSnapshot: string | null;
  hsnCodeSnapshot: string | null;
  imageUrl: string | null;
  attributesSnapshot: Array<{ code: string; name: string; value: string; label: string }>;
  customization: OrderCustomizationEntry[];
  listPricePaise: number;
  unitPricePaise: number;
  customizationPaise: number;
  quantity: number;
  discountPaise: number;
  sellerFundedDiscountPaise: number;
  platformFundedDiscountPaise: number;
  taxRateBps: number;
  taxPaise: number;
  lineTotalPaise: number;
  commissionBps: number;
  commissionPaise: number;
  chargesPaise: number;
  sellerPayablePaise: number;
  status: string;
  reservedQty: number;
  returnedQty: number;
  refundedPaise: number;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  /** Units not yet on a live shipment - what "Create shipment" offers. */
  unshippedQty: number;
};

export type OrderDetailShipment = {
  id: string;
  shipmentNumber: string;
  status: string;
  partnerId: string | null;
  carrierName: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  weightGrams: number | null;
  costPaise: number;
  estimatedDeliveryAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  items: Array<{ orderItemId: string; quantity: number; title: string; variant: string | null }>;
  events: Array<{ id: string; status: string; location: string | null; message: string | null; occurredAt: Date }>;
};

export type OrderDetailPayment = {
  id: string;
  provider: string;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  method: string;
  type: string;
  status: string;
  amountPaise: number;
  failureCode: string | null;
  failureMessage: string | null;
  capturedAt: Date | null;
  createdAt: Date;
};

export type OrderDetailEvent = {
  id: string;
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  message: string;
  isInternal: boolean;
  createdAt: Date;
  actor: { name: string | null; email: string } | null;
};

export type OrderPermissions = {
  update: boolean;
  cancel: boolean;
  notes: boolean;
  ship: boolean;
  payments: boolean;
  refunds: boolean;
  returns: boolean;
};

export type PartnerOption = { id: string; name: string; code: string; trackingUrlTemplate: string | null };
