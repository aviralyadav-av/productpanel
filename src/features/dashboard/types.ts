import type { StatDelta } from "@/components/shared/stat-card";
import type { BadgeTone } from "@/lib/enums";

/**
 * Client-safe view models for /admin/dashboard.
 *
 * Everything the dashboard renders is shaped here, on the server, so the
 * client components stay dumb: they receive numbers that are already
 * permission-filtered (D14) and already formatted where a format decision
 * belongs to the data (paise vs count vs percent). Nothing in this file
 * imports Prisma or the metric layer, so client components can import the
 * types without dragging the database into the browser bundle.
 */

/** How a KPI's raw number should be read - and how the export writes it. */
export type KpiFormat = "money" | "number" | "percent";

/** Which half of the tile strip a KPI belongs to. */
export type KpiGroup = "range" | "now";

export type KpiTile = {
  key: string;
  label: string;
  group: KpiGroup;
  /** The raw figure: paise for money, a plain count otherwise. */
  raw: number;
  format: KpiFormat;
  /** Already formatted for display, so the export and the tile agree. */
  value: string;
  /** One line of context under the number when there is no delta. */
  hint?: string;
  /** Percentage change against the previous period; null when incomparable. */
  delta?: StatDelta;
  /** Deep link to the list this tile counts, e.g. /admin/orders?status=PENDING. */
  href?: string;
  /** The module permission that must be held for this tile to render (D14). */
  permission: string;
  /** False for tiles where "up" is bad news (cancellations, refunds). */
  higherIsBetter?: boolean;
};

/** One point of a dashboard chart; `key` is the IST bucket key (YYYY-MM-DD). */
export type SeriesPoint = { key: string; label: string } & Record<string, string | number>;

export type NamedValue = { key: string; label: string; value: number };

export type DashboardCharts = {
  /** Revenue vs net sales vs refunds, per bucket. */
  revenue: SeriesPoint[];
  /** Orders per bucket folded into five pipeline groups (see ORDER_GROUPS). */
  orders: SeriesPoint[];
  /** New customers per bucket, with the running total in `cumulative`. */
  customers: SeriesPoint[];
  /** Seller registrations and activations per bucket. */
  sellers: SeriesPoint[];
  /** Units sold per bucket. */
  units: SeriesPoint[];
  /** Sales by root category, top slice first, tail folded into "Other". */
  categories: NamedValue[];
  /** Revenue split by payment method. */
  payments: NamedValue[];
};

export type DashboardRangeInfo = {
  from: string;
  to: string;
  label: string;
  preset: string;
  days: number;
  bucket: "day" | "week" | "month";
  previousLabel: string;
};

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

export type TopProductRow = {
  productId: string | null;
  title: string;
  units: number;
  revenuePaise: number;
  sellerName: string | null;
};

export type TopSellerRow = {
  sellerId: string | null;
  name: string;
  orders: number;
  grossPaise: number;
  payablePaise: number;
};

export type RecentOrderRow = {
  id: string;
  orderNumber: string;
  customerName: string;
  placedAt: Date;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  totalPaise: number;
};

export type RecentCustomerRow = {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  orderCount: number;
  totalSpentPaise: number;
};

export type RecentSellerRow = {
  id: string;
  name: string;
  email: string;
  status: string;
  createdAt: Date;
  productCount: number;
};

export type RecentReviewRow = {
  id: string;
  authorName: string;
  productId: string | null;
  productTitle: string | null;
  rating: number | null;
  status: string;
  createdAt: Date;
};

export type ActivityRow = {
  id: string;
  actorEmail: string;
  action: string;
  summary: string;
  entityType: string;
  entityId: string | null;
  href: string | null;
  createdAt: Date;
};

export type DashboardAlert = {
  key: string;
  tone: BadgeTone;
  title: string;
  detail: string;
  count: number;
  href: string;
  actionLabel: string;
  permission: string;
};
