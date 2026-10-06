import Link from "next/link";
import type { Route } from "next";

import { formatPaise } from "@/lib/money";

/**
 * The money summary (§14.B1). Every figure is a stored column, never
 * recomputed for display: the invoice, the seller statement and this card
 * must show the same number even after a tax rate or a commission rule
 * changes, which is exactly why the order snapshots them.
 */

function Row({
  label,
  value,
  hint,
  strong,
  negative,
}: {
  label: React.ReactNode;
  value: string;
  hint?: string;
  strong?: boolean;
  negative?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${strong ? "border-t pt-2 text-sm font-semibold" : "text-xs"}`}>
      <span className={strong ? "" : "text-muted-foreground"}>
        {label}
        {hint ? <span className="text-muted-foreground/70 ml-1 text-[10px]">{hint}</span> : null}
      </span>
      <span data-numeric className={negative ? "text-muted-foreground" : undefined}>
        {negative ? `−${value}` : value}
      </span>
    </div>
  );
}

export function OrderMoneyCard({
  order,
}: {
  order: {
    subtotalPaise: number;
    discountPaise: number;
    couponDiscountPaise: number;
    couponCode: string | null;
    couponId: string | null;
    shippingPaise: number;
    shippingMethodName: string | null;
    codFeePaise: number;
    taxPaise: number;
    totalPaise: number;
    refundedPaise: number;
    paidPaise: number;
    balanceDuePaise: number;
    pricesIncludeTax: boolean;
    taxRemittedBy: string;
    currency: string;
  };
}) {
  return (
    <section className="surface overflow-hidden">
      <header className="border-b px-4 py-2.5">
        <h2 className="text-xs font-semibold tracking-tight">Money</h2>
        <p className="text-muted-foreground text-[11px]">
          Prices {order.pricesIncludeTax ? "include" : "exclude"} tax · goods tax remitted by {order.taxRemittedBy.toLowerCase()}
        </p>
      </header>
      <div className="space-y-2 p-4">
        <Row label="Subtotal" value={formatPaise(order.subtotalPaise)} />
        {order.discountPaise > 0 ? <Row label="Promotion discount" value={formatPaise(order.discountPaise)} negative /> : null}
        {order.couponDiscountPaise > 0 ? (
          <Row
            label={
              order.couponId && order.couponCode ? (
                <Link href={`/admin/coupons/${order.couponId}` as Route} className="hover:underline">
                  Coupon {order.couponCode}
                </Link>
              ) : (
                `Coupon ${order.couponCode ?? ""}`
              )
            }
            value={formatPaise(order.couponDiscountPaise)}
            negative
          />
        ) : null}
        <Row label="Shipping" value={formatPaise(order.shippingPaise)} hint={order.shippingMethodName ?? undefined} />
        {order.codFeePaise > 0 ? <Row label="Cash-on-delivery fee" value={formatPaise(order.codFeePaise)} /> : null}
        <Row label="Tax" value={formatPaise(order.taxPaise)} hint={order.pricesIncludeTax ? "included above" : undefined} />
        <Row label={`Total (${order.currency})`} value={formatPaise(order.totalPaise)} strong />
        <Row label="Paid" value={formatPaise(order.paidPaise)} />
        {order.refundedPaise > 0 ? <Row label="Refunded" value={formatPaise(order.refundedPaise)} negative /> : null}
        <Row label="Balance due" value={formatPaise(order.balanceDuePaise)} strong />
      </div>
    </section>
  );
}
