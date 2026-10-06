import Link from "next/link";
import type { Route } from "next";
import { AlertTriangle, ExternalLink, Truck } from "lucide-react";

import {
  QC_DISPOSITION_META,
  REFUND_METHOD_META,
  REFUND_STATUS_META,
  RETURN_REASON_META,
  RETURN_REQUEST_STATUS_META,
  RETURN_RESOLUTION_META,
  type QcDisposition,
  type RefundMethod,
  type RefundStatus,
  type ReturnReason,
  type ReturnRequestStatus,
  type ReturnResolution,
} from "@/lib/enums";
import { formatIstDate, formatIstDateTime } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import { Panel } from "@/components/shared/panel";
import { StatusPill } from "@/components/shared/status-badge";
import { StatusTimeline, type TimelineEvent } from "@/components/shared/status-timeline";
import { Stepper, type StepperStep } from "@/components/shared/stepper";
import { EmptyState } from "@/components/shared/empty-state";

import { RETURN_FLOW_STEPS, returnFlowIndex } from "../schemas";
import type { ReturnActivityRow } from "../queries";
import type { ReturnDetail } from "../types";

/**
 * The read-only half of the RMA detail page. Server components: nothing here
 * needs state, and rendering them on the server keeps the client bundle to the
 * dialogs alone.
 */

export function ReturnStepper({ status }: { status: string }) {
  const index = returnFlowIndex(status);
  const steps: StepperStep[] = RETURN_FLOW_STEPS.map((step, position) => ({
    id: step,
    label: RETURN_REQUEST_STATUS_META[step].label,
    status:
      status === "QC_FAILED" && step === "QC_PASSED"
        ? "error"
        : status === "REJECTED" || status === "CANCELLED"
          ? position === 0
            ? "error"
            : "upcoming"
          : undefined,
  }));
  return <Stepper steps={steps} currentIndex={index < 0 ? 0 : index} className="overflow-x-auto pb-1" />;
}

export function ReturnItemCard({ detail }: { detail: ReturnDetail }) {
  const { item } = detail;
  return (
    <Panel title="What came back" description={`${detail.quantity} of ${item.quantity} unit(s) on this line`}>
      <div className="flex gap-3 p-4">
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- order snapshots store an absolute URL, not a Next image source.
          <img src={item.imageUrl} alt="" className="bg-muted size-16 shrink-0 rounded border object-cover" />
        ) : (
          <span className="bg-muted text-muted-foreground flex size-16 shrink-0 items-center justify-center rounded border text-xs">
            {item.title.slice(0, 2).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium">
            {item.productId ? (
              <Link href={`/admin/products/${item.productId}` as Route} className="hover:underline">
                {item.title}
              </Link>
            ) : (
              item.title
            )}
          </p>
          <p className="text-muted-foreground text-xs">
            {[item.variant, item.sku].filter(Boolean).join(" · ") || "No variant"}
          </p>
          <dl className="text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-1 pt-1 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-[11px]">Unit price</dt>
              <dd data-numeric className="text-foreground">{formatPaise(item.unitPricePaise)}</dd>
            </div>
            <div>
              <dt className="text-[11px]">Line total</dt>
              <dd data-numeric className="text-foreground">{formatPaise(item.lineTotalPaise)}</dd>
            </div>
            <div>
              <dt className="text-[11px]">Returned so far</dt>
              <dd data-numeric className="text-foreground">
                {item.returnedQty} / {item.quantity}
              </dd>
            </div>
            <div>
              <dt className="text-[11px]">Refunded so far</dt>
              <dd data-numeric className="text-foreground">{formatPaise(item.refundedPaise)}</dd>
            </div>
          </dl>
          {item.deliveredAt ? (
            <p className="text-muted-foreground text-[11px]">Delivered {formatIstDate(item.deliveredAt)}.</p>
          ) : (
            <p className="text-warning text-[11px]">This line has no delivery date recorded.</p>
          )}
        </div>
      </div>

      {item.customization.length > 0 ? (
        <div className="border-t px-4 py-3">
          <p className="text-muted-foreground mb-1.5 text-[11px] font-medium uppercase">Personalisation as ordered</p>
          <dl className="grid gap-1 text-xs sm:grid-cols-2">
            {item.customization.map((entry) => (
              <div key={entry.label} className="flex gap-2">
                <dt className="text-muted-foreground">{entry.label}:</dt>
                <dd className="min-w-0 break-words">{entry.value || "—"}</dd>
              </div>
            ))}
          </dl>
          <p className="text-muted-foreground mt-1.5 text-[11px]">
            A personalised item is rarely resellable — check the disposition before passing QC.
          </p>
        </div>
      ) : null}

      <div className="border-t px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill
            label={RETURN_REASON_META[detail.reason as ReturnReason]?.label ?? detail.reason}
            tone={RETURN_REASON_META[detail.reason as ReturnReason]?.tone ?? "neutral"}
          />
          {detail.resolution || detail.requestedResolution ? (
            <StatusPill
              label={`${detail.resolution ? "Resolution" : "Requested"}: ${
                RETURN_RESOLUTION_META[(detail.resolution ?? detail.requestedResolution) as ReturnResolution]?.label ?? ""
              }`}
              tone="info"
            />
          ) : null}
          {detail.qcDisposition ? (
            <StatusPill
              label={`QC: ${QC_DISPOSITION_META[detail.qcDisposition as QcDisposition]?.label ?? detail.qcDisposition}`}
              tone={QC_DISPOSITION_META[detail.qcDisposition as QcDisposition]?.tone ?? "neutral"}
            />
          ) : null}
        </div>
        {detail.reasonDetail ? <p className="mt-2 text-xs">{detail.reasonDetail}</p> : null}
        {detail.qcNote ? <p className="text-muted-foreground mt-2 text-xs">QC note: {detail.qcNote}</p> : null}
        {detail.rejectionReason ? <p className="text-destructive mt-2 text-xs">Rejected: {detail.rejectionReason}</p> : null}
      </div>
    </Panel>
  );
}

export function ReturnImagesCard({ imageUrls }: { imageUrls: string[] }) {
  if (imageUrls.length === 0) return null;
  return (
    <Panel title="Customer photos" description={`${imageUrls.length} image(s) sent with the request`}>
      <div className="flex flex-wrap gap-2 p-4">
        {imageUrls.map((url) => (
          <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element -- customer uploads carry an absolute storage URL. */}
            <img src={url} alt="Customer photo of the returned item" className="bg-muted size-24 rounded border object-cover" loading="lazy" />
          </a>
        ))}
      </div>
    </Panel>
  );
}

