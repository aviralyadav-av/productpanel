import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { can, requirePermission } from "@/lib/auth/guards";
import {
  PAYMENT_PROVIDER_META,
  REFUND_METHOD_META,
  REFUND_STATUS_META,
  type PaymentProviderCode,
  type RefundMethod,
  type RefundStatus,
} from "@/lib/enums";
import { formatIstDateTime } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { StatusPill } from "@/components/shared/status-badge";
import { Stepper, type StepperStep } from "@/components/shared/stepper";

import { RefundHeaderActions, RefundNoteForm } from "@/features/refunds/components/refund-actions";
import { getRefundDetail, listRefundActivity } from "@/features/refunds/queries";
import { REFUND_FLOW_STEPS, refundFlowIndex } from "@/features/refunds/schemas";

export const metadata: Metadata = { title: "Refund" };

/**
 * /admin/refunds/[id] (blueprint §14.B6, B4, D13).
 *
 * One screen answers the three questions a refund raises: how much and by
 * which rail, where it is in its own state machine, and what it has already
 * done to the order and the ledger.
 */
export default async function RefundDetailPage({ params }: PageProps<"/admin/refunds/[id]">) {
  const actor = await requirePermission("refunds.view");
  const { id } = await params;

  const refund = await getRefundDetail(id);
  if (!refund) notFound();

  const activity = await listRefundActivity(refund.id);
  const meta = REFUND_STATUS_META[refund.status as RefundStatus];
  const failed = refund.status === "FAILED";

  const steps: StepperStep[] = REFUND_FLOW_STEPS.map((step) => ({
    id: step,
    label: REFUND_STATUS_META[step].label,
    status: failed && step === "PROCESSING" ? "error" : undefined,
  }));

  return (
    <div className="space-y-4">
      <PageHeader
        title={refund.refundNumber}
        description={`${formatPaise(refund.amountPaise)} back to ${refund.customerName} on order ${refund.orderNumber}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href={"/admin/refunds" as Route}>
                <ArrowLeft /> All refunds
              </Link>
            </Button>
            <StatusPill label={meta?.label ?? refund.status} tone={meta?.tone ?? "neutral"} />
          </div>
        }
      />

      <div className="surface space-y-3 p-4">
        <Stepper steps={steps} currentIndex={Math.max(0, refundFlowIndex(refund.status))} className="overflow-x-auto pb-1" />
        <RefundHeaderActions refund={refund} canProcess={can(actor, "refunds.process")} />
        {refund.failureReason ? <p className="text-destructive text-xs">Last failure: {refund.failureReason}</p> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Panel title="Refund" description={refund.reason ?? "No reason recorded"}>
            <dl className="divide-y text-xs">
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <dt className="text-muted-foreground">Amount</dt>
                <dd data-numeric className="text-sm font-semibold">{formatPaise(refund.amountPaise)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <dt className="text-muted-foreground">Method</dt>
                <dd>{REFUND_METHOD_META[refund.method as RefundMethod]?.label ?? refund.method}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <dt className="text-muted-foreground">Provider</dt>
                <dd>{refund.provider ? PAYMENT_PROVIDER_META[refund.provider as PaymentProviderCode]?.label ?? refund.provider : "—"}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <dt className="text-muted-foreground">Gateway refund id</dt>
                <dd className="font-mono">{refund.providerRefundId ?? "—"}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <dt className="text-muted-foreground">Created</dt>
                <dd>{formatIstDateTime(refund.createdAt)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <dt className="text-muted-foreground">Processed</dt>
                <dd>{refund.processedAt ? formatIstDateTime(refund.processedAt) : "—"}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <dt className="text-muted-foreground">Completed</dt>
                <dd>{refund.completedAt ? formatIstDateTime(refund.completedAt) : "—"}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <dt className="text-muted-foreground">Initiated by</dt>
                <dd>{refund.initiatedBy ?? "System"}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <dt className="text-muted-foreground">Approved by</dt>
                <dd>{refund.approvedBy ?? "—"}</dd>
              </div>
            </dl>
          </Panel>

          <Panel title="Notes" description="Internal only — the customer never sees these.">
            {can(actor, "refunds.process") ? <RefundNoteForm refundId={refund.id} /> : null}
            {refund.notes ? (
              <pre className="text-muted-foreground max-h-64 overflow-auto border-t px-4 py-3 text-[11px] whitespace-pre-wrap">{refund.notes}</pre>
            ) : (
              <EmptyState title="No notes yet" description="References and hand-offs recorded here stay with the refund." />
            )}
          </Panel>

          <Panel title="Activity" description="Audit trail (D13)">
            {activity.length === 0 ? (
              <EmptyState title="Nothing recorded yet" description="Approvals and completions are always audited." />
            ) : (
              <ul className="divide-y text-xs">
                {activity.map((row) => (
                  <li key={row.id} className="px-4 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-[11px]">{row.action}</span>
                      <span className="text-muted-foreground text-[11px]">{formatIstDateTime(row.createdAt)}</span>
                    </div>
                    <p className="text-muted-foreground mt-0.5">{row.summary}</p>
                    <p className="text-muted-foreground text-[11px]">{row.actorEmail}</p>
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
                  <Link href={`/admin/orders/${refund.order.id}` as Route} className="text-brand font-mono hover:underline">
                    {refund.order.orderNumber}
                  </Link>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <dt className="text-muted-foreground">Order total</dt>
                <dd data-numeric>{formatPaise(refund.order.totalPaise)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <dt className="text-muted-foreground">Refunded so far</dt>
                <dd data-numeric>{formatPaise(refund.order.refundedPaise)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <dt className="text-muted-foreground">Still refundable</dt>
                <dd data-numeric>{formatPaise(refund.refundableRemainingPaise)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <dt className="text-muted-foreground">Payment</dt>
                <dd>
                  {refund.order.paymentMethod} · {refund.order.paymentStatus}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <dt className="text-muted-foreground">Customer</dt>
                <dd className="text-right">
                  {refund.customerId ? (
                    <Link href={`/admin/customers/${refund.customerId}` as Route} className="hover:underline">
                      {refund.customerName}
                    </Link>
                  ) : (
                    refund.customerName
                  )}
                </dd>
              </div>
            </dl>
          </Panel>

          {refund.returnRequest ? (
            <Panel
              title="Return"
              description={`${refund.returnRequest.quantity} × ${refund.returnRequest.itemTitle}`}
              action={
                can(actor, "returns.view") ? (
                  <Link href={`/admin/returns/${refund.returnRequest.id}` as Route} className="text-brand text-xs hover:underline">
                    Open
                  </Link>
                ) : undefined
              }
            >
              <dl className="divide-y text-xs">
                <div className="flex items-center justify-between gap-3 px-4 py-2">
                  <dt className="text-muted-foreground">RMA</dt>
                  <dd className="font-mono">{refund.returnRequest.rmaNumber}</dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-2">
                  <dt className="text-muted-foreground">Status</dt>
                  <dd>{refund.returnRequest.status}</dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-2">
                  <dt className="text-muted-foreground">Reason</dt>
                  <dd>{refund.returnRequest.reason}</dd>
                </div>
              </dl>
            </Panel>
          ) : null}

          <Panel title="Payments" description="The charge this reverses, and the settlement row it wrote">
            <ul className="divide-y text-xs">
              {refund.sourcePayment ? (
                <li className="flex items-center justify-between gap-3 px-4 py-2">
                  <div className="min-w-0">
                    <p>
                      Charge · {refund.sourcePayment.provider} · {refund.sourcePayment.method}
                    </p>
                    <p className="text-muted-foreground font-mono text-[11px]">{refund.sourcePayment.providerPaymentId ?? "—"}</p>
                  </div>
                  <span data-numeric>{formatPaise(refund.sourcePayment.amountPaise)}</span>
                </li>
              ) : null}
              {refund.settlementPayments.map((payment) => (
                <li key={payment.id} className="flex items-center justify-between gap-3 px-4 py-2">
                  <div className="min-w-0">
                    <p>
                      Refund · {payment.provider} · {payment.method}
                    </p>
                    <p className="text-muted-foreground font-mono text-[11px]">{payment.providerPaymentId ?? "—"}</p>
                  </div>
                  <span data-numeric>−{formatPaise(payment.amountPaise)}</span>
                </li>
              ))}
              {!refund.sourcePayment && refund.settlementPayments.length === 0 ? (
                <li className="text-muted-foreground px-4 py-3">
                  No online payment is attached — this refund is settled by hand and recorded here once completed.
                </li>
              ) : null}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
