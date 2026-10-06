/**
 * Client-safe view models for the RETURNS screens.
 *
 * Separated from `queries.ts` because that file is `server-only`: a Client
 * Component that needs the shape of a row must be able to import the type
 * without dragging Prisma into the browser bundle.
 */

export type ReturnListRow = {
  id: string;
  rmaNumber: string;
  status: string;
  reason: string;
  requestedResolution: string | null;
  resolution: string | null;
  quantity: number;
  requestedAt: Date;
  updatedAt: Date;
  orderId: string;
  orderNumber: string;
  customerId: string | null;
  customerName: string;
  customerEmail: string;
  sellerId: string | null;
  sellerName: string;
  itemTitle: string;
  itemVariant: string | null;
  itemImageUrl: string | null;
  handledBy: string | null;
  refundId: string | null;
  refundNumber: string | null;
  refundStatus: string | null;
  refundAmountPaise: number | null;
};

export type ReturnCustomizationEntry = { label: string; value: string; priceDeltaPaise: number };

export type ReturnDetailItem = {
  id: string;
  productId: string | null;
  title: string;
  variant: string | null;
  sku: string | null;
  imageUrl: string | null;
  quantity: number;
  returnedQty: number;
  refundedPaise: number;
  lineTotalPaise: number;
  unitPricePaise: number;
  status: string;
  deliveredAt: Date | null;
  customization: ReturnCustomizationEntry[];
};

export type ReturnDetailRefund = {
  id: string;
  refundNumber: string;
  amountPaise: number;
  status: string;
  method: string;
  provider: string | null;
  createdAt: Date;
  completedAt: Date | null;
};

export type ReturnDetailEvent = {
  id: string;
  message: string;
  fromStatus: string | null;
  toStatus: string | null;
  isInternal: boolean;
  createdAt: Date;
  actor: string | null;
};

export type ReturnDetail = {
  id: string;
  rmaNumber: string;
  status: string;
  reason: string;
  reasonDetail: string | null;
  requestedResolution: string | null;
  resolution: string | null;
  qcDisposition: string | null;
  qcNote: string | null;
  rejectionReason: string | null;
  quantity: number;
  imageUrls: string[];
  pickupPartnerId: string | null;
  pickupPartnerName: string | null;
  pickupScheduledAt: Date | null;
  pickupTrackingNumber: string | null;
  receivedAt: Date | null;
  requestedAt: Date;
  resolvedAt: Date | null;
  updatedAt: Date;
  handledBy: string | null;
  order: {
    id: string;
    orderNumber: string;
    status: string;
    paymentMethod: string;
    paymentStatus: string;
    totalPaise: number;
    shippingPaise: number;
    placedAt: Date;
  };
  customer: { id: string | null; name: string; email: string; phone: string | null };
  item: ReturnDetailItem;
  seller: { id: string; name: string; email: string | null } | null;
  refund: ReturnDetailRefund | null;
  replacementShipment: {
    id: string;
    shipmentNumber: string;
    status: string;
    trackingNumber: string | null;
    carrierName: string | null;
  } | null;
  events: ReturnDetailEvent[];
};

/** What the detail page is allowed to offer, resolved from permissions. */
export type ReturnPermissions = {
  canManage: boolean;
  canProcessRefunds: boolean;
  canViewRefunds: boolean;
};

export type PickupPartnerOption = { id: string; name: string; code: string };
