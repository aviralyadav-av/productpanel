"use client";

import Link from "next/link";
import type { Route } from "next";
import { CheckCircle2, CircleAlert } from "lucide-react";

import { FormSection } from "@/components/shared/form-layout";
import { KeyValueList } from "@/components/shared/key-value-list";
import { ProductStatusBadge, StockBadge } from "@/components/shared/status-badge";
import { StatusTimeline } from "@/components/shared/status-timeline";
import { formatIstDateTime } from "@/lib/dates";
import { formatNumber } from "@/lib/money";

import type { EditorProduct } from "@/features/products/queries";

/**
 * The editor's right column: publish readiness, stock, performance and
 * timestamps. Read-only by design - every number here is derived by a
 * service, so there is nothing to edit.
 */
export function RightRail({ product }: { product: EditorProduct }) {
  return (
    <>
      <div className="surface space-y-3 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Status</p>
          <ProductStatusBadge status={product.status} />
        </div>
        <PublishChecklist product={product} />
      </div>

      <div className="surface space-y-3 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Stock</p>
          <StockBadge state={product.stock.stockState} />
        </div>
        <KeyValueList
          dense
          items={[
            { label: "On hand", value: formatNumber(product.stock.onHand), numeric: true },
            { label: "Reserved", value: formatNumber(product.stock.reserved), numeric: true },
            { label: "Available", value: formatNumber(product.stock.available), numeric: true },
          ]}
        />
        <Link href={`/admin/inventory?product=${product.id}` as Route} className="text-brand text-xs hover:underline">
          Open in inventory
        </Link>
      </div>

      <div className="surface space-y-3 p-4">
        <p className="text-sm font-semibold">Performance</p>
        <KeyValueList
          dense
          items={[
            { label: "Orders", value: formatNumber(product.performance.orderCount), numeric: true },
            { label: "Order lines", value: formatNumber(product.performance.orderItemCount), numeric: true },
            { label: "Views", value: formatNumber(product.performance.viewCount), numeric: true },
            { label: "Rating", value: product.performance.reviewCount > 0 ? `${product.performance.ratingAvg.toFixed(1)} · ${product.performance.reviewCount} reviews` : "No reviews yet" },
          ]}
        />
      </div>

      <div className="surface space-y-3 p-4">
        <p className="text-sm font-semibold">Timestamps</p>
        <KeyValueList
          dense
          items={[
            { label: "Created", value: formatIstDateTime(product.createdAt) },
            { label: "Updated", value: formatIstDateTime(product.updatedAt) },
            { label: "Published", value: product.publishedAt ? formatIstDateTime(product.publishedAt) : "Never" },
            { label: "Prices recomputed", value: formatIstDateTime(product.pricingRecomputedAt) },
          ]}
        />
      </div>
    </>
  );
}

export function PublishChecklist({ product }: { product: EditorProduct }) {
  if (product.publish.ok) {
    return (
      <p className="text-success flex items-center gap-1.5 text-xs">
        <CheckCircle2 className="size-3.5" /> Ready to publish.
      </p>
    );
  }
  return (
    <ul className="space-y-1 text-xs">
      {product.publish.problems.map((problem) => (
        <li key={`${problem.code}-${problem.attributeId ?? ""}`} className="text-warning flex items-start gap-1.5">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>{problem.message}</span>
        </li>
      ))}
    </ul>
  );
}

const ACTION_TONE = (action: string) =>
  action.includes("delete") ? "danger" : action.includes("status") || action.includes("publish") ? "success" : action.includes("bulk") ? "info" : "neutral";

export function ActivitySection({ product }: { product: EditorProduct }) {
  return (
    <FormSection id="activity" title="Activity" description="Every audited change to this product, newest first.">
      <StatusTimeline
        events={product.activity.map((entry) => ({
          id: entry.id,
          title: entry.summary,
          description: entry.action,
          at: entry.createdAt,
          actor: entry.actorEmail,
          tone: ACTION_TONE(entry.action),
        }))}
        emptyText="No changes recorded yet."
      />
    </FormSection>
  );
}
