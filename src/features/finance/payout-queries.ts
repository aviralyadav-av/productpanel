import "server-only";

import type { Prisma } from "@prisma/client";
import type { Route } from "next";

import { db } from "@/lib/db";
import type { DateRange } from "@/lib/dates";
import { startOfIstDay, endOfIstDay } from "@/lib/dates";
import type { BadgeTone } from "@/lib/enums";
import {
  LEDGER_ENTRY_STATUS_META,
  LEDGER_ENTRY_TYPE_META,
  OPEN_PAYOUT_STATUSES,
  type LedgerEntryStatus,
  type LedgerEntryType,
  type PayoutMethod,
  type PayoutStatus,
} from "@/lib/enums";
import { buildPageMeta, type ListParams, type PageMeta } from "@/lib/list-params";

import { readSettingNumber } from "./settings-reader";
import type { BalanceSort, LedgerFilters, PayoutListFilters, PayoutSort } from "./ui-schemas";

/**
 * Read side for /admin/payouts (blueprint §14.B4-B5, D4).
 *
 * The KPI strip and the balances table read `SellerBalance` - the projection
 * maintained in the same transaction as every ledger write - rather than
 * aggregating the ledger on each page load. When the two disagree the ledger
 * is right and "Recompute balance" is the repair; that is exactly why the row
 * offers the button.
 */

const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;

/** First instant of the current IST calendar month. */
function startOfIstMonth(now: Date): Date {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - IST_OFFSET_MS);
}

export type PayoutKpis = {
  pendingPaise: number;
  availablePaise: number;
  scheduledPaise: number;
  paidThisMonthPaise: number;
  paidThisMonthCount: number;
  /** Sellers with money owed that is below the minimum payout (B5 "held"). */
  heldSellers: number;
  minPayoutPaise: number;
  openStatements: number;
};

export async function payoutKpis(now: Date = new Date()): Promise<PayoutKpis> {
  const monthStart = startOfIstMonth(now);

  const [totals, paidThisMonth, minPayoutPaise, openStatements, balances] = await Promise.all([
    db.sellerBalance.aggregate({
      _sum: { pendingPaise: true, availablePaise: true, scheduledPaise: true },
    }),
    db.sellerPayout.aggregate({
      where: { status: "PAID", paidAt: { gte: monthStart, lte: now } },
      _sum: { netPaise: true },
      _count: { _all: true },
    }),
    readSettingNumber(undefined, "marketplace.min_payout_paise"),
    db.sellerPayout.count({ where: { status: { in: [...OPEN_PAYOUT_STATUSES] } } }),
    db.sellerBalance.findMany({ select: { availablePaise: true } }),
  ]);

  return {
    pendingPaise: totals._sum.pendingPaise ?? 0,
    availablePaise: totals._sum.availablePaise ?? 0,
    scheduledPaise: totals._sum.scheduledPaise ?? 0,
    paidThisMonthPaise: paidThisMonth._sum.netPaise ?? 0,
    paidThisMonthCount: paidThisMonth._count._all,
    // Below the threshold and above zero: money owed that will not go out on
    // the next run and will carry forward instead.
    heldSellers: balances.filter(
      (row) => row.availablePaise > 0 && row.availablePaise <= minPayoutPaise,
    ).length,
    minPayoutPaise,
    openStatements,
  };
}

// ---------------------------------------------------------------------------
// Sellers with balances
// ---------------------------------------------------------------------------

export type SellerBalanceRow = {
  sellerId: string;
  sellerName: string;
  sellerHref: Route;
  status: string;
  pendingPaise: number;
  availablePaise: number;
  scheduledPaise: number;
  paidPaise: number;
  lastPayoutAt: Date | null;
  lastPayoutNumber: string | null;
  openPayout: { id: string; number: string; status: PayoutStatus } | null;
  /** Available but below the minimum: nothing will be generated (B5). */
  held: boolean;
  hasBankAccount: boolean;
};

