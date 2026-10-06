import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { ArrowLeft, Printer } from "lucide-react";

import { requirePermission } from "@/lib/auth/guards";
import { formatIstDateTime } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { PrintButton } from "@/components/shared/export-button";

import { getPackingSlips, getStoreIdentity } from "@/features/orders/detail-queries";
import type { OrderCustomizationEntry } from "@/features/orders/detail-types";

export const metadata: Metadata = { title: "Packing slips" };

/**
 * /admin/orders/print?ids=a&ids=b (or ?ids=a,b) — the bulk "print packing
 * slips" target from the order list.
 *
 * A packing slip is not an invoice: it carries no money the packer does not
 * need, but it does carry the personalisation answers, because a personalised
 * item packed without its engraving text is a return waiting to happen. Each
 * slip is its own `break-after-page` block so one sheet holds one order.
 */
export default async function OrdersPrintPage({ searchParams }: PageProps<"/admin/orders/print">) {
  await requirePermission("orders.view");

  const params = await searchParams;
  const raw = params.ids;
  const ids = [...new Set((Array.isArray(raw) ? raw : raw ? [raw] : []).flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean))];

  const [slips, store] = await Promise.all([getPackingSlips(ids), getStoreIdentity()]);
  const storeName = store["store.name"] || "DIY Baazar";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button asChild size="sm" variant="ghost">
          <Link href={"/admin/orders" as Route}>
            <ArrowLeft /> All orders
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">
            {slips.length} slip{slips.length === 1 ? "" : "s"}
            {ids.length > slips.length ? ` of ${ids.length} requested` : ""}
          </span>
          {slips.length > 0 ? <PrintButton label="Print" size="sm" /> : null}
        </div>
      </div>

      {slips.length === 0 ? (
        <div className="surface print:hidden">
          <EmptyState
            icon={Printer}
            title="Nothing to print"
            description="Select orders in the list and choose “Print packing slips”, or add ?ids=… to this URL."
          />
        </div>
      ) : null}

      {slips.map((slip) => {
        const shipping = slip.addresses.find((address) => address.type === "SHIPPING");
        const units = slip.items.reduce((sum, item) => sum + item.quantity, 0);
        return (
          <article
            key={slip.id}
            className="surface space-y-4 p-6 text-xs break-after-page print:border-0 print:p-0 print:shadow-none"
          >
            <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-3">
              <div>
                <p className="text-sm font-semibold">{storeName}</p>
                <p className="text-muted-foreground">Packing slip</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-sm font-semibold">{slip.orderNumber}</p>
                <p className="text-muted-foreground">{formatIstDateTime(slip.placedAt)}</p>
                <p className="text-muted-foreground">
                  {slip.paymentMethod} · {slip.paymentMethod === "COD" ? `collect ${formatPaise(slip.totalPaise)}` : slip.paymentStatus.toLowerCase()}
                </p>
              </div>
            </header>

            <section className="grid gap-4 sm:grid-cols-2">
              <div>
                <h2 className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">Deliver to</h2>
                {shipping ? (
                  <address className="not-italic leading-relaxed">
                    <span className="font-medium">{shipping.fullName}</span>
                    <br />
                    {shipping.line1}
                    {shipping.line2 ? (
                      <>
                        <br />
                        {shipping.line2}
                      </>
                    ) : null}
                    {shipping.landmark ? (
                      <>
                        <br />
                        {shipping.landmark}
                      </>
                    ) : null}
                    <br />
                    {shipping.city}, {shipping.state} {shipping.pinCode}
                    <br />
                    {shipping.phone}
                  </address>
                ) : (
                  <p className="text-muted-foreground">No shipping address on file.</p>
                )}
              </div>
              <div>
                <h2 className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">Shipping</h2>
                <p>{slip.shippingMethodName ?? "Standard"}</p>
                <p className="text-muted-foreground">
                  {units} unit{units === 1 ? "" : "s"} across {slip.items.length} line{slip.items.length === 1 ? "" : "s"}
                </p>
                {slip.customerNote ? (
                  <p className="mt-2">
                    <span className="text-muted-foreground">Customer note: </span>
                    {slip.customerNote}
                  </p>
                ) : null}
              </div>
            </section>

            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b">
                  <th className="py-1.5 pr-2 font-medium">Item</th>
                  <th className="px-2 py-1.5 font-medium">SKU</th>
                  <th className="px-2 py-1.5 font-medium">Seller</th>
                  <th className="py-1.5 pl-2 text-right font-medium">Qty</th>
                </tr>
              </thead>
              <tbody>
                {slip.items.map((item) => {
                  const entries = Array.isArray(item.customization) ? (item.customization as unknown as OrderCustomizationEntry[]) : [];
                  return (
                    <tr key={item.id} className="border-b align-top">
                      <td className="py-1.5 pr-2">
                        <span className="font-medium">{item.titleSnapshot}</span>
                        {item.variantSnapshot ? <span className="text-muted-foreground"> ({item.variantSnapshot})</span> : null}
                        {entries.length > 0 ? (
                          <ul className="mt-1 space-y-0.5">
                            {entries.map((entry) => (
                              <li key={entry.optionId}>
                                <span className="text-muted-foreground">{entry.label}: </span>
                                <span className="font-medium">{entry.value || "—"}</span>
                                {entry.fileUrls.length > 0 ? <span className="text-muted-foreground"> ({entry.fileUrls.length} file)</span> : null}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5">{item.skuSnapshot ?? "—"}</td>
                      <td className="px-2 py-1.5">{item.sellerNameSnapshot ?? "Platform"}</td>
                      <td data-numeric className="py-1.5 pl-2 text-right font-medium">
                        {item.quantity}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <p className="text-muted-foreground border-t pt-3 text-[11px]">
              Check every personalised line against the answers above before sealing the parcel.
            </p>
          </article>
        );
      })}
    </div>
  );
}
