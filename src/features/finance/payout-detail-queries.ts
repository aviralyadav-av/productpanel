import "server-only";

import type { Route } from "next";

import { db } from "@/lib/db";
import type { BadgeTone } from "@/lib/enums";
import type { LedgerEntryStatus, LedgerEntryType, PayoutMethod, PayoutStatus } from "@/lib/enums";

import { parseBankSnapshot, type BankSnapshot } from "./ui-identity";
import { LEDGER_SELECT, listSellerBankAccounts, toLedgerRow, type BankAccountOption } from "./payout-queries";

/**
 * One payout statement, end to end (blueprint §14.B5, D4).
 *
 * Split out of `payout-queries.ts` because the detail screen and the printable
 * statement need a shape the list screens never do: the attached ledger rows,
 * the signed sum used for the B5 cross-check, and the masked bank snapshot -
 * the full account number is NEVER selected, only the last four digits that
 * `transitionPayout` wrote at PROCESSING.
 */

export type PayoutEntryRow = {
  id: string;
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
  itemTitle: string | null;
};

export type PayoutDetail = {
  id: string;
  payoutNumber: string;
  status: PayoutStatus;
  method: PayoutMethod;
  periodFrom: Date;
  periodTo: Date;
  grossSalesPaise: number;
  commissionPaise: number;
  chargesPaise: number;
  refundsPaise: number;
  adjustmentsPaise: number;
  netPaise: number;
  /** Signed sum of the attached ledger rows - the B5 cross-check. */
  ledgerSumPaise: number;
  referenceNumber: string | null;
  failureReason: string | null;
  notes: string | null;
  /** The account currently attached, for the "mark processing" chooser. */
  bankAccountId: string | null;
  createdAt: Date;
  approvedAt: Date | null;
  processedAt: Date | null;
  paidAt: Date | null;
  createdByName: string | null;
  approvedByName: string | null;
  seller: {
    id: string;
    name: string;
    email: string;
    href: Route;
    gstin: string | null;
    pan: string | null;
    city: string | null;
    state: string | null;
  };
  bankSnapshot: BankSnapshot | null;
  /** Live accounts, for the "mark processing" account chooser. */
  bankAccounts: BankAccountOption[];
  entries: PayoutEntryRow[];
};

export async function getPayoutDetail(id: string): Promise<PayoutDetail | null> {
  const payout = await db.sellerPayout.findUnique({
    where: { id },
    select: {
      id: true,
      payoutNumber: true,
      status: true,
      method: true,
      periodFrom: true,
      periodTo: true,
      grossSalesPaise: true,
      commissionPaise: true,
      chargesPaise: true,
      refundsPaise: true,
      adjustmentsPaise: true,
      netPaise: true,
      referenceNumber: true,
      failureReason: true,
      notes: true,
      bankAccountId: true,
      bankAccountSnapshot: true,
      createdAt: true,
      approvedAt: true,
      processedAt: true,
      paidAt: true,
      createdBy: { select: { name: true, email: true } },
      approvedBy: { select: { name: true, email: true } },
      seller: {
        select: {
          id: true,
          displayName: true,
          email: true,
          gstin: true,
          pan: true,
          city: true,
          state: true,
        },
      },
      ledgerEntries: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: LEDGER_SELECT,
      },
    },
  });
  if (!payout) return null;

  const bankAccounts = await listSellerBankAccounts(payout.seller.id);
  const entries = payout.ledgerEntries.map(toLedgerRow);

  return {
    id: payout.id,
    payoutNumber: payout.payoutNumber,
    status: payout.status as PayoutStatus,
    method: payout.method as PayoutMethod,
    periodFrom: payout.periodFrom,
    periodTo: payout.periodTo,
    grossSalesPaise: payout.grossSalesPaise,
    commissionPaise: payout.commissionPaise,
    chargesPaise: payout.chargesPaise,
    refundsPaise: payout.refundsPaise,
    adjustmentsPaise: payout.adjustmentsPaise,
    netPaise: payout.netPaise,
    ledgerSumPaise: entries.reduce((sum, entry) => sum + entry.amountPaise, 0),
    referenceNumber: payout.referenceNumber,
    failureReason: payout.failureReason,
    notes: payout.notes,
    bankAccountId: payout.bankAccountId,
    createdAt: payout.createdAt,
    approvedAt: payout.approvedAt,
    processedAt: payout.processedAt,
    paidAt: payout.paidAt,
    createdByName: payout.createdBy?.name ?? payout.createdBy?.email ?? null,
    approvedByName: payout.approvedBy?.name ?? payout.approvedBy?.email ?? null,
    seller: {
      id: payout.seller.id,
      name: payout.seller.displayName,
      email: payout.seller.email,
      href: `/admin/sellers/${payout.seller.id}` as Route,
      gstin: payout.seller.gstin,
      pan: payout.seller.pan,
      city: payout.seller.city,
      state: payout.seller.state,
    },
    bankSnapshot: parseBankSnapshot(payout.bankAccountSnapshot),
    bankAccounts,
    entries: entries.map((entry) => ({
      id: entry.id,
      type: entry.type,
      typeLabel: entry.typeLabel,
      typeTone: entry.typeTone,
      amountPaise: entry.amountPaise,
      description: entry.description,
      status: entry.status,
      statusLabel: entry.statusLabel,
      statusTone: entry.statusTone,
      availableAt: entry.availableAt,
      createdAt: entry.createdAt,
      orderId: entry.orderId,
      orderNumber: entry.orderNumber,
      orderHref: entry.orderHref,
      itemTitle: entry.itemTitle,
    })),
  };
}

export async function listPayoutEntries(payoutId: string): Promise<PayoutEntryRow[]> {
  const detail = await getPayoutDetail(payoutId);
  return detail?.entries ?? [];
}

export type PayoutActivityRow = {
  id: string;
  action: string;
  summary: string;
  actorEmail: string | null;
  createdAt: Date;
  ip: string | null;
};

/** AuditLog for one statement (D13: approve / process / paid / fail). */
export async function listPayoutActivity(payoutId: string, take = 50): Promise<PayoutActivityRow[]> {
  const rows = await db.auditLog.findMany({
    where: { entityType: "SellerPayout", entityId: payoutId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, action: true, summary: true, actorEmail: true, createdAt: true, ip: true },
  });
  return rows;
}

/** Store header for the printable statement (E5 store identity keys). */
export async function getStatementIdentity(): Promise<{
  name: string;
  address: string;
  email: string;
  phone: string;
}> {
  const rows = await db.setting.findMany({
    where: {
      key: {
        in: ["store.name", "store.address", "store.contact_email", "store.contact_phone"],
      },
    },
    select: { key: true, value: true },
  });
  const map = new Map(rows.map((row) => [row.key, row.value]));
  return {
    name: map.get("store.name") ?? "DIY Baazar",
    address: map.get("store.address") ?? "",
    email: map.get("store.contact_email") ?? "",
    phone: map.get("store.contact_phone") ?? "",
  };
}

