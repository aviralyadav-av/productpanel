import type { BadgeTone, CommissionScope, LedgerEntryStatus, LedgerEntryType, SellerStatus } from "@/lib/enums";
import type { PageMeta } from "@/lib/list-params";

/**
 * Plain, serialisable shapes the seller screens render. Client components
 * import these; nothing here touches Prisma so the types can travel into
 * client bundles. Dates are ISO strings for the same reason.
 */

export type SellerListRow = {
  id: string;
  slug: string;
  displayName: string;
  legalName: string | null;
  ownerName: string;
  email: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  logoUrl: string | null;
  status: SellerStatus;
  gstinMasked: string | null;
  registeredAt: string;
  documents: { verified: number; total: number; pending: number };
  productCount: number;
  publishedProductCount: number;
  orderCount: number;
  orderItemCount: number;
  grossSalesPaise: number;
  ratingAvg: number;
  reviewCount: number;
  commission: { rateBps: number; fixedPaise: number; scope: CommissionScope };
  payout: {
    availablePaise: number;
    pendingPaise: number;
    scheduledPaise: number;
    openPayout: { id: string; number: string; status: string; netPaise: number } | null;
  };
};

export type SellerListResult = {
  rows: SellerListRow[];
  meta: PageMeta;
};

export type SellerStatusCounts = Record<SellerStatus, number> & { all: number };

export type SellerKpis = {
  active: number;
  pendingApprovals: number;
  suspended: number;
  grossSalesPaise: number;
  /** AVAILABLE + SCHEDULED across every seller: money the platform owes right now. */
  payablePaise: number;
  /** Still inside the payout hold. */
  onHoldPaise: number;
};

export type SellerFilterOptions = {
  states: string[];
  cities: string[];
};

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export type SellerDetail = {
  id: string;
  slug: string;
  displayName: string;
  legalName: string | null;
  ownerName: string;
  email: string;
  phone: string | null;
  status: SellerStatus;
  description: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pinCode: string | null;
  country: string;
  gstin: string | null;
  pan: string | null;
  logo: { id: string; url: string; thumbnailUrl: string | null; alt: string | null; filename: string } | null;
  banner: { id: string; url: string; thumbnailUrl: string | null; alt: string | null; filename: string } | null;
  ratingAvg: number;
  reviewCount: number;
  productCount: number;
  publishedProductCount: number;
  orderItemCount: number;
  grossSalesPaise: number;
  approvedAt: string | null;
  approvedBy: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  lastActiveAt: string | null;
  hasPassword: boolean;
  createdAt: string;
  updatedAt: string;
  publicUrl: string;
  activation: { verifiedDocuments: number; hasPrimaryBank: boolean; ready: boolean };
  balance: { pendingPaise: number; availablePaise: number; scheduledPaise: number; paidPaise: number };
  openPayout: { id: string; number: string; status: string; netPaise: number } | null;
};

export type SellerOverview = {
  recentItems: Array<{
    id: string;
    orderId: string;
    orderNumber: string;
    placedAt: string;
    title: string;
    variant: string | null;
    quantity: number;
    lineTotalPaise: number;
    status: string;
    orderStatus: string;
  }>;
  recentEvents: SellerEventRow[];
  reviews: { approved: number; pending: number };
  returns: number;
};

export type SellerEventRow = {
  id: string;
  fromStatus: string | null;
  toStatus: string | null;
  message: string;
  actor: string | null;
  createdAt: string;
};

export type SellerDocumentRow = {
  id: string;
  type: string;
  label: string | null;
  status: string;
  note: string | null;
  mediaId: string | null;
  fileUrl: string | null;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
};

export type SellerBankAccountRow = {
  id: string;
  accountHolder: string;
  bankName: string;
  accountNumberLast4: string;
  ifsc: string;
  upiId: string | null;
  isPrimary: boolean;
  isVerified: boolean;
  payoutCount: number;
  createdAt: string;
  updatedAt: string;
};

export type SellerCommissionInfo = {
  resolved: { rateBps: number; fixedPaise: number; ruleId: string | null; scope: CommissionScope };
  override: { id: string; rateBps: number; fixedPaise: number; note: string | null; isActive: boolean; updatedAt: string } | null;
  global: { rateBps: number; fixedPaise: number } | null;
};

export type SellerProductRow = {
  id: string;
  title: string;
  slug: string;
  status: string;
  pricePaise: number;
  effectivePricePaise: number;
  imageUrl: string | null;
  categoryName: string | null;
  orderCount: number;
  ratingAvg: number;
  reviewCount: number;
  variantCount: number;
  updatedAt: string;
};

export type SellerOrderGroup = {
  orderId: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  placedAt: string;
  items: Array<{
    id: string;
    title: string;
    variant: string | null;
    quantity: number;
    lineTotalPaise: number;
    sellerGrossPaise: number;
    commissionPaise: number;
    sellerPayablePaise: number;
    status: string;
  }>;
  totals: { grossPaise: number; commissionPaise: number; payablePaise: number };
};

export type SellerLedgerRow = {
  id: string;
  type: LedgerEntryType;
  status: LedgerEntryStatus;
  amountPaise: number;
  description: string;
  orderNumber: string | null;
  orderId: string | null;
  payoutNumber: string | null;
  payoutId: string | null;
  availableAt: string | null;
  createdAt: string;
};

export type SellerPayoutRow = {
  id: string;
  payoutNumber: string;
  status: string;
  periodFrom: string;
  periodTo: string;
  netPaise: number;
  grossSalesPaise: number;
  commissionPaise: number;
  createdAt: string;
  paidAt: string | null;
};

export type SellerReviewRow = {
  id: string;
  productId: string | null;
  productTitle: string | null;
  authorName: string;
  rating: number | null;
  title: string | null;
  body: string;
  status: string;
  createdAt: string;
};

export type SellerPerformance = {
  weekly: Array<{ date: string; grossPaise: number; items: number }>;
  topProducts: Array<{ label: string; value: number }>;
  kpis: {
    ratingAvg: number;
    reviewCount: number;
    returnRatePct: number;
    cancellationRatePct: number;
    avgFulfilmentDays: number | null;
    itemsInWindow: number;
  };
};

export type SellerActivityRow = {
  id: string;
  kind: "event" | "audit";
  title: string;
  description: string | null;
  actor: string | null;
  tone: BadgeTone;
  at: string;
};
