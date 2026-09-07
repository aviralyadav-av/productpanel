"use client";

import * as React from "react";
import { Ban, LoaderCircle, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ORDER_STATUSES,
  ORDER_STATUS_META,
  ORDER_TRANSITIONS,
  PAYMENT_STATUS_META,
  TERMINAL_ORDER_STATUSES,
  canTransition,
  type OrderStatus,
  type PaymentStatus,
} from "@/lib/enums";
import { formatPaise, paiseToRupees } from "@/lib/money";
import {
  changeOrderStatus,
  markPaymentStatus,
  recordRefund,
} from "@/features/orders/actions";
import {
  CANCEL_REASONS,
  MANUAL_PAYMENT_STATUSES,
} from "@/features/orders/schemas";

/**
 * The state machine, rendered.
 *
 * Every status is a button, always, including the ones this order cannot reach.
 * Hiding them would leave an operator guessing whether "Shipped" is missing
 * because the order is not ready or because the panel is broken; disabling them
 * with the reason attached answers that without a support call.
 */
export function OrderStatusActions({
  orderId,
  status,
}: {
  orderId: string;
  status: OrderStatus;
}) {
  const [pending, startTransition] = React.useTransition();
  const [confirming, setConfirming] = React.useState<OrderStatus | null>(null);
  const [reason, setReason] = React.useState<string>("");
  const [detail, setDetail] = React.useState<string>("");
  const [error, setError] = React.useState<string | null>(null);

  const isTerminal = TERMINAL_ORDER_STATUSES.includes(status);
  const allowed = ORDER_TRANSITIONS[status] ?? [];

  function submit(target: OrderStatus, extra?: { reason?: string; detail?: string }) {
    setError(null);
    startTransition(async () => {
      const result = await changeOrderStatus({
        orderId,
        toStatus: target,
        ...extra,
      });

      if (result.ok) {
        toast.success(result.message ?? "Order updated.");
        setConfirming(null);
        setReason("");
        setDetail("");
        return;
      }

      setError(result.fieldErrors?.reason ?? result.error);
      if (confirming === null) toast.error(result.error);
    });
  }

  function onPick(target: OrderStatus) {
    // Cancelling and returning restock inventory and cannot be undone, so both
    // go through a confirmation. Everything else applies immediately.
    if (TERMINAL_ORDER_STATUSES.includes(target)) {
      setError(null);
      setReason("");
      setDetail("");
      setConfirming(target);
      return;
    }
    submit(target);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground mr-0.5 text-[11px] font-medium tracking-wide uppercase">
          Move to
        </span>

        {ORDER_STATUSES.filter((target) => target !== status).map((target) => {
          const reachable = canTransition(status, target);
          const meta = ORDER_STATUS_META[target];
          const isDestructive = TERMINAL_ORDER_STATUSES.includes(target);

          const button = (
            <Button
              key={target}
              size="xs"
              variant={
                isDestructive
                  ? "destructive"
                  : allowed[0] === target
                    ? "default"
                    : "outline"
              }
              disabled={!reachable || pending}
              onClick={() => onPick(target)}
            >
              {target === "CANCELLED" ? <Ban /> : null}
              {target === "RETURNED" ? <Undo2 /> : null}
              {meta.label}
            </Button>
          );

          if (reachable) return button;

          return (
            <Tooltip key={target}>
              {/* Radix cannot hear pointer events on a disabled button, so the
                  trigger is the wrapper. */}
              <TooltipTrigger asChild>
                <span tabIndex={0} className="inline-flex">
                  {button}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {isTerminal
                  ? `${ORDER_STATUS_META[status].label} is a final status. This order accepts no further changes.`
                  : `Not reachable from ${ORDER_STATUS_META[status].label.toLowerCase()}. This order can only move to ${allowed
                      .map((next) => ORDER_STATUS_META[next].label.toLowerCase())
                      .join(" or ")}.`}
              </TooltipContent>
            </Tooltip>
          );
        })}

        {pending ? (
          <LoaderCircle className="text-muted-foreground size-3.5 animate-spin" />
        ) : null}
      </div>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setConfirming(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming === "CANCELLED" ? "Cancel this order?" : "Mark this order returned?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming === "CANCELLED"
                ? "Every line goes back into stock as an adjustment movement, and the order can never change status again."
                : "Every line goes back into stock as a return movement. Returned is a final status."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cancel-reason">
                Reason
                {confirming === "CANCELLED" ? (
                  <span className="text-destructive">*</span>
                ) : (
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    (optional)
                  </span>
                )}
              </Label>
              <Select value={reason || undefined} onValueChange={setReason}>
                <SelectTrigger id="cancel-reason" className="w-full" size="sm">
                  <SelectValue placeholder="Choose a reason" />
                </SelectTrigger>
                <SelectContent>
                  {CANCEL_REASONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cancel-detail">
                Detail
                <span className="text-muted-foreground font-normal">
                  {" "}
                  (optional)
                </span>
              </Label>
              <Textarea
                id="cancel-detail"
                rows={2}
                value={detail}
                onChange={(event) => setDetail(event.target.value)}
                placeholder="Anything the next person reading this order should know."
              />
            </div>

            {error ? (
              <p className="text-destructive text-xs">{error}</p>
            ) : null}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep as is</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                confirming &&
                submit(confirming, {
                  reason: reason || undefined,
                  detail: detail || undefined,
                })
              }
            >
              {pending ? <LoaderCircle className="animate-spin" /> : null}
              {confirming === "CANCELLED" ? "Cancel order" : "Mark returned"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * Payment controls.
 *
 * Nothing here talks to a payment provider, because this project does not have
 * one. These buttons record what the operator already knows - cash taken at the
 * door, a transfer that landed - so the books and the dashboard agree with it.
 */
export function PaymentActions({
  orderId,
  paymentStatus,
  totalPaise,
  refundedPaise,
}: {
  orderId: string;
  paymentStatus: PaymentStatus;
  totalPaise: number;
  refundedPaise: number;
}) {
  const [pending, startTransition] = React.useTransition();
  const [refundOpen, setRefundOpen] = React.useState(false);
  const [amount, setAmount] = React.useState("");
  const [refundReason, setRefundReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const remainingPaise = Math.max(0, totalPaise - refundedPaise);
  const lockedByRefund = refundedPaise > 0;

  function mark(next: (typeof MANUAL_PAYMENT_STATUSES)[number]) {
    startTransition(async () => {
      const result = await markPaymentStatus({
        orderId,
        paymentStatus: next,
      });
      if (result.ok) toast.success(result.message ?? "Payment updated.");
      else toast.error(result.error);
    });
  }

  function submitRefund() {
    setError(null);
    startTransition(async () => {
      const result = await recordRefund({
        orderId,
        amountRupees: amount,
        reason: refundReason || undefined,
      });

      if (result.ok) {
        toast.success(result.message ?? "Refund recorded.");
        setRefundOpen(false);
        setAmount("");
        setRefundReason("");
        return;
      }

      setError(result.fieldErrors?.amountRupees ?? result.error);
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {MANUAL_PAYMENT_STATUSES.map((option) => (
          <Button
            key={option}
            size="xs"
            variant="outline"
            disabled={pending || lockedByRefund || option === paymentStatus}
            onClick={() => mark(option)}
          >
            Mark {PAYMENT_STATUS_META[option].label.toLowerCase()}
          </Button>
        ))}

        <Button
          size="xs"
          variant="outline"
          disabled={pending || remainingPaise <= 0}
          onClick={() => {
            setError(null);
            setAmount(String(paiseToRupees(remainingPaise)));
            setRefundOpen(true);
          }}
        >
          Record refund
        </Button>
      </div>

      {lockedByRefund ? (
        <p className="text-muted-foreground text-[11px] leading-relaxed">
          {formatPaise(refundedPaise)} is recorded as refunded, so the payment
          status now follows the refund total and cannot be set by hand.
        </p>
      ) : null}

      <Dialog
        open={refundOpen}
        onOpenChange={(open) => {
          if (!pending) setRefundOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record a refund</DialogTitle>
            <DialogDescription>
              This is a bookkeeping entry, not a transaction. There is no
              payment gateway in this store - refund the customer through your
              bank or UPI app, then record the amount here so the order, the
              revenue figures and your books agree.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="refund-amount">Amount in rupees</Label>
              <Input
                id="refund-amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                aria-invalid={Boolean(error)}
                className="tabular"
              />
              <p
                className={cn(
                  "text-[11px]",
                  error ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {error ??
                  `Order total ${formatPaise(totalPaise)} · ${formatPaise(remainingPaise)} still refundable.`}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="refund-reason">
                Reason
                <span className="text-muted-foreground font-normal">
                  {" "}
                  (optional)
                </span>
              </Label>
              <Input
                id="refund-reason"
                value={refundReason}
                onChange={(event) => setRefundReason(event.target.value)}
                placeholder="Damaged in transit, partial return…"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setRefundOpen(false)}
            >
              Cancel
            </Button>
            <Button disabled={pending} onClick={submitRefund}>
              {pending ? <LoaderCircle className="animate-spin" /> : null}
              Record refund
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
