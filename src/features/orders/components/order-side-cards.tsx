import Link from "next/link";
import type { Route } from "next";
import { History, PackageX, RotateCcw, Store, User } from "lucide-react";

import {
  REFUND_STATUS_META,
  RETURN_REQUEST_STATUS_META,
  RETURN_REASON_META,
  type RefundStatus,
  type ReturnReason,
  type ReturnRequestStatus,
} from "@/lib/enums";
import { formatIstDateTime } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusPill } from "@/components/shared/status-badge";

import type { SellerSplit } from "../pricing";

/**
 * The read-only cards down the right of the order detail page.
 *
 * They are Server Components on purpose: none of them has an interaction, so
 * shipping them as client code would only add bytes to a page that already
 * carries four dialogs. Every link points at the module that owns the record
 * (customers, sellers, returns, refunds) rather than duplicating its screens
 * here.
 */

function Card({ title, subtitle, icon: Icon, children }: { title: string; subtitle?: string; icon: typeof User; children: React.ReactNode }) {
  return (
    <section className="surface overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold tracking-tight">{title}</h2>
          {subtitle ? <p className="text-muted-foreground text-[11px]">{subtitle}</p> : null}
        </div>
        <Icon className="text-muted-foreground size-3.5 shrink-0" />
      </header>
      {children}
    </section>
  );
}