export function ReturnPartiesCard({ detail }: { detail: ReturnDetail }) {
  return (
    <Panel title="Order and customer">
      <dl className="divide-y text-xs">
        <div className="flex items-center justify-between gap-3 px-4 py-2">
          <dt className="text-muted-foreground">Order</dt>
          <dd>
            <Link href={`/admin/orders/${detail.order.id}` as Route} className="text-brand font-mono hover:underline">
              {detail.order.orderNumber}
            </Link>
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-2">
          <dt className="text-muted-foreground">Order status</dt>
          <dd>{detail.order.status}</dd>
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-2">
          <dt className="text-muted-foreground">Payment</dt>
          <dd>
            {detail.order.paymentMethod} · {detail.order.paymentStatus}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-2">
          <dt className="text-muted-foreground">Customer</dt>
          <dd className="text-right">
            {detail.customer.id ? (
              <Link href={`/admin/customers/${detail.customer.id}` as Route} className="hover:underline">
                {detail.customer.name}
              </Link>
            ) : (
              detail.customer.name
            )}
            <div className="text-muted-foreground">{detail.customer.email}</div>
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-2">
          <dt className="text-muted-foreground">Seller</dt>
          <dd>
            {detail.seller ? (
              <Link href={`/admin/sellers/${detail.seller.id}` as Route} className="hover:underline">
                {detail.seller.name}
              </Link>
            ) : (
              "Platform"
            )}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-2">
          <dt className="text-muted-foreground">Requested</dt>
          <dd>{formatIstDateTime(detail.requestedAt)}</dd>
        </div>
        {detail.handledBy ? (
          <div className="flex items-center justify-between gap-3 px-4 py-2">
            <dt className="text-muted-foreground">Handled by</dt>
            <dd>{detail.handledBy}</dd>
          </div>
        ) : null}
      </dl>
    </Panel>
  );
}

