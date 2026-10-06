import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { can, requirePermission } from "@/lib/auth/guards";
import {
  PAYMENT_INSTRUMENT_META,
  PAYMENT_PROVIDER_META,
  PAYMENT_TRANSACTION_STATUS_META,
  PAYMENT_TYPE_META,
  REFUND_STATUS_META,
  type PaymentInstrument,
  type PaymentProviderCode,
  type PaymentTransactionStatus,
  type PaymentType,
  type RefundStatus,
} from "@/lib/enums";
import { formatIstDateTime } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/shared/copy-button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { StatusPill } from "@/components/shared/status-badge";

import { RawPayloadViewer } from "@/features/payments/components/raw-payload";
import { getPaymentDetail } from "@/features/payments/queries";

export const metadata: Metadata = { title: "Payment" };

/**
 * /admin/payments/[id] (blueprint §9, §14.B6, D4, D5, D11).
 *
 * Everything needed to reconcile one transaction with a gateway dashboard:
 * the ids to paste, the failure the gateway reported, the refund legs booked
 * against the same order, and the webhook events that mention it. The raw
 * payload is only fetched for actors with `payments.manage`.
 */
export default async function PaymentDetailPage({ params }: PageProps<"/admin/payments/[id]">) {
  const actor = await requirePermission("payments.view");
  const { id } = await params;

  const canManage = can(actor, "payments.manage");
  const payment = await getPaymentDetail(id, { includeRaw: canManage });
  if (!payment) notFound();

  const statusMeta = PAYMENT_TRANSACTION_STATUS_META[payment.status as PaymentTransactionStatus];
  const isRefundLeg = payment.type === "REFUND";

  return (
    <div className="space-y-4">
      <PageHeader
        title={payment.providerPaymentId ?? payment.id}
        description={`${PAYMENT_TYPE_META[payment.type as PaymentType]?.label ?? payment.type} of ${formatPaise(payment.amountPaise)} on order ${payment.orderNumber}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href={"/admin/payments" as Route}>
                <ArrowLeft /> All payments
              </Link>
            </Button>
            <StatusPill label={statusMeta?.label ?? payment.status} tone={statusMeta?.tone ?? "neutral"} />
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Panel title="Transaction">
            <dl className="divide-y text-xs">
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <dt className="text-muted-foreground">Amount</dt>
                <dd data-numeric className="text-sm font-semibold">
                  {isRefundLeg ? "−" : ""}
                  {formatPaise(payment.amountPaise)} {payment.currency}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <dt className="text-muted-foreground">Gateway</dt>
                <dd>{PAYMENT_PROVIDER_META[payment.provider as PaymentProviderCode]?.label ?? payment.provider}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <dt className="text-muted-foreground">Method</dt>
                <dd>{PAYMENT_INSTRUMENT_META[payment.method as PaymentInstrument]?.label ?? payment.method}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <dt className="text-muted-foreground">Gateway payment id</dt>
                <dd className="flex items-center gap-1.5 font-mono">
                  {payment.providerPaymentId ?? "—"}
                  {payment.providerPaymentId ? <CopyButton value={payment.providerPaymentId} /> : null}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <dt className="text-muted-foreground">Gateway order id</dt>
                <dd className="flex items-center gap-1.5 font-mono">
                  {payment.providerOrderId ?? "—"}
                  {payment.providerOrderId ? <CopyButton value={payment.providerOrderId} /> : null}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <dt className="text-muted-foreground">Created</dt>
                <dd>{formatIstDateTime(payment.createdAt)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <dt className="text-muted-foreground">Captured</dt>
                <dd>{payment.capturedAt ? formatIstDateTime(payment.capturedAt) : "—"}</dd>
              </div>
              {payment.refundNumber ? (
                <div className="flex items-center justify-between gap-3 px-4 py-2">
                  <dt className="text-muted-foreground">Settles refund</dt>
                  <dd>
                    <Link href={`/admin/refunds/${payment.refundId}` as Route} className="text-brand font-mono hover:underline">
                      {payment.refundNumber}
                    </Link>
                  </dd>
                </div>
              ) : null}
            </dl>
          </Panel>

          {payment.failureCode || payment.failureMessage ? (
            <Panel title="Failure" description="What the gateway reported">
              <dl className="divide-y text-xs">
                <div className="flex items-center justify-between gap-3 px-4 py-2">
                  <dt className="text-muted-foreground">Code</dt>
                  <dd className="font-mono">{payment.failureCode ?? "—"}</dd>
                </div>
                <div className="px-4 py-2">
                  <dt className="text-muted-foreground">Message</dt>
                  <dd className="mt-0.5">{payment.failureMessage ?? "—"}</dd>
                </div>
              </dl>
            </Panel>
          ) : null}

          <Panel
            title="Gateway payload"
            description={canManage ? "Exactly what the provider sent us" : "Visible to actors with payments.manage"}
          >
            {canManage ? (
              <RawPayloadViewer payload={payment.rawPayload} />
            ) : (
              <p className="text-muted-foreground px-4 py-3 text-xs">
                The raw payload can carry card metadata and signatures, so it is only shown to actors who can manage payments.
              </p>
            )}
          </Panel>

          <Panel title="Webhook events" description="Provider events mentioning this transaction (D5)">
            {payment.webhookEvents.length === 0 ? (
              <EmptyState
                title="No webhook events"
                description="Either the provider does not send webhooks for this transaction, or none has arrived yet."
              />
            ) : (
              <ul className="divide-y text-xs">
                {payment.webhookEvents.map((event) => (
                  <li key={event.id} className="px-4 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-[11px]">{event.providerEventId}</span>
                      <span className="text-muted-foreground text-[11px]">{formatIstDateTime(event.receivedAt)}</span>
                    </div>
                    <p className="text-muted-foreground mt-0.5">
                      {event.processedAt ? `Processed ${formatIstDateTime(event.processedAt)}` : "Not processed yet"}
                      {event.error ? ` · ${event.error}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Order">
            <dl className="divide-y text-xs">
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <dt className="text-muted-foreground">Order</dt>
                <dd>
                  <Link href={`/admin/orders/${payment.order.id}` as Route} className="text-brand font-mono hover:underline">
                    {payment.order.orderNumber}
                  </Link>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <dt className="text-muted-foreground">Order status</dt>
                <dd>{payment.order.status}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <dt className="text-muted-foreground">Payment status</dt>
                <dd>{payment.order.paymentStatus}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <dt className="text-muted-foreground">Order total</dt>
                <dd data-numeric>{formatPaise(payment.order.totalPaise)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <dt className="text-muted-foreground">Refunded</dt>
                <dd data-numeric>{formatPaise(payment.order.refundedPaise)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <dt className="text-muted-foreground">Customer</dt>
                <dd className="text-right">
                  {payment.customerId ? (
                    <Link href={`/admin/customers/${payment.customerId}` as Route} className="hover:underline">
                      {payment.customerName}
                    </Link>
                  ) : (
                    payment.customerName
                  )}
                  <div className="text-muted-foreground">{payment.customerEmail}</div>
                </dd>
              </div>
            </dl>
          </Panel>

          <Panel title="Refunds on this order" description="Both the record and its settlement leg">
            {payment.refunds.length === 0 ? (
              <p className="text-muted-foreground px-4 py-3 text-xs">Nothing has been refunded on this order.</p>
            ) : (
              <ul className="divide-y text-xs">
                {payment.refunds.map((refund) => (
                  <li key={refund.id} className="flex items-center justify-between gap-3 px-4 py-2">
                    <div className="min-w-0">
                      {can(actor, "refunds.view") ? (
                        <Link href={`/admin/refunds/${refund.id}` as Route} className="font-mono hover:underline">
                          {refund.refundNumber}
                        </Link>
                      ) : (
                        <span className="font-mono">{refund.refundNumber}</span>
                      )}
                      <div className="text-muted-foreground text-[11px]">{formatIstDateTime(refund.createdAt)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span data-numeric>{formatPaise(refund.amountPaise)}</span>
                      <StatusPill
                        label={REFUND_STATUS_META[refund.status as RefundStatus]?.label ?? refund.status}
                        tone={REFUND_STATUS_META[refund.status as RefundStatus]?.tone ?? "neutral"}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {payment.relatedRefundPayments.length > 0 ? (
            <Panel title="Refund legs" description="OrderPayment rows of type REFUND (B6)">
              <ul className="divide-y text-xs">
                {payment.relatedRefundPayments.map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-2">
                    <div className="min-w-0">
                      <p>
                        {row.provider} · {row.method}
                      </p>
                      <p className="text-muted-foreground font-mono text-[11px]">{row.providerPaymentId ?? "—"}</p>
                    </div>
                    <span data-numeric>−{formatPaise(row.amountPaise)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}
