"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import {
  QC_DISPOSITIONS,
  QC_DISPOSITION_META,
  RETURN_REQUEST_STATUS_META,
  RETURN_REQUEST_TRANSITIONS,
  type QcDisposition,
  type ReturnRequestStatus,
} from "@/lib/enums";
import { formatPaise } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MoneyInput } from "@/components/shared/money-input";
import { useActionToast } from "@/components/shared/use-action-toast";

import { addReturnNoteAction, transitionReturnAction } from "../actions";
import { SELECTABLE_RETURN_REFUND_METHODS } from "../schemas";
import type { PickupPartnerOption, ReturnDetail } from "../types";

/**
 * Every move in the C4 flow, as one dialog whose fields depend on the target.
 *
 * A dialog per status would be nine near-identical files; a single dialog that
 * knows which fields each target needs keeps the rules (a rejection needs a
 * reason, a failed QC needs a disposition, a refund needs an amount within the
 * cap) in one readable place — and the server re-validates all of them anyway.
 */

const NO_PARTNER = "__none";

type Target = ReturnRequestStatus;

const TARGET_LABEL: Partial<Record<Target, string>> = {
  UNDER_REVIEW: "Move to review",
  APPROVED: "Approve",
  REJECTED: "Reject",
  PICKUP_SCHEDULED: "Schedule pickup",
  RECEIVED: "Mark received",
  QC_PASSED: "QC pass",
  QC_FAILED: "QC fail",
  REFUND_INITIATED: "Initiate refund",
  REFUND_COMPLETED: "Mark refund completed",
  REPLACEMENT_SHIPPED: "Replacement shipped",
  CLOSED: "Close",
  CANCELLED: "Cancel RMA",
};

const TARGET_HINT: Partial<Record<Target, string>> = {
  UNDER_REVIEW: "Takes the request off the queue and onto your desk. Nothing moves yet.",
  APPROVED: "Tells the customer the return is accepted and emails them the RMA. Choose what they will get.",
  REJECTED: "The customer sees this reason. The RMA closes itself immediately afterwards.",
  PICKUP_SCHEDULED: "Records who is collecting and when, so the customer can be told.",
  RECEIVED: "The goods are back with us. A seller-fault return is charged the pickup fee at this point.",
  QC_PASSED: "The units go back into sellable stock and the line counts as returned.",
  QC_FAILED: "Choose what happens to the goods; the disposition decides whether stock moves.",
  REFUND_INITIATED: "Creates a pending refund. It still has to be approved and processed under Refunds.",
  REFUND_COMPLETED: "Only possible once the linked refund has actually settled.",
  REPLACEMENT_SHIPPED: "Creates a second shipment on the same order and takes the replacement out of stock.",
  CLOSED: "Files the RMA away. Nothing further happens automatically.",
  CANCELLED: "Only before the goods are collected — after that, close the RMA instead.",
};

export function returnTargets(status: string): Target[] {
  return [...(RETURN_REQUEST_TRANSITIONS[status as ReturnRequestStatus] ?? [])];
}

