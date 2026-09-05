"use client";

import * as React from "react";
import Link from "next/link";
import { LoaderCircle, Mail, MapPin, Phone, SquarePen } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";

import { Panel } from "@/components/shared/panel";
import {
  CustomerStatusBadge,
  PaymentStatusBadge,
} from "@/components/shared/status-badge";
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
import { formatIstDate } from "@/lib/dates";
import { formatNumber, formatPaise } from "@/lib/money";
import { updateShippingAddress } from "@/features/orders/actions";
import { PaymentActions } from "@/features/orders/components/order-status-actions";
import type { OrderDetail } from "@/features/orders/queries";
import type { PaymentStatus } from "@/lib/enums";

/**
 * The money summary.
 *
 * Every figure is stored on the order in paise and rendered through
 * formatPaise. Nothing is recomputed from the line items: an order must show
 * what was actually charged, even if a later price change would make the
 * arithmetic come out differently today.
 */
export function OrderMoneySummary({ order }: { order: OrderDetail }) {
  const netPaise = order.totalPaise - order.refundedPaise;

  return (
    <div className="border-t">
      <dl className="ml-auto w-full max-w-sm px-4 py-3 text-xs">
        <div className="space-y-1.5">
          <Row label="Subtotal" value={formatPaise(order.subtotalPaise)} />
          <Row
            label="Shipping"
            value={
              order.shippingPaise === 0
                ? "Free"
                : formatPaise(order.shippingPaise)
            }
          />
          {order.discountPaise > 0 ? (
            <Row
              label={
                order.discountCode
                  ? `Discount · ${order.discountCode}`
                  : "Discount"
              }
              value={`− ${formatPaise(order.discountPaise)}`}
              tone="success"
            />
          ) : null}
          {order.taxPaise > 0 ? (
            <Row label="Tax" value={formatPaise(order.taxPaise)} />
          ) : null}
        </div>

        <div className="mt-2 space-y-1.5 border-t pt-2">
          <Row label="Total" value={formatPaise(order.totalPaise)} strong />

          {order.refundedPaise > 0 ? (
            <>
              <Row
                label="Refunded"
                value={`− ${formatPaise(order.refundedPaise)}`}
                tone="warning"
              />
              <Row label="Net" value={formatPaise(netPaise)} strong />
            </>
          ) : null}
        </div>
      </dl>

      {order.shippingPaise === 0 ? (
        <p className="text-muted-foreground border-t px-4 py-2 text-[11px] leading-relaxed">
          Shipping was not charged on this order. The storefront decides that
          itself — the free-shipping threshold is hardcoded in its checkout, not
          read from this panel.
        </p>
      ) : null}
    </div>
  );
}

