import "server-only";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { buildPageMeta, type ListParams, type PageMeta } from "@/lib/list-params";
import { startOfIstDay, endOfIstDay } from "@/lib/dates";
import { resolveDateRangeParams } from "@/components/shared/date-range";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/enums";

import { isOnSale } from "@/lib/money";
import { readSettingNumber } from "@/features/finance/settings-reader";
import { CUSTOMIZATION_OPTION_SELECT } from "@/features/products/customization-service";
import { parseChoices } from "@/features/products/customization";
import { isChoiceType, isFileType } from "@/features/products/schemas";

import type { ManualProductInfo } from "./manual-types";
import type { OrderListFilters, OrderSort } from "./schemas";

/**
 * Read side for the ORDERS module (Server Components + REST GET handlers).
 *
 * Everything the list screen shows comes back in one page-sized query: the
 * order rows, up to four item thumbnails, the seller names and the most
 * recently updated live shipment (the §14.C8 "shipping status" column). The
 * alternative - a query per row - is what turns a 25-row order list into 100
 * round trips, and an operations team lives on this screen all day.
 */

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/** Only applied when the URL actually carries a range: no implicit window. */
export function resolveOrderRange(filters: OrderListFilters, now = new Date()): { from: Date; to: Date } | null {
  if (!filters.range && !filters.from && !filters.to) return null;
  const params = new URLSearchParams();
  if (filters.range) params.set("range", filters.range);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  const resolved = resolveDateRangeParams(params, "30d", now);
  return { from: resolved.from, to: resolved.to };
}

export function buildOrderWhere(
  filters: OrderListFilters,
  q: string,
  options: { includeStatus?: boolean } = {},
): Prisma.OrderWhereInput {
  const includeStatus = options.includeStatus ?? true;
  const where: Prisma.OrderWhereInput = {};
  const and: Prisma.OrderWhereInput[] = [];

  if (includeStatus && filters.status) where.status = filters.status;
  if (filters.payment) where.paymentStatus = filters.payment;
  if (filters.method) where.paymentMethod = filters.method;
  if (filters.source) where.source = filters.source;
  if (filters.customerId) where.customerId = filters.customerId;
  if (filters.sellerId) and.push({ items: { some: { sellerId: filters.sellerId } } });
  if (filters.hasReturns) and.push({ returnRequests: { some: {} } });
  if (filters.hasCustomization) and.push({ items: { some: { NOT: { customization: { equals: Prisma.DbNull } } } } });

  const range = resolveOrderRange(filters);
  if (range) where.placedAt = { gte: range.from, lte: range.to };

  // Operators type rupees into the amount filter; the column is paise.
  if (filters.minTotal !== undefined || filters.maxTotal !== undefined) {
    where.totalPaise = {
      ...(filters.minTotal !== undefined ? { gte: Math.round(filters.minTotal * 100) } : {}),
      ...(filters.maxTotal !== undefined ? { lte: Math.round(filters.maxTotal * 100) } : {}),
    };
  }

  const term = q.trim();
  if (term) {
    and.push({
      OR: [
        { orderNumber: { contains: term, mode: "insensitive" } },
        { guestEmail: { contains: term, mode: "insensitive" } },
        { customer: { is: { fullName: { contains: term, mode: "insensitive" } } } },
        { customer: { is: { email: { contains: term, mode: "insensitive" } } } },
        { customer: { is: { phone: { contains: term, mode: "insensitive" } } } },
        { addresses: { some: { phone: { contains: term, mode: "insensitive" } } } },
        { addresses: { some: { fullName: { contains: term, mode: "insensitive" } } } },
        { shipments: { some: { trackingNumber: { contains: term, mode: "insensitive" } } } },
        { items: { some: { titleSnapshot: { contains: term, mode: "insensitive" } } } },
      ],
    });
  }

  if (and.length) where.AND = and;
  return where;
}

