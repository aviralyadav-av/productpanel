"use client";

import * as React from "react";
import { CreditCard, Plus } from "lucide-react";

import { PAYMENT_TRANSACTION_STATUS_META, type PaymentTransactionStatus } from "@/lib/enums";
import { formatIstDateTime } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusPill } from "@/components/shared/status-badge";

import type { OrderDetailPayment } from "../detail-types";
import { RecordPaymentDialog } from "./order-dialogs";

/**
 * Every payment attempt on the order (§14.B6). Failed attempts stay visible
 * on purpose: "the customer says they paid" is answered by showing them, not
 * by hiding everything that did not succeed.
 */
export function OrderPaymentsCard({
  orderId,
  payments,
  paidPaise,
  outstandingPaise,
  paymentMethod,
  canRecord,
}: {
  orderId: string;
  payments: OrderDetailPayment[];
  paidPaise: number;
  outstandingPaise: number;
  paymentMethod: string;
  canRecord: boolean;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <section className="surface overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <div>
          <h2 className="text-xs font-semibold tracking-tight">Payments</h2>
          <p className="text-muted-foreground text-[11px]">
            {formatPaise(paidPaise)} received{outstandingPaise > 0 ? ` · ${formatPaise(outstandingPaise)} outstanding` : " · settled"}
          </p>
        </div>
        {canRecord && outstandingPaise > 0 ? (
          <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
            <Plus /> Record
          </Button>
        ) : null}
      </header>

      {payments.length === 0 ? (
        <EmptyState compact icon={CreditCard} title="No payment attempts" description="Nothing has been charged against this order yet." />
      ) : (
        <ul className="divide-y">
          {payments.map((payment) => {
            const meta = PAYMENT_TRANSACTION_STATUS_META[payment.status as PaymentTransactionStatus];
            return (
              <li key={payment.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium">{payment.provider}</span>
                    <span className="text-muted-foreground text-[11px]">
                      {payment.method.toLowerCase().replace("_", " ")} · {payment.type.toLowerCase()}
                    </span>
                    <StatusPill label={meta?.label ?? payment.status} tone={meta?.tone ?? "neutral"} />
                  </div>
                  <p className="text-muted-foreground text-[11px]">
                    {formatIstDateTime(payment.createdAt)}
                    {payment.providerPaymentId ? ` · ${payment.providerPaymentId}` : payment.providerOrderId ? ` · ${payment.providerOrderId}` : ""}
                  </p>
                  {payment.failureMessage ? (
                    <p className="text-destructive text-[11px]">
                      {payment.failureCode ? `${payment.failureCode}: ` : ""}
                      {payment.failureMessage}
                    </p>
                  ) : null}
                </div>
                <span data-numeric className="text-xs font-medium">
                  {formatPaise(payment.amountPaise)}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <RecordPaymentDialog
        orderId={orderId}
        outstandingPaise={outstandingPaise}
        paymentMethod={paymentMethod}
        open={open}
        onOpenChange={setOpen}
      />
    </section>
  );
}
