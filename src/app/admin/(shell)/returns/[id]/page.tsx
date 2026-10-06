import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { can, requirePermission } from "@/lib/auth/guards";
import { RETURN_REQUEST_STATUS_META, type ReturnRequestStatus } from "@/lib/enums";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { StatusPill } from "@/components/shared/status-badge";

import { ReturnHeaderActions, ReturnNoteForm } from "@/features/returns/components/return-actions";
import {
  ReturnActivityCard,
  ReturnImagesCard,
  ReturnItemCard,
  ReturnPartiesCard,
  ReturnPickupCard,
  ReturnRefundCard,
  ReturnStepper,
  ReturnTimelineCard,
} from "@/features/returns/components/return-cards";
import {
  getReturnDetail,
  getReturnPolicySettings,
  getReturnRefundCap,
  listPickupPartners,
  listReturnActivity,
} from "@/features/returns/queries";
import { isSellerFault } from "@/features/returns/service";

export const metadata: Metadata = { title: "Return request" };

/**
 * /admin/returns/[id] (blueprint §14.C4, C3, B5, B6).
 *
 * The header carries the flow as a Stepper and only the moves the state
 * machine actually allows; the cards below are the evidence an operator needs
 * to make that decision — what came back, who sent it, what the customer
 * photographed, where the money stands and who has touched the RMA.
 */
export default async function ReturnDetailPage({ params }: PageProps<"/admin/returns/[id]">) {
  const actor = await requirePermission("returns.view");
  const { id } = await params;

  const detail = await getReturnDetail(id);
  if (!detail) notFound();

  const [partners, activity, cap, policy] = await Promise.all([
    listPickupPartners(),
    listReturnActivity(detail.id, detail.refund?.id ?? null),
    getReturnRefundCap(detail.id, detail.order.id),
    getReturnPolicySettings(),
  ]);

  const meta = RETURN_REQUEST_STATUS_META[detail.status as ReturnRequestStatus];

  return (
    <div className="space-y-4">
      <PageHeader
        title={detail.rmaNumber}
        description={`${detail.quantity} × ${detail.item.title} from order ${detail.order.orderNumber}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href={"/admin/returns" as Route}>
                <ArrowLeft /> All returns
              </Link>
            </Button>
            <StatusPill label={meta?.label ?? detail.status} tone={meta?.tone ?? "neutral"} />
          </div>
        }
      />

      <div className="surface space-y-3 p-4">
        <ReturnStepper status={detail.status} />
        <ReturnHeaderActions
          detail={detail}
          partners={partners}
          capPaise={cap.capPaise}
          capNotes={cap.notes}
          canManage={can(actor, "returns.manage")}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <ReturnItemCard detail={detail} />
          <ReturnImagesCard imageUrls={detail.imageUrls} />
          <Panel title="Notes and events" description="Internal notes are marked with a lock and never reach the customer.">
            {can(actor, "returns.manage") ? <ReturnNoteForm returnRequestId={detail.id} /> : null}
            <ReturnTimelineCard detail={detail} />
          </Panel>
        </div>

        <div className="space-y-4">
          <ReturnPartiesCard detail={detail} />
          <ReturnPickupCard
            detail={detail}
            pickupFeePaise={policy.pickupFeePaise}
            customerPaysPickup={policy.customerPaysPickup}
            sellerFault={isSellerFault(detail.reason)}
          />
          <ReturnRefundCard detail={detail} canViewRefunds={can(actor, "refunds.view")} />
          {detail.replacementShipment ? (
            <Panel title="Replacement" description={`Shipment ${detail.replacementShipment.shipmentNumber}`}>
              <dl className="divide-y text-xs">
                <div className="flex items-center justify-between gap-3 px-4 py-2">
                  <dt className="text-muted-foreground">Status</dt>
                  <dd>{detail.replacementShipment.status}</dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-2">
                  <dt className="text-muted-foreground">Carrier</dt>
                  <dd>{detail.replacementShipment.carrierName ?? "—"}</dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-2">
                  <dt className="text-muted-foreground">Tracking</dt>
                  <dd className="font-mono">{detail.replacementShipment.trackingNumber ?? "—"}</dd>
                </div>
              </dl>
            </Panel>
          ) : null}
          <ReturnActivityCard rows={activity} />
        </div>
      </div>
    </div>
  );
}