const SORT_COLUMN: Record<OrderSort, (order: "asc" | "desc") => Prisma.OrderOrderByWithRelationInput> = {
  number: (order) => ({ orderNumber: order }),
  placed: (order) => ({ placedAt: order }),
  customer: (order) => ({ customer: { fullName: order } }),
  total: (order) => ({ totalPaise: order }),
  status: (order) => ({ status: order }),
  payment: (order) => ({ paymentStatus: order }),
  updated: (order) => ({ updatedAt: order }),
};

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export type OrderListRow = {
  id: string;
  orderNumber: string;
  placedAt: Date;
  updatedAt: Date;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  source: string;
  fulfillmentStatus: string;
  returnStatus: string;
  totalPaise: number;
  refundedPaise: number;
  customerId: string | null;
  customerName: string;
  customerEmail: string;
  isGuest: boolean;
  itemCount: number;
  itemThumbs: Array<{ url: string | null; title: string }>;
  sellerNames: string[];
  /** C8: status of the most recently updated non-cancelled shipment. */
  shippingStatus: string | null;
  trackingNumber: string | null;
  returnCount: number;
  hasCustomization: boolean;
};

const LIST_SELECT = {
  id: true,
  orderNumber: true,
  placedAt: true,
  updatedAt: true,
  status: true,
  paymentStatus: true,
  paymentMethod: true,
  source: true,
  fulfillmentStatus: true,
  returnStatus: true,
  totalPaise: true,
  refundedPaise: true,
  customerId: true,
  guestEmail: true,
  customer: { select: { id: true, fullName: true, email: true } },
  addresses: { where: { type: "SHIPPING" }, select: { fullName: true, email: true }, take: 1 },
  items: {
    where: { status: { not: "CANCELLED" } },
    select: { id: true, titleSnapshot: true, imageUrl: true, quantity: true, sellerNameSnapshot: true, sellerId: true, customization: true },
  },
  shipments: {
    where: { status: { not: "CANCELLED" } },
    orderBy: { updatedAt: "desc" },
    take: 1,
    select: { status: true, trackingNumber: true },
  },
  _count: { select: { returnRequests: true } },
} satisfies Prisma.OrderSelect;

function toListRow(row: Prisma.OrderGetPayload<{ select: typeof LIST_SELECT }>): OrderListRow {
  const shipping = row.addresses[0];
  const sellerNames = [...new Set(row.items.map((item) => item.sellerNameSnapshot ?? (item.sellerId ? "Seller" : "Platform")))];
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    placedAt: row.placedAt,
    updatedAt: row.updatedAt,
    status: row.status,
    paymentStatus: row.paymentStatus,
    paymentMethod: row.paymentMethod,
    source: row.source,
    fulfillmentStatus: row.fulfillmentStatus,
    returnStatus: row.returnStatus,
    totalPaise: row.totalPaise,
    refundedPaise: row.refundedPaise,
    customerId: row.customerId,
    customerName: row.customer?.fullName ?? shipping?.fullName ?? "Guest",
    customerEmail: row.customer?.email ?? row.guestEmail ?? shipping?.email ?? "",
    isGuest: row.customerId === null,
    itemCount: row.items.reduce((sum, item) => sum + item.quantity, 0),
    itemThumbs: row.items.slice(0, 4).map((item) => ({ url: item.imageUrl, title: item.titleSnapshot })),
    sellerNames,
    shippingStatus: row.shipments[0]?.status ?? null,
    trackingNumber: row.shipments[0]?.trackingNumber ?? null,
    returnCount: row._count.returnRequests,
    hasCustomization: row.items.some((item) => item.customization !== null),
  };
}

