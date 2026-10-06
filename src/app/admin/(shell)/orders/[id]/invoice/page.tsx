import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { requirePermission } from "@/lib/auth/guards";
import { formatIstDate, formatIstDateTime } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { PrintButton } from "@/components/shared/export-button";

import { getOrderDetail, getStoreIdentity } from "@/features/orders/detail-queries";

export const metadata: Metadata = { title: "Invoice" };

/**
 * /admin/orders/[id]/invoice — the printable tax invoice (blueprint §8, B1).
 *
 * Everything on it is a stored snapshot: the HSN code, the tax rate and the
 * tax amount are the ones frozen on the line when the order was placed, not
 * today's product settings. A reprinted invoice must be byte-identical to the
 * one the customer already has, even after a tax rate or a product title
 * changes.
 *
 * `print:` utilities strip the shell chrome so Ctrl-P produces a clean A4
 * page without a second "print view" implementation to keep in sync.
 */
export default async function OrderInvoicePage({ params }: PageProps<"/admin/orders/[id]/invoice">) {
  await requirePermission("orders.view");
  const { id } = await params;

  const [order, store] = await Promise.all([getOrderDetail(id), getStoreIdentity()]);
  if (!order) notFound();

  const lines = order.items.filter((item) => item.status !== "CANCELLED");
  const paidRows = order.payments.filter((payment) => payment.status === "SUCCEEDED");
  const storeName = store["store.name"] || "DIY Baazar";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button asChild size="sm" variant="ghost">
          <Link href={`/admin/orders/${order.id}` as Route}>
            <ArrowLeft /> Back to order
          </Link>
        </Button>
        <PrintButton label="Print invoice" size="sm" />
      </div>

      <article className="surface mx-auto w-full max-w-4xl space-y-6 p-8 text-xs print:max-w-none print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b pb-4">
          <div className="min-w-0 space-y-0.5">
            <h1 className="text-base font-semibold tracking-tight">{storeName}</h1>
            {store["store.tagline"] ? <p className="text-muted-foreground">{store["store.tagline"]}</p> : null}
            {store["store.address"] ? <p className="text-muted-foreground whitespace-pre-line">{store["store.address"]}</p> : null}
            <p className="text-muted-foreground">
              {[store["store.contact_email"], store["store.contact_phone"]].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="space-y-0.5 text-right">
            <p className="text-sm font-semibold">Tax invoice</p>
            <p className="font-mono">{order.orderNumber}</p>
            <p className="text-muted-foreground">Placed {formatIstDate(order.placedAt)}</p>
            <p className="text-muted-foreground">
              {order.paymentMethod} · {order.paymentStatus.toLowerCase()}
            </p>
          </div>
        </header>

        <section className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-1">
            <h2 className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">Billed to</h2>
            {order.billingAddress ? <AddressBlock address={order.billingAddress} /> : <p className="text-muted-foreground">Same as shipping.</p>}
            <p className="text-muted-foreground break-all">{order.customerEmail}</p>
          </div>
          <div className="space-y-1">
            <h2 className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">Shipped to</h2>
            {order.shippingAddress ? <AddressBlock address={order.shippingAddress} /> : <p className="text-muted-foreground">Not recorded.</p>}
            {order.shippingMethodName ? <p className="text-muted-foreground">via {order.shippingMethodName}</p> : null}
          </div>
        </section>

        <section className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b">
                <th className="py-1.5 pr-2 font-medium">Item</th>
                <th className="px-2 py-1.5 font-medium">HSN</th>
                <th className="px-2 py-1.5 text-right font-medium">Qty</th>
                <th className="px-2 py-1.5 text-right font-medium">Unit</th>
                <th className="px-2 py-1.5 text-right font-medium">Discount</th>
                <th className="px-2 py-1.5 text-right font-medium">Tax %</th>
                <th className="px-2 py-1.5 text-right font-medium">Tax</th>
                <th className="py-1.5 pl-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((item) => (
                <tr key={item.id} className="border-b align-top">
                  <td className="py-1.5 pr-2">
                    <span className="font-medium">{item.titleSnapshot}</span>
                    {item.variantSnapshot ? <span className="text-muted-foreground"> ({item.variantSnapshot})</span> : null}
                    {item.skuSnapshot ? <div className="text-muted-foreground">SKU {item.skuSnapshot}</div> : null}
                    {item.customization.length > 0 ? (
                      <div className="text-muted-foreground">
                        {item.customization.map((entry) => `${entry.label}: ${entry.value || "—"}`).join(" · ")}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-2 py-1.5">{item.hsnCodeSnapshot ?? "—"}</td>
                  <td data-numeric className="px-2 py-1.5 text-right">
                    {item.quantity}
                  </td>
                  <td data-numeric className="px-2 py-1.5 text-right">
                    {formatPaise(item.unitPricePaise + item.customizationPaise)}
                  </td>
                  <td data-numeric className="px-2 py-1.5 text-right">
                    {item.discountPaise > 0 ? `−${formatPaise(item.discountPaise)}` : "—"}
                  </td>
                  <td data-numeric className="px-2 py-1.5 text-right">
                    {(item.taxRateBps / 100).toFixed(item.taxRateBps % 100 === 0 ? 0 : 2)}%
                  </td>
                  <td data-numeric className="px-2 py-1.5 text-right">
                    {formatPaise(item.taxPaise)}
                  </td>
                  <td data-numeric className="py-1.5 pl-2 text-right font-medium">
                    {formatPaise(item.lineTotalPaise)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="flex justify-end">
          <dl className="w-full max-w-xs space-y-1">
            <TotalRow label="Subtotal" value={formatPaise(order.subtotalPaise)} />
            {order.discountPaise > 0 ? <TotalRow label="Promotion discount" value={`−${formatPaise(order.discountPaise)}`} /> : null}
            {order.couponDiscountPaise > 0 ? (
              <TotalRow label={`Coupon ${order.couponCode ?? ""}`.trim()} value={`−${formatPaise(order.couponDiscountPaise)}`} />
            ) : null}
            <TotalRow label="Shipping" value={formatPaise(order.shippingPaise)} />
            {order.codFeePaise > 0 ? <TotalRow label="Cash-on-delivery fee" value={formatPaise(order.codFeePaise)} /> : null}
            <TotalRow label={order.pricesIncludeTax ? "Tax (included)" : "Tax"} value={formatPaise(order.taxPaise)} />
            <TotalRow label={`Total (${order.currency})`} value={formatPaise(order.totalPaise)} strong />
            {order.refundedPaise > 0 ? <TotalRow label="Refunded" value={`−${formatPaise(order.refundedPaise)}`} /> : null}
            <TotalRow label="Paid" value={formatPaise(order.paidPaise)} />
            <TotalRow label="Balance due" value={formatPaise(order.balanceDuePaise)} strong />
          </dl>
        </section>

        <section className="space-y-1 border-t pt-4">
          <h2 className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">Payments</h2>
          {paidRows.length === 0 ? (
            <p className="text-muted-foreground">No payment has been received against this invoice yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {paidRows.map((payment) => (
                <li key={payment.id} className="flex justify-between gap-3">
                  <span>
                    {payment.provider} · {payment.method.toLowerCase().replace("_", " ")}
                    {payment.providerPaymentId ? ` · ${payment.providerPaymentId}` : ""}
                    <span className="text-muted-foreground"> · {formatIstDateTime(payment.capturedAt ?? payment.createdAt)}</span>
                  </span>
                  <span data-numeric>{formatPaise(payment.amountPaise)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted-foreground pt-3 text-[11px]">
            Prices {order.pricesIncludeTax ? "include" : "exclude"} tax. This is a computer-generated invoice and needs no signature.
          </p>
        </section>
      </article>
    </div>
  );
}

function AddressBlock({
  address,
}: {
  address: { fullName: string; phone: string; line1: string; line2: string | null; landmark: string | null; city: string; state: string; pinCode: string; country: string };
}) {
  return (
    <address className="not-italic leading-relaxed">
      <span className="font-medium">{address.fullName}</span>
      <br />
      {address.line1}
      {address.line2 ? (
        <>
          <br />
          {address.line2}
        </>
      ) : null}
      {address.landmark ? (
        <>
          <br />
          {address.landmark}
        </>
      ) : null}
      <br />
      {address.city}, {address.state} {address.pinCode}, {address.country}
      <br />
      <span className="text-muted-foreground">{address.phone}</span>
    </address>
  );
}

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "border-t pt-1 font-semibold" : ""}`}>
      <dt className={strong ? "" : "text-muted-foreground"}>{label}</dt>
      <dd data-numeric>{value}</dd>
    </div>
  );
}