export function ReturnTransitionDialog({
  detail,
  target,
  partners,
  capPaise,
  capNotes,
  open,
  onOpenChange,
}: {
  detail: ReturnDetail;
  target: Target | null;
  partners: PickupPartnerOption[];
  capPaise: number;
  capNotes: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { run, pending } = useActionToast();

  const [resolution, setResolution] = React.useState<"REFUND" | "REPLACEMENT">(
    detail.requestedResolution === "REPLACEMENT" ? "REPLACEMENT" : "REFUND",
  );
  const [rejectionReason, setRejectionReason] = React.useState("");
  const [partnerId, setPartnerId] = React.useState<string>(detail.pickupPartnerId ?? NO_PARTNER);
  const [pickupDate, setPickupDate] = React.useState("");
  const [tracking, setTracking] = React.useState(detail.pickupTrackingNumber ?? "");
  const [qcNote, setQcNote] = React.useState("");
  const [disposition, setDisposition] = React.useState<QcDisposition>("RESTOCK");
  const [amountPaise, setAmountPaise] = React.useState<number | null>(capPaise);
  const [refundMethod, setRefundMethod] = React.useState<string>(detail.order.paymentMethod === "COD" ? "BANK_TRANSFER" : "ORIGINAL");
  const [carrier, setCarrier] = React.useState("");
  const [note, setNote] = React.useState("");

  // Reopening for a different target must not carry the previous amount over.
  // "Previous prop in state" is the React-sanctioned way to reset state on a
  // prop change without an effect and without a cascading second render.
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setAmountPaise(capPaise);
  }

  if (!target) return null;

  const destructive = target === "REJECTED" || target === "CANCELLED" || target === "QC_FAILED";
  const submit = async () => {
    const result = await run(() =>
      transitionReturnAction(detail.id, {
        toStatus: target,
        note: note || undefined,
        isInternal: true,
        resolution: target === "APPROVED" ? resolution : undefined,
        rejectionReason: target === "REJECTED" ? rejectionReason : undefined,
        pickupPartnerId: target === "PICKUP_SCHEDULED" ? (partnerId === NO_PARTNER ? null : partnerId) : undefined,
        pickupScheduledAt: target === "PICKUP_SCHEDULED" && pickupDate ? pickupDate : undefined,
        pickupTrackingNumber: target === "PICKUP_SCHEDULED" ? tracking || undefined : undefined,
        qcNote: target === "QC_PASSED" || target === "QC_FAILED" ? qcNote || undefined : undefined,
        qcDisposition: target === "QC_FAILED" ? disposition : undefined,
        amountPaise: target === "REFUND_INITIATED" ? (amountPaise ?? undefined) : undefined,
        refundMethod: target === "REFUND_INITIATED" ? (refundMethod as "ORIGINAL" | "BANK_TRANSFER" | "MANUAL") : undefined,
        replacement:
          target === "REPLACEMENT_SHIPPED"
            ? { partnerId: partnerId === NO_PARTNER ? null : partnerId, carrierName: carrier || undefined, trackingNumber: tracking || undefined }
            : undefined,
      }),
    );
    if (result.ok) {
      onOpenChange(false);
      setNote("");
      router.refresh();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {TARGET_LABEL[target] ?? RETURN_REQUEST_STATUS_META[target].label} · {detail.rmaNumber}
          </DialogTitle>
          <DialogDescription>{TARGET_HINT[target]}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {target === "APPROVED" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="rma-resolution">Resolution</Label>
              <Select value={resolution} onValueChange={(value) => setResolution(value as "REFUND" | "REPLACEMENT")}>
                <SelectTrigger id="rma-resolution">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="REFUND">Refund the customer</SelectItem>
                  <SelectItem value="REPLACEMENT">Send a replacement</SelectItem>
                </SelectContent>
              </Select>
              {detail.requestedResolution ? (
                <p className="text-muted-foreground text-[11px]">The customer asked for a {detail.requestedResolution.toLowerCase()}.</p>
              ) : null}
            </div>
          ) : null}

          {target === "REJECTED" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="rma-reject">Reason (the customer sees this)</Label>
              <Textarea
                id="rma-reject"
                value={rejectionReason}
                onChange={(event) => setRejectionReason(event.target.value)}
                rows={3}
                placeholder="e.g. The item shows signs of use beyond inspection."
              />
            </div>
          ) : null}

          {target === "PICKUP_SCHEDULED" || target === "REPLACEMENT_SHIPPED" ? (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="rma-partner">{target === "PICKUP_SCHEDULED" ? "Pickup partner" : "Courier"}</Label>
                <Select value={partnerId} onValueChange={setPartnerId}>
                  <SelectTrigger id="rma-partner">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PARTNER}>Not assigned</SelectItem>
                    {partners.map((partner) => (
                      <SelectItem key={partner.id} value={partner.id}>
                        {partner.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {target === "PICKUP_SCHEDULED" ? (
                <div className="grid gap-1.5">
                  <Label htmlFor="rma-pickup-date">Pickup date</Label>
                  <Input id="rma-pickup-date" type="date" value={pickupDate} onChange={(event) => setPickupDate(event.target.value)} />
                </div>
              ) : (
                <div className="grid gap-1.5">
                  <Label htmlFor="rma-carrier">Carrier name (optional)</Label>
                  <Input id="rma-carrier" value={carrier} onChange={(event) => setCarrier(event.target.value)} placeholder="Overrides the partner name" />
                </div>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="rma-tracking">Tracking number</Label>
                <Input id="rma-tracking" value={tracking} onChange={(event) => setTracking(event.target.value)} placeholder="Optional" />
              </div>
            </>
          ) : null}

          {target === "QC_PASSED" || target === "QC_FAILED" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="rma-qc-note">QC note</Label>
              <Textarea id="rma-qc-note" value={qcNote} onChange={(event) => setQcNote(event.target.value)} rows={2} placeholder="What did the inspection find?" />
            </div>
          ) : null}

          {target === "QC_FAILED" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="rma-disposition">Disposition</Label>
              <Select value={disposition} onValueChange={(value) => setDisposition(value as QcDisposition)}>
                <SelectTrigger id="rma-disposition">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QC_DISPOSITIONS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {QC_DISPOSITION_META[value].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-[11px]">{QC_DISPOSITION_META[disposition].description ?? "No stock movement."}</p>
            </div>
          ) : null}

          {target === "REFUND_INITIATED" ? (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="rma-amount">Refund amount</Label>
                <MoneyInput id="rma-amount" valuePaise={amountPaise} onChangePaise={setAmountPaise} allowEmpty={false} />
                <p className="text-muted-foreground text-[11px]">Maximum {formatPaise(capPaise)}.</p>
                <ul className="text-muted-foreground list-disc space-y-0.5 pl-4 text-[11px]">
                  {capNotes.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="rma-method">Method</Label>
                <Select value={refundMethod} onValueChange={setRefundMethod}>
                  <SelectTrigger id="rma-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SELECTABLE_RETURN_REFUND_METHODS.map((method) => (
                      <SelectItem key={method.value} value={method.value}>
                        {method.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {detail.order.paymentMethod === "COD" ? (
                  <p className="text-muted-foreground text-[11px]">
                    This was a cash-on-delivery order, so the money goes back by bank transfer — there is no card to credit.
                  </p>
                ) : null}
              </div>
            </>
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor="rma-note">Internal note (optional)</Label>
            <Textarea id="rma-note" value={note} onChange={(event) => setNote(event.target.value)} rows={2} placeholder="Anything the next person should know" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={() => void submit()}
            disabled={pending || (target === "REJECTED" && rejectionReason.trim().length < 2)}
          >
            {TARGET_LABEL[target] ?? RETURN_REQUEST_STATUS_META[target].label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The buttons in the page header, one per legal move from the current state. */
export function ReturnHeaderActions({
  detail,
  partners,
  capPaise,
  capNotes,
  canManage,
}: {
  detail: ReturnDetail;
  partners: PickupPartnerOption[];
  capPaise: number;
  capNotes: string[];
  canManage: boolean;
}) {
  const [target, setTarget] = React.useState<Target | null>(null);
  const targets = returnTargets(detail.status);

  if (!canManage || targets.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {targets.map((next, index) => (
        <Button
          key={next}
          size="sm"
          variant={index === 0 ? "default" : next === "CANCELLED" || next === "REJECTED" ? "outline" : "secondary"}
          onClick={() => setTarget(next)}
        >
          {TARGET_LABEL[next] ?? RETURN_REQUEST_STATUS_META[next].label}
        </Button>
      ))}
      <ReturnTransitionDialog
        detail={detail}
        target={target}
        partners={partners}
        capPaise={capPaise}
        capNotes={capNotes}
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
      />
    </div>
  );
}

/** Internal notes and customer-visible messages on one RMA. */
export function ReturnNoteForm({ returnRequestId }: { returnRequestId: string }) {
  const router = useRouter();
  const { run, pending } = useActionToast();
  const [message, setMessage] = React.useState("");
  const [isInternal, setIsInternal] = React.useState(true);

  const submit = async () => {
    const result = await run(() => addReturnNoteAction(returnRequestId, { message, isInternal }));
    if (result.ok) {
      setMessage("");
      router.refresh();
    }
  };

  return (
    <div className="space-y-2 p-4">
      <Textarea
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        rows={2}
        placeholder="Add a note to this RMA"
        aria-label="Note"
      />
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs">
          <Switch checked={isInternal} onCheckedChange={setIsInternal} aria-label="Internal note" />
          <span className="text-muted-foreground">{isInternal ? "Internal — staff only" : "Visible to the customer"}</span>
        </label>
        <Button size="sm" onClick={() => void submit()} disabled={pending || message.trim().length < 2}>
          Add note
        </Button>
      </div>
    </div>
  );
}