const BALANCE_ORDER: Record<BalanceSort, keyof Prisma.SellerBalanceOrderByWithRelationInput | "seller"> = {
  seller: "seller",
  pending: "pendingPaise",
  available: "availablePaise",
  scheduled: "scheduledPaise",
  paid: "paidPaise",
};

export async function listSellerBalances(
  params: ListParams & { sort: BalanceSort },
  filters: { q: string; sellerId?: string; onlyOwed?: boolean },
): Promise<{ rows: SellerBalanceRow[]; meta: PageMeta; minPayoutPaise: number }> {
  const where: Prisma.SellerBalanceWhereInput = { seller: { deletedAt: null } };
  if (filters.sellerId) where.sellerId = filters.sellerId;
  if (filters.q) {
    where.seller = {
      deletedAt: null,
      OR: [
        { displayName: { contains: filters.q, mode: "insensitive" } },
        { email: { contains: filters.q, mode: "insensitive" } },
      ],
    };
  }
  if (filters.onlyOwed) {
    where.OR = [{ pendingPaise: { gt: 0 } }, { availablePaise: { gt: 0 } }, { scheduledPaise: { gt: 0 } }];
  }

  const column = BALANCE_ORDER[params.sort];
  const orderBy: Prisma.SellerBalanceOrderByWithRelationInput[] =
    column === "seller"
      ? [{ seller: { displayName: params.order } }]
      : [{ [column]: params.order } as Prisma.SellerBalanceOrderByWithRelationInput, { sellerId: "asc" }];

  const [total, rows, minPayoutPaise] = await Promise.all([
    db.sellerBalance.count({ where }),
    db.sellerBalance.findMany({
      where,
      orderBy,
      skip: params.skip,
      take: params.pageSize,
      select: {
        sellerId: true,
        pendingPaise: true,
        availablePaise: true,
        scheduledPaise: true,
        paidPaise: true,
        seller: {
          select: {
            id: true,
            displayName: true,
            status: true,
            _count: { select: { bankAccounts: true } },
            payouts: {
              orderBy: { createdAt: "desc" },
              take: 5,
              select: { id: true, payoutNumber: true, status: true, paidAt: true },
            },
          },
        },
      },
    }),
    readSettingNumber(undefined, "marketplace.min_payout_paise"),
  ]);

  return {
    rows: rows.map((row) => {
      const open = row.seller.payouts.find((payout) =>
        (OPEN_PAYOUT_STATUSES as readonly string[]).includes(payout.status),
      );
      const lastPaid = row.seller.payouts.find((payout) => payout.status === "PAID");
      return {
        sellerId: row.sellerId,
        sellerName: row.seller.displayName,
        sellerHref: `/admin/sellers/${row.sellerId}` as Route,
        status: row.seller.status,
        pendingPaise: row.pendingPaise,
        availablePaise: row.availablePaise,
        scheduledPaise: row.scheduledPaise,
        paidPaise: row.paidPaise,
        lastPayoutAt: lastPaid?.paidAt ?? null,
        lastPayoutNumber: lastPaid?.payoutNumber ?? null,
        openPayout: open
          ? { id: open.id, number: open.payoutNumber, status: open.status as PayoutStatus }
          : null,
        held: row.availablePaise > 0 && row.availablePaise <= minPayoutPaise,
        hasBankAccount: row.seller._count.bankAccounts > 0,
      };
    }),
    meta: buildPageMeta(total, params),
    minPayoutPaise,
  };
}

export type BankAccountOption = {
  id: string;
  label: string;
  bankName: string;
  last4: string;
  ifsc: string;
  upiId: string | null;
  isPrimary: boolean;
  isVerified: boolean;
};

