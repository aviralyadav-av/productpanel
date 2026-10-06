"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { ChevronDown, CreditCard, Mail, MoreHorizontal, Printer, Truck } from "lucide-react";

import { ORDER_STATUS_META, type OrderStatus } from "@/lib/enums";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useActionToast } from "@/components/shared/use-action-toast";

import { resendOrderConfirmationAction } from "../actions";
import type { OrderDetailItem, OrderPermissions, PartnerOption } from "../detail-types";
import { CreateShipmentDialog, RecordPaymentDialog, TransitionDialog, manualTargets } from "./order-dialogs";

/**
 * The action row at the top of the order detail page.
 *
 * Only the transitions the state machine actually allows are offered (C2):
 * an operator can never be shown a button that will be refused server-side,
 * because the same MANUAL_ORDER_TRANSITIONS map decides both.
 */
export function OrderHeaderActions({
  orderId,
  orderNumber,
  status,
  items,
  partners,
  outstandingPaise,
  paymentMethod,
  permissions,
}: {
  orderId: string;
  orderNumber: string;
  status: string;
  items: OrderDetailItem[];
  partners: PartnerOption[];
  outstandingPaise: number;
  paymentMethod: string;
  permissions: OrderPermissions;
}) {
  const { run, pending } = useActionToast();
  const [target, setTarget] = React.useState<OrderStatus | null>(null);
  const [shipmentOpen, setShipmentOpen] = React.useState(false);
  const [paymentOpen, setPaymentOpen] = React.useState(false);

  const targets = manualTargets(status);
  const forward = targets.filter((next) => next !== "CANCELLED" && next !== "FAILED");
  const destructive = targets.filter((next) => next === "CANCELLED" || next === "FAILED");
  const canShip = permissions.ship && items.some((item) => item.unshippedQty > 0);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {permissions.update
        ? forward.map((next) => (
            <Button key={next} size="sm" onClick={() => setTarget(next)} disabled={pending}>
              Mark {ORDER_STATUS_META[next].label.toLowerCase()}
            </Button>
          ))
        : null}

      {canShip ? (
        <Button size="sm" variant="outline" onClick={() => setShipmentOpen(true)}>
          <Truck /> Create shipment
        </Button>
      ) : null}

      {permissions.payments && outstandingPaise > 0 ? (
        <Button size="sm" variant="outline" onClick={() => setPaymentOpen(true)}>
          <CreditCard /> Record payment
        </Button>
      ) : null}

      <Button asChild size="sm" variant="outline">
        <Link href={`/admin/orders/${orderId}/invoice` as Route}>
          <Printer /> Invoice
        </Link>
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" aria-label={`More actions for ${orderNumber}`}>
            <MoreHorizontal /> <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/admin/orders/print?ids=${orderId}` as Route}>
              <Printer /> Packing slip
            </Link>
          </DropdownMenuItem>
          {permissions.update ? (
            <DropdownMenuItem onSelect={() => void run(() => resendOrderConfirmationAction(orderId))}>
              <Mail /> Resend confirmation
            </DropdownMenuItem>
          ) : null}
          {permissions.cancel && destructive.length ? <DropdownMenuSeparator /> : null}
          {permissions.cancel
            ? destructive.map((next) => (
                <DropdownMenuItem key={next} variant="destructive" onSelect={() => setTarget(next)}>
                  {next === "FAILED" ? "Mark payment failed" : "Cancel order"}
                </DropdownMenuItem>
              ))
            : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <TransitionDialog
        orderId={orderId}
        fromStatus={status as OrderStatus}
        toStatus={target}
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
      />
      <CreateShipmentDialog orderId={orderId} items={items} partners={partners} open={shipmentOpen} onOpenChange={setShipmentOpen} />
      <RecordPaymentDialog
        orderId={orderId}
        outstandingPaise={outstandingPaise}
        paymentMethod={paymentMethod}
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
      />
    </div>
  );
}