export function OrderCustomerCard({
  customerId,
  name,
  email,
  phone,
  isGuest,
  orderCount,
  totalSpentPaise,
  customerNote,
  source,
  createdByName,
}: {
  customerId: string | null;
  name: string;
  email: string;
  phone: string | null;
  isGuest: boolean;
  orderCount: number | null;
  totalSpentPaise: number | null;
  customerNote: string | null;
  source: string;
  createdByName: string | null;
}) {
  return (
    <Card title="Customer" icon={User}>
      <div className="space-y-2 p-4 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          {customerId ? (
            <Link href={`/admin/customers/${customerId}` as Route} className="font-medium hover:underline">
              {name}
            </Link>
          ) : (
            <span className="font-medium">{name}</span>
          )}
          {isGuest ? <StatusPill label="Guest" tone="neutral" dot={false} /> : null}
        </div>
        <p className="text-muted-foreground break-all">{email || "No email on file"}</p>
        {phone ? <p className="text-muted-foreground">{phone}</p> : null}
        {orderCount !== null ? (
          <p className="text-muted-foreground">
            {orderCount} order{orderCount === 1 ? "" : "s"} · {formatPaise(totalSpentPaise ?? 0)} lifetime
          </p>
        ) : null}
        <p className="text-muted-foreground">
          Source {source.toLowerCase()}
          {createdByName ? ` · keyed by ${createdByName}` : ""}
        </p>
        {customerNote ? (
          <div className="bg-muted/40 rounded-md border p-2">
            <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">Customer note</p>
            <p className="mt-0.5 break-words">{customerNote}</p>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * B3 seen from the order: what each seller earns and what the platform keeps.
 * Cancelled lines are already excluded by `summariseSellerSplit`, so the
 * payable column matches what the payout run will actually pick up.
 */
export function OrderSellerSplitCard({ split }: { split: SellerSplit[] }) {
  if (split.length === 0) return null;
  return (
    <Card title="Seller split" subtitle="Commission snapshot taken when the order was placed" icon={Store}>
      <ul className="divide-y">
        {split.map((group) => (
          <li key={group.sellerId ?? "platform"} className="space-y-1 px-4 py-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              {group.sellerId ? (
                <Link href={`/admin/sellers/${group.sellerId}` as Route} className="font-medium hover:underline">
                  {group.sellerName}
                </Link>
              ) : (
                <span className="font-medium">{group.sellerName}</span>
              )}
              <span data-numeric className="font-medium">
                {formatPaise(group.payablePaise)}
              </span>
            </div>
            <div className="text-muted-foreground grid grid-cols-2 gap-x-3 text-[11px]">
              <span>Gross {formatPaise(group.grossPaise)}</span>
              <span>Commission −{formatPaise(group.commissionPaise)}</span>
              <span>Charges −{formatPaise(group.chargesPaise)}</span>
              <span>
                {group.lines} line{group.lines === 1 ? "" : "s"}
                {group.sellerFundedDiscountPaise > 0 ? ` · funded ${formatPaise(group.sellerFundedDiscountPaise)}` : ""}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export type OrderReturnRow = {
  id: string;
  rmaNumber: string;
  status: string;
  quantity: number;
  reason: string;
  requestedAt: Date;
  resolution: string | null;
};

export function OrderReturnsCard({ returns }: { returns: OrderReturnRow[] }) {
  return (
    <Card title="Returns" subtitle={`${returns.length} request${returns.length === 1 ? "" : "s"}`} icon={PackageX}>
      {returns.length === 0 ? (
        <EmptyState compact icon={PackageX} title="No returns" description="Nothing has been sent back on this order." />
      ) : (
        <ul className="divide-y">
          {returns.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs">
              <div className="min-w-0">
                <Link href={`/admin/returns/${row.id}` as Route} className="font-mono font-medium hover:underline">
                  {row.rmaNumber}
                </Link>
                <p className="text-muted-foreground text-[11px]">
                  {row.quantity} unit{row.quantity === 1 ? "" : "s"} · {RETURN_REASON_META[row.reason as ReturnReason]?.label ?? row.reason} ·{" "}
                  {formatIstDateTime(row.requestedAt)}
                </p>
              </div>
              <StatusPill
                label={RETURN_REQUEST_STATUS_META[row.status as ReturnRequestStatus]?.label ?? row.status}
                tone={RETURN_REQUEST_STATUS_META[row.status as ReturnRequestStatus]?.tone ?? "neutral"}
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export type OrderRefundRow = {
  id: string;
  refundNumber: string;
  status: string;
  amountPaise: number;
  method: string;
  reason: string | null;
  createdAt: Date;
  completedAt: Date | null;
};

export function OrderRefundsCard({ refunds }: { refunds: OrderRefundRow[] }) {
  if (refunds.length === 0) return null;
  return (
    <Card title="Refunds" subtitle={`${refunds.length} record${refunds.length === 1 ? "" : "s"}`} icon={RotateCcw}>
      <ul className="divide-y">
        {refunds.map((row) => (
          <li key={row.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-2.5 text-xs">
            <div className="min-w-0">
              <Link href={`/admin/refunds/${row.id}` as Route} className="font-mono font-medium hover:underline">
                {row.refundNumber}
              </Link>
              <p className="text-muted-foreground text-[11px]">
                {row.method.toLowerCase().replace("_", " ")} · {formatIstDateTime(row.completedAt ?? row.createdAt)}
              </p>
              {row.reason ? <p className="text-muted-foreground text-[11px] break-words">{row.reason}</p> : null}
            </div>
            <div className="text-right">
              <span data-numeric className="font-medium">
                {formatPaise(row.amountPaise)}
              </span>
              <div className="mt-0.5">
                <StatusPill
                  label={REFUND_STATUS_META[row.status as RefundStatus]?.label ?? row.status}
                  tone={REFUND_STATUS_META[row.status as RefundStatus]?.tone ?? "neutral"}
                />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export type OrderActivityRow = {
  id: string;
  action: string;
  summary: string | null;
  actorEmail: string | null;
  createdAt: Date;
};

/** D13: the audit trail beside the timeline - who did it, not just what happened. */
export function OrderActivityCard({ rows }: { rows: OrderActivityRow[] }) {
  return (
    <Card title="Activity" subtitle="Audit log for this order and its shipments" icon={History}>
      {rows.length === 0 ? (
        <EmptyState compact icon={History} title="No admin activity" description="Nobody has changed this order from the admin yet." />
      ) : (
        <ul className="divide-y">
          {rows.map((row) => (
            <li key={row.id} className="px-4 py-2 text-xs">
              <p className="break-words">{row.summary ?? row.action}</p>
              <p className="text-muted-foreground text-[11px]">
                {row.actorEmail ?? "system"} · {formatIstDateTime(row.createdAt)} · {row.action}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