/** D4: only ever the last four digits; the full number stays encrypted. */
export async function listSellerBankAccounts(sellerId: string): Promise<BankAccountOption[]> {
  const rows = await db.sellerBankAccount.findMany({
    where: { sellerId },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      accountHolder: true,
      bankName: true,
      accountNumberLast4: true,
      ifsc: true,
      upiId: true,
      isPrimary: true,
      isVerified: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    label: `${row.accountHolder} · ${row.bankName} ••••${row.accountNumberLast4}`,
    bankName: row.bankName,
    last4: row.accountNumberLast4,
    ifsc: row.ifsc,
    upiId: row.upiId,
    isPrimary: row.isPrimary,
    isVerified: row.isVerified,
  }));
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

export type PayoutListRow = {
  id: string;
  payoutNumber: string;
  sellerId: string;
  sellerName: string;
  sellerHref: Route;
  periodFrom: Date;
  periodTo: Date;
  grossSalesPaise: number;
  commissionPaise: number;
  chargesPaise: number;
  refundsPaise: number;
  adjustmentsPaise: number;
  netPaise: number;
  status: PayoutStatus;
  method: PayoutMethod;
  referenceNumber: string | null;
  entryCount: number;
  createdAt: Date;
  paidAt: Date | null;
};

export function buildPayoutWhere(
  filters: PayoutListFilters,
  range?: DateRange,
  options: { includeStatus?: boolean } = {},
): Prisma.SellerPayoutWhereInput {
  const where: Prisma.SellerPayoutWhereInput = {};
  if (options.includeStatus !== false && filters.status) where.status = filters.status;
  if (filters.sellerId) where.sellerId = filters.sellerId;
  if (range) where.createdAt = { gte: range.from, lte: range.to };
  if (filters.q) {
    where.OR = [
      { payoutNumber: { contains: filters.q, mode: "insensitive" } },
      { referenceNumber: { contains: filters.q, mode: "insensitive" } },
      { seller: { displayName: { contains: filters.q, mode: "insensitive" } } },
    ];
  }
  return where;
}

const PAYOUT_ORDER: Record<PayoutSort, (order: "asc" | "desc") => Prisma.SellerPayoutOrderByWithRelationInput[]> = {
  createdAt: (order) => [{ createdAt: order }],
  payoutNumber: (order) => [{ seq: order }],
  seller: (order) => [{ seller: { displayName: order } }, { createdAt: "desc" }],
  netPaise: (order) => [{ netPaise: order }, { createdAt: "desc" }],
  periodTo: (order) => [{ periodTo: order }],
  // Statements that were never paid sort last rather than interleaving nulls.
  paidAt: (order) => [{ paidAt: { sort: order, nulls: "last" } }],
};

export async function listPayouts(
  params: ListParams & { sort: PayoutSort },
  filters: PayoutListFilters,
  range?: DateRange,
): Promise<{ rows: PayoutListRow[]; meta: PageMeta; total: number }> {
  const where = buildPayoutWhere(filters, range);
  const [total, rows] = await Promise.all([
    db.sellerPayout.count({ where }),
    db.sellerPayout.findMany({
      where,
      orderBy: PAYOUT_ORDER[params.sort](params.order),
      skip: params.skip,
      take: params.pageSize,
      select: PAYOUT_ROW_SELECT,
    }),
  ]);

  return { rows: rows.map(toPayoutRow), meta: buildPageMeta(total, params), total };
}

const PAYOUT_ROW_SELECT = {
  id: true,
  payoutNumber: true,
  sellerId: true,
  periodFrom: true,
  periodTo: true,
  grossSalesPaise: true,
  commissionPaise: true,
  chargesPaise: true,
  refundsPaise: true,
  adjustmentsPaise: true,
  netPaise: true,
  status: true,
  method: true,
  referenceNumber: true,
  createdAt: true,
  paidAt: true,
  seller: { select: { displayName: true } },
  _count: { select: { ledgerEntries: true } },
} satisfies Prisma.SellerPayoutSelect;