export async function listOrders(
  params: ListParams & { sort: OrderSort },
  filters: OrderListFilters,
): Promise<{ rows: OrderListRow[]; meta: PageMeta; total: number }> {
  const where = buildOrderWhere(filters, params.q);
  const [total, rows] = await Promise.all([
    db.order.count({ where }),
    db.order.findMany({
      where,
      select: LIST_SELECT,
      orderBy: [SORT_COLUMN[params.sort](params.order), { placedAt: "desc" }],
      skip: params.skip,
      take: params.pageSize,
    }),
  ]);
  return { rows: rows.map(toListRow), meta: buildPageMeta(total, params), total };
}

export type OrderStatusCounts = Record<OrderStatus, number> & { all: number };

/** Counts for the status FilterTabs, honouring every other active filter. */
export async function orderStatusCounts(filters: OrderListFilters, q: string): Promise<OrderStatusCounts> {
  const where = buildOrderWhere(filters, q, { includeStatus: false });
  const grouped = await db.order.groupBy({ by: ["status"], where, _count: { _all: true } });
  const counts = Object.fromEntries(ORDER_STATUSES.map((status) => [status, 0])) as OrderStatusCounts;
  counts.all = 0;
  for (const row of grouped) {
    counts[row.status as OrderStatus] = row._count._all;
    counts.all += row._count._all;
  }
  return counts;
}

export type OrderKpis = {
  todayOrders: number;
  todayRevenuePaise: number;
  pending: number;
  processing: number;
  shipped: number;
  awaitingPayment: number;
};

/**
 * The strip above the list. "Revenue today" excludes cancelled and failed
 * orders and nets off refunds (E4), so it agrees with the reports module
 * instead of quietly telling a different story on the same numbers.
 */
export async function orderKpis(now = new Date()): Promise<OrderKpis> {
  const from = startOfIstDay(now);
  const to = endOfIstDay(now);

  const [today, pending, processing, shipped, awaitingPayment] = await Promise.all([
    db.order.aggregate({
      where: { placedAt: { gte: from, lte: to }, status: { notIn: ["CANCELLED", "FAILED"] } },
      _count: { _all: true },
      _sum: { totalPaise: true, refundedPaise: true },
    }),
    db.order.count({ where: { status: "PENDING" } }),
    db.order.count({ where: { status: { in: ["CONFIRMED", "PROCESSING", "PACKED"] } } }),
    db.order.count({ where: { status: { in: ["SHIPPED", "OUT_FOR_DELIVERY"] } } }),
    db.order.count({ where: { paymentStatus: { in: ["PENDING", "AUTHORIZED"] }, status: { notIn: ["CANCELLED", "FAILED"] } } }),
  ]);

  return {
    todayOrders: today._count._all,
    todayRevenuePaise: (today._sum.totalPaise ?? 0) - (today._sum.refundedPaise ?? 0),
    pending,
    processing,
    shipped,
    awaitingPayment,
  };
}

// ---------------------------------------------------------------------------
// Reference data the screens need
// ---------------------------------------------------------------------------

export type PartnerOption = { id: string; name: string; code: string; trackingUrlTemplate: string | null };

export async function listShipmentPartners(): Promise<PartnerOption[]> {
  return db.shippingPartner.findMany({
    where: { isActive: true },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: { id: true, name: true, code: true, trackingUrlTemplate: true },
  });
}

/** Hydrates an EntityPicker chip from an id already in the URL. */
export async function getCustomerRef(id: string | undefined): Promise<{ id: string; title: string; subtitle?: string } | null> {
  if (!id) return null;
  const row = await db.customer.findUnique({ where: { id }, select: { id: true, fullName: true, email: true } });
  return row ? { id: row.id, title: row.fullName ?? row.email, subtitle: row.email } : null;
}

export async function getSellerRef(id: string | undefined): Promise<{ id: string; title: string; subtitle?: string } | null> {
  if (!id) return null;
  const row = await db.seller.findUnique({ where: { id }, select: { id: true, displayName: true, city: true } });
  return row ? { id: row.id, title: row.displayName, subtitle: row.city ?? undefined } : null;
}

// ---------------------------------------------------------------------------
// Export paging (§11.28: never findMany without take)
// ---------------------------------------------------------------------------