export function ReturnPickupCard({ detail, pickupFeePaise, customerPaysPickup, sellerFault }: {
  detail: ReturnDetail;
  pickupFeePaise: number;
  customerPaysPickup: boolean;
  sellerFault: boolean;
}) {
  const charged = sellerFault && pickupFeePaise > 0 && detail.receivedAt !== null;
  return (
    <Panel title="Pickup" description={detail.pickupScheduledAt ? formatIstDate(detail.pickupScheduledAt) : "Not scheduled yet"}>
      <dl className="divide-y text-xs">
        <div className="flex items-center justify-between gap-3 px-4 py-2">
          <dt className="text-muted-foreground">Partner</dt>
          <dd>{detail.pickupPartnerName ?? "—"}</dd>
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-2">
          <dt className="text-muted-foreground">Tracking</dt>
          <dd className="font-mono">{detail.pickupTrackingNumber ?? "—"}</dd>
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-2">
          <dt className="text-muted-foreground">Received</dt>
          <dd>{detail.receivedAt ? formatIstDateTime(detail.receivedAt) : "—"}</dd>
        </div>
      </dl>

      {pickupFeePaise > 0 ? (
        <div className="text-muted-foreground flex gap-2 border-t px-4 py-3 text-[11px]">
          {sellerFault ? <AlertTriangle className="text-warning size-3.5 shrink-0" /> : <Truck className="size-3.5 shrink-0" />}
          <p>
            {sellerFault
              ? `Seller-fault reason: the ${formatPaise(pickupFeePaise)} pickup fee is charged to ${
                  detail.seller?.name ?? "the seller"
                } as a CHARGE ledger entry when the goods are marked received${charged ? " — already charged." : "."}`
              : customerPaysPickup
                ? `Customer-fault reason: ${formatPaise(pickupFeePaise)} is deducted from the refund.`
                : `The platform absorbs the ${formatPaise(pickupFeePaise)} pickup fee for this reason.`}
          </p>
        </div>
      ) : null}
    </Panel>
  );
}

export function ReturnRefundCard({ detail, canViewRefunds }: { detail: ReturnDetail; canViewRefunds: boolean }) {
  return (
    <Panel
      title="Refund"
      description={detail.refund ? "Created from this RMA" : "No refund has been created yet"}
      action={
        detail.refund && canViewRefunds ? (
          <Link href={`/admin/refunds/${detail.refund.id}` as Route} className="text-brand inline-flex items-center gap-1 text-xs hover:underline">
            Open <ExternalLink className="size-3" />
          </Link>
        ) : undefined
      }
    >
      {detail.refund ? (
        <dl className="divide-y text-xs">
          <div className="flex items-center justify-between gap-3 px-4 py-2">
            <dt className="text-muted-foreground">Refund</dt>
            <dd className="font-mono">{detail.refund.refundNumber}</dd>
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-2">
            <dt className="text-muted-foreground">Amount</dt>
            <dd data-numeric>{formatPaise(detail.refund.amountPaise)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-2">
            <dt className="text-muted-foreground">Method</dt>
            <dd>{REFUND_METHOD_META[detail.refund.method as RefundMethod]?.label ?? detail.refund.method}</dd>
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-2">
            <dt className="text-muted-foreground">Status</dt>
            <dd>
              <StatusPill
                label={REFUND_STATUS_META[detail.refund.status as RefundStatus]?.label ?? detail.refund.status}
                tone={REFUND_STATUS_META[detail.refund.status as RefundStatus]?.tone ?? "neutral"}
              />
            </dd>
          </div>
          {detail.refund.completedAt ? (
            <div className="flex items-center justify-between gap-3 px-4 py-2">
              <dt className="text-muted-foreground">Completed</dt>
              <dd>{formatIstDateTime(detail.refund.completedAt)}</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="text-muted-foreground px-4 py-3 text-xs">
          A refund is created when the RMA reaches “Initiate refund”. It then has to be approved and processed under Refunds.
        </p>
      )}
    </Panel>
  );
}

export function ReturnTimelineCard({ detail }: { detail: ReturnDetail }) {
  const events: TimelineEvent[] = detail.events.map((event) => ({
    id: event.id,
    title: event.toStatus ? RETURN_REQUEST_STATUS_META[event.toStatus as ReturnRequestStatus]?.label ?? event.toStatus : "Note",
    description: event.message,
    at: event.createdAt,
    actor: event.actor,
    isInternal: event.isInternal,
    tone: event.toStatus ? RETURN_REQUEST_STATUS_META[event.toStatus as ReturnRequestStatus]?.tone ?? "neutral" : "neutral",
  }));
  return (
    <div className="px-4 pb-4">
      <StatusTimeline events={events} emptyText="No events yet." />
    </div>
  );
}

export function ReturnActivityCard({ rows }: { rows: ReturnActivityRow[] }) {
  return (
    <Panel title="Activity" description="Audit trail for this RMA and its refund">
      {rows.length === 0 ? (
        <EmptyState title="Nothing recorded yet" description="Every status change writes an audit row." />
      ) : (
        <ul className="divide-y text-xs">
          {rows.map((row) => (
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
  );
}