function toPayoutRow(row: Prisma.SellerPayoutGetPayload<{ select: typeof PAYOUT_ROW_SELECT }>): PayoutListRow {
  return {
    id: row.id,
    payoutNumber: row.payoutNumber,
    sellerId: row.sellerId,
    sellerName: row.seller.displayName,
    sellerHref: `/admin/sellers/${row.sellerId}` as Route,
    periodFrom: row.periodFrom,
    periodTo: row.periodTo,
    grossSalesPaise: row.grossSalesPaise,
    commissionPaise: row.commissionPaise,
    chargesPaise: row.chargesPaise,
    refundsPaise: row.refundsPaise,
    adjustmentsPaise: row.adjustmentsPaise,
    netPaise: row.netPaise,
    status: row.status as PayoutStatus,
    method: row.method as PayoutMethod,
    referenceNumber: row.referenceNumber,
    entryCount: row._count.ledgerEntries,
    createdAt: row.createdAt,
    paidAt: row.paidAt,
  };
}

export async function payoutStatusCounts(
  filters: PayoutListFilters,
  range?: DateRange,
): Promise<Record<PayoutStatus, number> & { all: number }> {
  const where = buildPayoutWhere(filters, range, { includeStatus: false });
  const grouped = await db.sellerPayout.groupBy({ by: ["status"], where, _count: { _all: true } });

  const counts = {
    PENDING: 0,
    APPROVED: 0,
    PROCESSING: 0,
    PAID: 0,
    FAILED: 0,
    CANCELLED: 0,
    all: 0,
  } as Record<PayoutStatus, number> & { all: number };
  for (const row of grouped) {
    counts[row.status as PayoutStatus] = row._count._all;
    counts.all += row._count._all;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export type LedgerRow = {
  id: string;
  sellerId: string;
  sellerName: string;
  sellerHref: Route;
  type: LedgerEntryType;
  typeLabel: string;
  typeTone: BadgeTone;
  amountPaise: number;
  description: string;
  status: LedgerEntryStatus;
  statusLabel: string;
  statusTone: BadgeTone;
  availableAt: Date | null;
  createdAt: Date;
  orderId: string | null;
  orderNumber: string | null;
  orderHref: Route | null;
  orderItemId: string | null;
  itemTitle: string | null;
  payoutId: string | null;
  payoutNumber: string | null;
};

export function buildLedgerWhere(
  filters: LedgerFilters,
  range?: DateRange,
): Prisma.SellerLedgerEntryWhereInput {
  const where: Prisma.SellerLedgerEntryWhereInput = {};
  if (filters.sellerId) where.sellerId = filters.sellerId;
  if (filters.type) where.type = filters.type;
  if (filters.status) where.status = filters.status;
  if (range) where.createdAt = { gte: range.from, lte: range.to };
  if (filters.q) {
    where.OR = [
      { description: { contains: filters.q, mode: "insensitive" } },
      { order: { orderNumber: { contains: filters.q, mode: "insensitive" } } },
      { seller: { displayName: { contains: filters.q, mode: "insensitive" } } },
    ];
  }
  return where;
}

export const LEDGER_SELECT = {
  id: true,
  sellerId: true,
  type: true,
  amountPaise: true,
  description: true,
  status: true,
  availableAt: true,
  createdAt: true,
  orderId: true,
  orderItemId: true,
  payoutId: true,
  seller: { select: { displayName: true } },
  order: { select: { orderNumber: true } },
  orderItem: { select: { titleSnapshot: true, variantSnapshot: true } },
  payout: { select: { payoutNumber: true } },
} satisfies Prisma.SellerLedgerEntrySelect;

export function toLedgerRow(row: Prisma.SellerLedgerEntryGetPayload<{ select: typeof LEDGER_SELECT }>): LedgerRow {
  const type = row.type as LedgerEntryType;
  const status = row.status as LedgerEntryStatus;
  return {
    id: row.id,
    sellerId: row.sellerId,
    sellerName: row.seller.displayName,
    sellerHref: `/admin/sellers/${row.sellerId}` as Route,
    type,
    typeLabel: LEDGER_ENTRY_TYPE_META[type]?.label ?? type,
    typeTone: LEDGER_ENTRY_TYPE_META[type]?.tone ?? "neutral",
    amountPaise: row.amountPaise,
    description: row.description,
    status,
    statusLabel: LEDGER_ENTRY_STATUS_META[status]?.label ?? status,
    statusTone: LEDGER_ENTRY_STATUS_META[status]?.tone ?? "neutral",
    availableAt: row.availableAt,
    createdAt: row.createdAt,
    orderId: row.orderId,
    orderNumber: row.order?.orderNumber ?? null,
    orderHref: row.orderId ? (`/admin/orders/${row.orderId}` as Route) : null,
    orderItemId: row.orderItemId,
    itemTitle: row.orderItem
      ? [row.orderItem.titleSnapshot, row.orderItem.variantSnapshot].filter(Boolean).join(" · ")
      : null,
    payoutId: row.payoutId,
    payoutNumber: row.payout?.payoutNumber ?? null,
  };
}

export async function listLedgerEntries(
  params: ListParams,
  filters: LedgerFilters,
  range?: DateRange,
): Promise<{ rows: LedgerRow[]; meta: PageMeta; totals: { creditPaise: number; debitPaise: number; netPaise: number } }> {
  const where = buildLedgerWhere(filters, range);
  const [total, rows, credit, debit] = await Promise.all([
    db.sellerLedgerEntry.count({ where }),
    db.sellerLedgerEntry.findMany({
      where,
      orderBy: [{ createdAt: params.order }, { id: "desc" }],
      skip: params.skip,
      take: params.pageSize,
      select: LEDGER_SELECT,
    }),
    db.sellerLedgerEntry.aggregate({ where: { ...where, amountPaise: { gt: 0 } }, _sum: { amountPaise: true } }),
    db.sellerLedgerEntry.aggregate({ where: { ...where, amountPaise: { lt: 0 } }, _sum: { amountPaise: true } }),
  ]);

  const creditPaise = credit._sum.amountPaise ?? 0;
  const debitPaise = -(debit._sum.amountPaise ?? 0);

  return {
    rows: rows.map(toLedgerRow),
    meta: buildPageMeta(total, params),
    // Totals are for the WHOLE filtered set, not the page - a page total would
    // be meaningless for reconciliation.
    totals: { creditPaise, debitPaise, netPaise: creditPaise - debitPaise },
  };
}

/** EntityPicker chip for `?seller=`. */
export async function getPayoutFilterRefs(filters: {
  sellerId?: string;
}): Promise<{ seller: { id: string; title: string; subtitle?: string } | null }> {
  if (!filters.sellerId) return { seller: null };
  const seller = await db.seller.findFirst({
    where: { id: filters.sellerId, deletedAt: null },
    select: { id: true, displayName: true, email: true },
  });
  return { seller: seller ? { id: seller.id, title: seller.displayName, subtitle: seller.email } : null };
}

/** Paged fetch for the statements export. */
export async function pagePayoutsForExport(
  filters: PayoutListFilters,
  range: DateRange | undefined,
  skip: number,
  take: number,
): Promise<PayoutListRow[]> {
  const rows = await db.sellerPayout.findMany({
    where: buildPayoutWhere(filters, range),
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    skip,
    take,
    select: PAYOUT_ROW_SELECT,
  });
  return rows.map(toPayoutRow);
}

/** Paged fetch for the ledger export. */
export async function pageLedgerForExport(
  filters: LedgerFilters,
  range: DateRange | undefined,
  skip: number,
  take: number,
): Promise<LedgerRow[]> {
  const rows = await db.sellerLedgerEntry.findMany({
    where: buildLedgerWhere(filters, range),
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    skip,
    take,
    select: LEDGER_SELECT,
  });
  return rows.map(toLedgerRow);
}

/** Default `periodTo` for the generate dialog: end of today in IST. */
export function defaultPeriodTo(now: Date = new Date()): Date {
  return endOfIstDay(now);
}

export { startOfIstDay };
