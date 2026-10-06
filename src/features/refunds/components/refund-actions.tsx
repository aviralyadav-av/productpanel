"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { REFUND_STATUS_META, REFUND_TRANSITIONS, type RefundStatus } from "@/lib/enums";
import { formatPaise } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useActionToast } from "@/components/shared/use-action-toast";

import { addRefundNoteAction, transitionRefundAction } from "../actions";
import { isGatewayProvider } from "../schemas";
import type { RefundDetail } from "../types";

/**
 * The refund's own state machine, as buttons.
 *
 * Processing is the interesting one: for an ORIGINAL refund on a gateway
 * payment the server calls the provider, so the dialog says so and the button
 * stays disabled until the round trip finishes. A manual or bank transfer
 * instead demands a reference, because "processed" with no UTR is a claim
 * nobody can check later.
 */

const LABEL: Partial<Record<RefundStatus, string>> = {
  APPROVED: "Approve",
  PROCESSING: "Process",
  COMPLETED: "Mark completed",
  FAILED: "Mark failed",
  CANCELLED: "Cancel refund",
  PENDING: "Retry",
};

function hintFor(target: RefundStatus, refund: RefundDetail): string {
  const online = refund.method === "ORIGINAL" && isGatewayProvider(refund.provider);
  switch (target) {
    case "APPROVED":
      return "Confirms the amount is correct. No money moves yet.";
    case "PROCESSING":
      return online
        ? `${refund.provider} will be asked to return ${formatPaise(refund.amountPaise)} to the original payment method. Instant gateways complete straight away; the rest stay in processing until they settle.`
        : "Record the bank or wallet reference for the transfer you are making.";
    case "COMPLETED":
      return "The money has reached the customer: the seller's earnings are reversed, the order's payment status is re-derived and the customer is emailed.";
    case "FAILED":
      return "Records why it failed. A failed refund can be retried, which sends it back to pending.";
    case "CANCELLED":
      return "Drops the refund and frees the amount for another one. Nothing is sent to the customer.";
    case "PENDING":
      return "Puts the refund back in the queue for another attempt.";
    default:
      return "";
  }
}

export function RefundTransitionDialog({
  refund,
  target,
  open,
  onOpenChange,
}: {
  refund: RefundDetail;
  target: RefundStatus | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { run, pending } = useActionToast();
  const [reference, setReference] = React.useState("");
  const [failureReason, setFailureReason] = React.useState("");
  const [note, setNote] = React.useState("");

  if (!target) return null;

  const online = refund.method === "ORIGINAL" && isGatewayProvider(refund.provider);
  const needsReference = (target === "PROCESSING" && !online) || target === "COMPLETED";
  const needsReason = target === "FAILED";

  const submit = async () => {
    const result = await run(() =>
      transitionRefundAction(refund.id, {
        toStatus: target,
        reference: reference || undefined,
        failureReason: failureReason || undefined,
        note: note || undefined,
      }),
    );
    if (result.ok) {
      onOpenChange(false);
      setReference("");
      setFailureReason("");
      setNote("");
      router.refresh();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {LABEL[target] ?? REFUND_STATUS_META[target].label} · {refund.refundNumber}
          </DialogTitle>
          <DialogDescription>{hintFor(target, refund)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {needsReference ? (
            <div className="grid gap-1.5">
              <Label htmlFor="refund-reference">Reference {target === "COMPLETED" ? "(optional)" : ""}</Label>
              <Input
                id="refund-reference"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="Bank UTR, wallet transaction id…"
                className="font-mono"
              />
            </div>
          ) : null}

          {needsReason ? (
            <div className="grid gap-1.5">
              <Label htmlFor="refund-failure">Why did it fail?</Label>
              <Textarea id="refund-failure" value={failureReason} onChange={(event) => setFailureReason(event.target.value)} rows={2} />
            </div>
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor="refund-note">Internal note (optional)</Label>
            <Textarea id="refund-note" value={note} onChange={(event) => setNote(event.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Close
          </Button>
          <Button
            variant={target === "FAILED" || target === "CANCELLED" ? "destructive" : "default"}
            onClick={() => void submit()}
            disabled={
              pending ||
              (needsReason && failureReason.trim().length < 2) ||
              (target === "PROCESSING" && !online && reference.trim().length < 2)
            }
          >
            {pending && target === "PROCESSING" && online ? "Talking to the gateway…" : LABEL[target] ?? REFUND_STATUS_META[target].label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RefundHeaderActions({ refund, canProcess }: { refund: RefundDetail; canProcess: boolean }) {
  const [target, setTarget] = React.useState<RefundStatus | null>(null);
  const targets = [...(REFUND_TRANSITIONS[refund.status as RefundStatus] ?? [])];

  if (!canProcess || targets.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {targets.map((next, index) => (
        <Button
          key={next}
          size="sm"
          variant={index === 0 ? "default" : next === "CANCELLED" || next === "FAILED" ? "outline" : "secondary"}
          onClick={() => setTarget(next)}
        >
          {LABEL[next] ?? REFUND_STATUS_META[next].label}
        </Button>
      ))}
      <RefundTransitionDialog
        refund={refund}
        target={target}
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
      />
    </div>
  );
}

export function RefundNoteForm({ refundId }: { refundId: string }) {
  const router = useRouter();
  const { run, pending } = useActionToast();
  const [message, setMessage] = React.useState("");

  const submit = async () => {
    const result = await run(() => addRefundNoteAction(refundId, { message }));
    if (result.ok) {
      setMessage("");
      router.refresh();
    }
  };

  return (
    <div className="space-y-2 p-4">
      <Textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={2} placeholder="Add an internal note" aria-label="Note" />
      <div className="flex justify-end">
        <Button size="sm" onClick={() => void submit()} disabled={pending || message.trim().length < 2}>
          Add note
        </Button>
      </div>
    </div>
  );
}
