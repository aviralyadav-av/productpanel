"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { FileText, Paperclip, Sparkles, XCircle } from "lucide-react";

import { ORDER_ITEM_STATUS_META, type OrderItemStatus } from "@/lib/enums";
import { formatIstDateTime } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { StatusPill } from "@/components/shared/status-badge";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { useActionToast } from "@/components/shared/use-action-toast";

import { cancelOrderItemAction } from "../actions";
import type { OrderCustomizationEntry, OrderDetailItem } from "../detail-types";

/**
 * The lines of the order, with the personalisation the customer asked for
 * frozen beside each one (§4, §11.9).
 *
 * The customisation block is the reason this card exists rather than a plain
 * table: a maker fulfilling a personalised item needs the exact text, the
 * exact colour and the exact uploaded photo, and those files are PRIVATE
 * media, so they are linked through the audited admin file route rather than
 * exposed as public URLs.
 */

function CustomizationBlock({ entries }: { entries: OrderCustomizationEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <div className="bg-muted/40 mt-2 space-y-1.5 rounded-md border p-2">
      <p className="text-muted-foreground flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide">
        <Sparkles className="size-3" /> Personalisation
      </p>
      <dl className="grid gap-1">
        {entries.map((entry) => (
          <div key={entry.optionId} className="flex flex-wrap items-baseline gap-x-2 text-xs">
            <dt className="text-muted-foreground">{entry.label}:</dt>
            <dd className="font-medium break-words">{entry.value || "—"}</dd>
            {entry.priceDeltaPaise > 0 ? <span className="text-muted-foreground text-[11px]">(+{formatPaise(entry.priceDeltaPaise)}/unit)</span> : null}
            {entry.mediaAssetIds.length > 0 ? (
              <span className="flex flex-wrap items-center gap-2">
                {entry.mediaAssetIds.map((assetId, index) => (
                  <a
                    key={assetId}
                    href={`/api/admin/media/${assetId}/file`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand inline-flex items-center gap-1 text-[11px] hover:underline"
                  >
                    <Paperclip className="size-3" /> File {index + 1}
                  </a>
                ))}
              </span>
            ) : null}
          </div>
        ))}
      </dl>
    </div>
  );
}

function ItemTitle({ item }: { item: OrderDetailItem }) {
  return (
    <div className="flex gap-2">
      {item.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- the order snapshots an absolute URL that may outlive the product.
        <img src={item.imageUrl} alt="" className="bg-muted size-10 shrink-0 rounded border object-cover" loading="lazy" />
      ) : (
        <span className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded border">
          <FileText className="size-4" />
        </span>
      )}
      <div className="min-w-0">
        {item.productSlug && item.productId ? (
          <Link href={`/admin/products/${item.productId}` as Route} className="line-clamp-2 text-xs font-medium hover:underline">
            {item.titleSnapshot}
          </Link>
        ) : (
          <span className="line-clamp-2 text-xs font-medium">{item.titleSnapshot}</span>
        )}
        <p className="text-muted-foreground text-[11px]">
          {item.variantSnapshot ?? "—"}
          {item.skuSnapshot ? ` · ${item.skuSnapshot}` : ""}
        </p>
        {item.sellerId ? (
          <Link href={`/admin/sellers/${item.sellerId}` as Route} className="text-muted-foreground text-[11px] hover:underline">
            {item.sellerName ?? "Seller"}
          </Link>
        ) : (
          <span className="text-muted-foreground text-[11px]">Platform</span>
        )}
        <CustomizationBlock entries={item.customization} />
        {item.shippedAt || item.deliveredAt ? (
          <p className="text-muted-foreground mt-1 text-[11px]">
            {item.deliveredAt ? `Delivered ${formatIstDateTime(item.deliveredAt)}` : `Shipped ${formatIstDateTime(item.shippedAt as Date)}`}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function OrderItemsCard({
  orderId,
  items,
  canCancelLines,
}: {
  orderId: string;
  items: OrderDetailItem[];
  canCancelLines: boolean;
}) {
  const [confirm, confirmDialog] = useConfirm();
  const { run, pending } = useActionToast();

  const cancelLine = async (item: OrderDetailItem) => {
    const result = await confirm({
      title: `Cancel ${item.titleSnapshot}?`,
      description: `All ${item.quantity} unit${item.quantity === 1 ? "" : "s"} are released back to stock. Anything already paid for this line becomes a pending refund; the coupon is not re-allocated.`,
      confirmLabel: "Cancel line",
      destructive: true,
      requireReason: { label: "Reason", placeholder: "Why is this line being cancelled?" },
    });
    if (!result.ok) return;
    await run(() => cancelOrderItemAction(orderId, item.id, { quantity: item.quantity, reason: result.reason ?? "Cancelled by operator" }));
  };

  const canCancel = (item: OrderDetailItem) => canCancelLines && item.status === "ACTIVE" && item.shippedAt === null && item.unshippedQty === item.quantity;

  const table = (
    <DataTable>
      <DataTableHead>
        <Th>Item</Th>
        <Th align="right">Qty</Th>
        <Th align="right">Unit</Th>
        <Th align="right">Discount</Th>
        <Th align="right">Tax</Th>
        <Th align="right">Line total</Th>
        <Th>Status</Th>
        <Th width="3rem" />
      </DataTableHead>
      <DataTableBody>
        {items.map((item) => (
          <Tr key={item.id}>
            <Td className="max-w-md align-top">
              <ItemTitle item={item} />
            </Td>
            <Td numeric align="right" className="align-top">
              {item.quantity}
              {item.returnedQty > 0 ? <div className="text-warning text-[10px]">{item.returnedQty} returned</div> : null}
            </Td>
            <Td numeric align="right" className="align-top">
              <div>{formatPaise(item.unitPricePaise)}</div>
              {item.customizationPaise > 0 ? <div className="text-muted-foreground text-[10px]">+{formatPaise(item.customizationPaise)} personalisation</div> : null}
              {item.listPricePaise > item.unitPricePaise ? (
                <div className="text-muted-foreground text-[10px] line-through">{formatPaise(item.listPricePaise)}</div>
              ) : null}
            </Td>
            <Td numeric align="right" className="align-top">
              {item.discountPaise > 0 ? (
                <div>
                  <div>−{formatPaise(item.discountPaise)}</div>
                  <div className="text-muted-foreground text-[10px]">
                    seller {formatPaise(item.sellerFundedDiscountPaise)} · platform {formatPaise(item.platformFundedDiscountPaise)}
                  </div>
                </div>
              ) : (
                "—"
              )}
            </Td>
            <Td numeric align="right" className="align-top">
              <div>{formatPaise(item.taxPaise)}</div>
              <div className="text-muted-foreground text-[10px]">{(item.taxRateBps / 100).toFixed(item.taxRateBps % 100 === 0 ? 0 : 2)}%</div>
            </Td>
            <Td numeric align="right" className="align-top font-medium">
              {formatPaise(item.lineTotalPaise)}
              {item.refundedPaise > 0 ? <div className="text-muted-foreground text-[10px]">−{formatPaise(item.refundedPaise)} refunded</div> : null}
            </Td>
            <Td className="align-top">
              <StatusPill
                label={ORDER_ITEM_STATUS_META[item.status as OrderItemStatus]?.label ?? item.status}
                tone={ORDER_ITEM_STATUS_META[item.status as OrderItemStatus]?.tone ?? "neutral"}
              />
              {item.unshippedQty > 0 && item.status === "ACTIVE" ? (
                <div className="text-muted-foreground mt-1 text-[10px]">{item.unshippedQty} to ship</div>
              ) : null}
            </Td>
            <Td align="right" className="align-top">
              {canCancel(item) ? (
                <Button variant="ghost" size="icon-xs" aria-label={`Cancel ${item.titleSnapshot}`} disabled={pending} onClick={() => void cancelLine(item)}>
                  <XCircle />
                </Button>
              ) : null}
            </Td>
          </Tr>
        ))}
      </DataTableBody>
    </DataTable>
  );

  const cards = (
    <div className="space-y-2">
      {items.map((item) => (
        <MobileCard
          key={item.id}
          title={item.titleSnapshot}
          subtitle={item.variantSnapshot ?? item.skuSnapshot ?? undefined}
          meta={
            <StatusPill
              label={ORDER_ITEM_STATUS_META[item.status as OrderItemStatus]?.label ?? item.status}
              tone={ORDER_ITEM_STATUS_META[item.status as OrderItemStatus]?.tone ?? "neutral"}
            />
          }
        >
          <MobileCardField label="Qty" numeric>
            {item.quantity}
          </MobileCardField>
          <MobileCardField label="Unit" numeric>
            {formatPaise(item.unitPricePaise)}
          </MobileCardField>
          <MobileCardField label="Line total" numeric>
            {formatPaise(item.lineTotalPaise)}
          </MobileCardField>
          <MobileCardField label="Seller">{item.sellerName ?? "Platform"}</MobileCardField>
          {item.customization.length > 0 ? (
            <div className="col-span-2">
              <CustomizationBlock entries={item.customization} />
            </div>
          ) : null}
        </MobileCard>
      ))}
    </div>
  );

  return (
    <section className="surface overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <h2 className="text-xs font-semibold tracking-tight">Items</h2>
        <span className="text-muted-foreground text-[11px]">
          {items.filter((item) => item.status === "ACTIVE").length} active of {items.length}
        </span>
      </header>
      <ResponsiveTable table={table} cards={<div className="p-3">{cards}</div>} />
      {confirmDialog}
    </section>
  );
}