function Row({
  label,
  value,
  strong = false,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "success" | "warning";
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt
        className={cn(
          strong ? "font-medium" : "text-muted-foreground",
          "truncate",
        )}
      >
        {label}
      </dt>
      <dd
        data-numeric
        className={cn(
          "shrink-0",
          strong && "text-sm font-semibold",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

export function CustomerCard({ order }: { order: OrderDetail }) {
  const name = order.customer?.fullName ?? order.shipFullName;
  const email = order.customer?.email ?? order.shipEmail;

  return (
    <Panel
      title="Customer"
      action={
        order.customer?.status ? (
          <CustomerStatusBadge status={order.customer.status} />
        ) : null
      }
      bodyClassName="p-4 space-y-3"
    >
      <div className="space-y-1">
        <p className="text-sm font-medium">{name}</p>
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Mail className="size-3 shrink-0" />
          <span className="truncate">{email}</span>
        </p>
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Phone className="size-3 shrink-0" />
          {order.shipPhone || "—"}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 border-t pt-3">
        <div>
          <dd data-numeric className="text-sm font-semibold">
            {formatNumber(order.lifetime.orders)}
          </dd>
          <dt className="text-muted-foreground text-[11px]">Lifetime orders</dt>
        </div>
        <div>
          <dd data-numeric className="text-sm font-semibold">
            {formatPaise(order.lifetime.valuePaise)}
          </dd>
          <dt className="text-muted-foreground text-[11px]">Lifetime value</dt>
        </div>
      </dl>

      <p className="text-muted-foreground text-[11px] leading-relaxed">
        {order.customer
          ? `Customer since ${formatIstDate(order.customer.createdAt)}. Lifetime figures exclude cancelled and returned orders and are net of refunds.`
          : "This order has no customer record — checkout on the storefront is anonymous. Lifetime figures are matched on the shipping email instead."}
      </p>

      <Button asChild variant="outline" size="xs">
        <Link
          href={
            (order.customer
              ? `/customers?q=${encodeURIComponent(email)}`
              : "/customers") as never
          }
        >
          Open in customers
        </Link>
      </Button>
    </Panel>
  );
}

/**
 * The shipping block is a snapshot taken at checkout, not a live join onto the
 * customer's address book. Editing it changes this order and nothing else,
 * which is exactly what you want when a courier calls about a wrong pin code.
 */
export function ShippingAddressCard({ order }: { order: OrderDetail }) {
  const [open, setOpen] = React.useState(false);
  const editable = order.status !== "DELIVERED" && order.status !== "RETURNED";

  return (
    <Panel
      title="Shipping address"
      action={
        editable ? (
          <Button size="icon-xs" variant="ghost" onClick={() => setOpen(true)}>
            <SquarePen />
            <span className="sr-only">Edit shipping address</span>
          </Button>
        ) : null
      }
      bodyClassName="p-4 space-y-3"
    >
      <address className="space-y-0.5 text-xs not-italic">
        <p className="font-medium">{order.shipFullName}</p>
        <p className="text-muted-foreground">{order.shipAddress}</p>
        <p className="text-muted-foreground">
          {order.shipCity}, {order.shipState}
        </p>
        <p className="text-muted-foreground" data-numeric>
          {order.shipPinCode} · India
        </p>
      </address>

      <p className="text-muted-foreground flex items-start gap-1.5 border-t pt-3 text-[11px] leading-relaxed">
        <MapPin className="mt-0.5 size-3 shrink-0" />
        A snapshot of what was entered at checkout. Editing it here changes this
        order only, never the customer&apos;s saved address.
      </p>

      <EditAddressDialog order={order} open={open} onOpenChange={setOpen} />
    </Panel>
  );
}

const ADDRESS_FIELDS = [
  { name: "shipFullName", label: "Recipient", span: 2 },
  { name: "shipEmail", label: "Email", span: 2 },
  { name: "shipPhone", label: "Phone", span: 1 },
  { name: "shipPinCode", label: "Pin code", span: 1 },
  { name: "shipAddress", label: "Address", span: 2 },
  { name: "shipCity", label: "City", span: 1 },
  { name: "shipState", label: "State", span: 1 },
] as const;

function EditAddressDialog({
  order,
  open,
  onOpenChange,
}: {
  order: OrderDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = React.useTransition();
  const [fieldErrors, setFieldErrors] = React.useState<
    Record<string, string>
  >({});
  const [error, setError] = React.useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = await updateShippingAddress({
        orderId: order.id,
        shipFullName: String(formData.get("shipFullName") ?? ""),
        shipEmail: String(formData.get("shipEmail") ?? ""),
        shipPhone: String(formData.get("shipPhone") ?? ""),
        shipAddress: String(formData.get("shipAddress") ?? ""),
        shipCity: String(formData.get("shipCity") ?? ""),
        shipState: String(formData.get("shipState") ?? ""),
        shipPinCode: String(formData.get("shipPinCode") ?? ""),
      });

      if (result.ok) {
        toast.success(result.message ?? "Shipping details updated.");
        onOpenChange(false);
        return;
      }

      setError(result.error);
      setFieldErrors(result.fieldErrors ?? {});
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit shipping details</DialogTitle>
          <DialogDescription>
            Corrects this order only. The customer is not notified — there is no
            transactional email in this project.
          </DialogDescription>
        </DialogHeader>

        <form action={submit} className="grid grid-cols-2 gap-3">
          {ADDRESS_FIELDS.map((field) => (
            <div
              key={field.name}
              className={cn("space-y-1.5", field.span === 2 && "col-span-2")}
            >
              <Label htmlFor={field.name}>{field.label}</Label>
              <Input
                id={field.name}
                name={field.name}
                defaultValue={order[field.name]}
                aria-invalid={Boolean(fieldErrors[field.name])}
                className={cn(field.name === "shipPinCode" && "tabular")}
              />
              {fieldErrors[field.name] ? (
                <p className="text-destructive text-[11px]">
                  {fieldErrors[field.name]}
                </p>
              ) : null}
            </div>
          ))}

          {error ? (
            <p className="text-destructive col-span-2 text-xs">{error}</p>
          ) : null}

          <DialogFooter className="col-span-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <LoaderCircle className="animate-spin" /> : null}
              Save details
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PaymentCard({ order }: { order: OrderDetail }) {
  return (
    <Panel
      title="Payment"
      action={
        <PaymentStatusBadge
          status={order.paymentStatus}
          method={order.paymentMethod}
        />
      }
      bodyClassName="p-4 space-y-3"
    >
      <dl className="space-y-1.5 text-xs">
        <Row label="Method" value={order.paymentMethod} />
        <Row label="Charged" value={formatPaise(order.totalPaise)} />
        {order.refundedPaise > 0 ? (
          <Row
            label="Refunded"
            value={formatPaise(order.refundedPaise)}
            tone="warning"
          />
        ) : null}
        <Row label="Order source" value={order.source} />
      </dl>

      <div className="border-t pt-3">
        <PaymentActions
          orderId={order.id}
          paymentStatus={order.paymentStatus as PaymentStatus}
          totalPaise={order.totalPaise}
          refundedPaise={order.refundedPaise}
        />
      </div>
    </Panel>
  );
}