export type OrderExportRow = {
  orderNumber: string;
  placedAt: Date;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  source: string;
  customerName: string;
  customerEmail: string;
  phone: string;
  city: string;
  state: string;
  pinCode: string;
  items: number;
  sellers: string;
  subtotalPaise: number;
  discountPaise: number;
  couponDiscountPaise: number;
  couponCode: string;
  shippingPaise: number;
  codFeePaise: number;
  taxPaise: number;
  totalPaise: number;
  refundedPaise: number;
  shippingStatus: string;
  trackingNumber: string;
};

export async function pageOrdersForExport(
  filters: OrderListFilters,
  q: string,
  skip: number,
  take: number,
): Promise<OrderExportRow[]> {
  const rows = await db.order.findMany({
    where: buildOrderWhere(filters, q),
    orderBy: { placedAt: "desc" },
    skip,
    take,
    select: {
      orderNumber: true,
      placedAt: true,
      status: true,
      paymentStatus: true,
      paymentMethod: true,
      source: true,
      guestEmail: true,
      subtotalPaise: true,
      discountPaise: true,
      couponDiscountPaise: true,
      couponCode: true,
      shippingPaise: true,
      codFeePaise: true,
      taxPaise: true,
      totalPaise: true,
      refundedPaise: true,
      customer: { select: { fullName: true, email: true, phone: true } },
      addresses: { where: { type: "SHIPPING" }, take: 1, select: { fullName: true, phone: true, city: true, state: true, pinCode: true, email: true } },
      items: { where: { status: { not: "CANCELLED" } }, select: { quantity: true, sellerNameSnapshot: true } },
      shipments: { where: { status: { not: "CANCELLED" } }, orderBy: { updatedAt: "desc" }, take: 1, select: { status: true, trackingNumber: true } },
    },
  });

  return rows.map((row) => {
    const address = row.addresses[0];
    return {
      orderNumber: row.orderNumber,
      placedAt: row.placedAt,
      status: row.status,
      paymentStatus: row.paymentStatus,
      paymentMethod: row.paymentMethod,
      source: row.source,
      customerName: row.customer?.fullName ?? address?.fullName ?? "Guest",
      customerEmail: row.customer?.email ?? row.guestEmail ?? address?.email ?? "",
      phone: row.customer?.phone ?? address?.phone ?? "",
      city: address?.city ?? "",
      state: address?.state ?? "",
      pinCode: address?.pinCode ?? "",
      items: row.items.reduce((sum, item) => sum + item.quantity, 0),
      sellers: [...new Set(row.items.map((item) => item.sellerNameSnapshot ?? "Platform"))].join(" | "),
      subtotalPaise: row.subtotalPaise,
      discountPaise: row.discountPaise,
      couponDiscountPaise: row.couponDiscountPaise,
      couponCode: row.couponCode ?? "",
      shippingPaise: row.shippingPaise,
      codFeePaise: row.codFeePaise,
      taxPaise: row.taxPaise,
      totalPaise: row.totalPaise,
      refundedPaise: row.refundedPaise,
      shippingStatus: row.shipments[0]?.status ?? "",
      trackingNumber: row.shipments[0]?.trackingNumber ?? "",
    };
  });
}

// ---------------------------------------------------------------------------
// Manual order form: one product, priced and validated the way checkout will
// ---------------------------------------------------------------------------

/**
 * Everything the manual order form needs after an operator picks a product:
 * the purchasable variants with live availability, and the customisation
 * options in the same shape the validator uses. The form re-prices through
 * `previewOrderDraftAction`, so these figures are guidance, not the source of
 * truth - but showing the operator "3 left" before they type 5 saves a round
 * trip and a confusing error.
 */
export async function getManualOrderProduct(productId: string): Promise<ManualProductInfo | null> {
  const [product, defaultTaxBps] = await Promise.all([
    db.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        title: true,
        status: true,
        deletedAt: true,
        pricePaise: true,
        salePricePaise: true,
        saleStartsAt: true,
        saleEndsAt: true,
        taxRateBps: true,
        minOrderQty: true,
        maxOrderQty: true,
        sellerId: true,
        seller: { select: { displayName: true, status: true, deletedAt: true } },
        images: { where: { variantId: null }, orderBy: [{ isPrimary: "desc" }, { position: "asc" }], take: 1, select: { media: { select: { url: true, thumbnailUrl: true } } } },
        variants: {
          where: { deletedAt: null, isActive: true },
          orderBy: [{ isDefault: "desc" }, { position: "asc" }],
          select: {
            id: true,
            name: true,
            sku: true,
            pricePaise: true,
            salePricePaise: true,
            isDefault: true,
            inventory: { select: { available: true, allowBackorder: true } },
            attributeValues: { select: { attribute: { select: { name: true } }, value: { select: { label: true } } } },
          },
        },
        customizationOptions: { where: { isActive: true }, orderBy: { position: "asc" }, select: CUSTOMIZATION_OPTION_SELECT },
      },
    }),
    readSettingNumber(undefined, "tax.default_bps"),
  ]);
  if (!product) return null;

  const now = new Date();
  const sellerBlocked = Boolean(product.sellerId && (!product.seller || product.seller.status !== "ACTIVE" || product.seller.deletedAt));
  const problem =
    product.deletedAt || product.status !== "PUBLISHED"
      ? "This product is not published."
      : sellerBlocked
        ? "This product's seller is not active."
        : product.variants.length === 0
          ? "This product has no active variant."
          : null;

  const image = product.images[0]?.media ?? null;

  return {
    id: product.id,
    title: product.title,
    imageUrl: image?.thumbnailUrl ?? image?.url ?? null,
    sellerId: product.sellerId,
    sellerName: product.seller?.displayName ?? null,
    minOrderQty: Math.max(1, product.minOrderQty),
    maxOrderQty: product.maxOrderQty,
    taxRateBps: product.taxRateBps ?? defaultTaxBps,
    problem,
    variants: product.variants.map((variant) => {
      const listPricePaise = variant.pricePaise ?? product.pricePaise;
      const salePaise = variant.salePricePaise ?? (variant.pricePaise === null ? product.salePricePaise : null);
      const onSale = isOnSale({ pricePaise: listPricePaise, salePricePaise: salePaise, saleStartsAt: product.saleStartsAt, saleEndsAt: product.saleEndsAt, now });
      const options = variant.attributeValues.map((row) => `${row.attribute.name}: ${row.value.label}`).join(" · ");
      return {
        id: variant.id,
        name: variant.name,
        sku: variant.sku,
        pricePaise: onSale && salePaise !== null ? salePaise : listPricePaise,
        listPricePaise,
        available: variant.inventory?.available ?? 0,
        allowBackorder: variant.inventory?.allowBackorder ?? false,
        isDefault: variant.isDefault,
        optionsLabel: options.length > 0 ? options : null,
      };
    }),
    customizationOptions: product.customizationOptions.map((option) => ({
      id: option.id,
      type: option.type,
      label: option.label,
      helpText: option.helpText,
      placeholder: option.placeholder,
      isRequired: option.isRequired,
      minLength: option.minLength,
      maxLength: option.maxLength,
      maxFiles: option.maxFiles,
      priceDeltaPaise: option.priceDeltaPaise,
      choices: parseChoices(option.choices).map((choice) => ({ value: choice.value, label: choice.label ?? choice.value, priceDeltaPaise: choice.priceDeltaPaise ?? 0 })),
      kind: isFileType(option.type) ? "file" : isChoiceType(option.type) ? "choice" : option.type === "CHECKBOX" ? "boolean" : "text",
      multiple: option.type === "MULTI_SELECT" || (isFileType(option.type) && (option.maxFiles ?? 1) > 1),
    })),
  };
}
