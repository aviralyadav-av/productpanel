"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { CheckCircle2, PackagePlus } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { AdjustDialog, toAdjustTarget, type AdjustTarget } from "@/features/inventory/components/adjust-dialog";
import { inventoryHref, productHref, variantLabel } from "@/features/inventory/format";
import type { InventoryRow, StockAlerts } from "@/features/inventory/queries";
import { EmptyState } from "@/components/shared/empty-state";
import { Panel } from "@/components/shared/panel";
import { ProductThumb } from "@/components/shared/product-thumb";
import { StockBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/money";

/**
 * Triage view: the fewest-available variants first in two lists, each with a
 * one-click Adjust. Capped at 50 per list; the full set is the levels table
 * filtered by state, one link away.
 */
export function AlertsPanel({ alerts, canAdjust }: { alerts: StockAlerts; canAdjust: boolean }) {
  const router = useRouter();
  const [target, setTarget] = React.useState<AdjustTarget | null>(null);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <AlertList
        title="Low stock"
        description="At or below their threshold, still sellable"
        rows={alerts.low}
        total={alerts.lowTotal}
        viewAllHref={inventoryHref({ stock: "LOW_STOCK" })}
        emptyIcon={CheckCircle2}
        emptyTitle="Nothing is running low"
        canAdjust={canAdjust}
        onAdjust={(row) => setTarget(toAdjustTarget(row))}
      />
      <AlertList
        title="Out of stock"
        description="Nothing available, including variants on backorder"
        rows={alerts.out}
        total={alerts.outTotal}
        viewAllHref={inventoryHref({ stock: "OUT_OF_STOCK" })}
        emptyIcon={CheckCircle2}
        emptyTitle="Everything active has stock"
        canAdjust={canAdjust}
        onAdjust={(row) => setTarget(toAdjustTarget(row))}
      />

      <AdjustDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        targets={target ? [target] : []}
        onDone={() => router.refresh()}
      />
    </div>
  );
}

function AlertList({
  title,
  description,
  rows,
  total,
  viewAllHref,
  emptyIcon,
  emptyTitle,
  canAdjust,
  onAdjust,
}: {
  title: string;
  description: string;
  rows: InventoryRow[];
  total: number;
  viewAllHref: string;
  emptyIcon: LucideIcon;
  emptyTitle: string;
  canAdjust: boolean;
  onAdjust: (row: InventoryRow) => void;
}) {
  return (
    <Panel
      title={`${title} · ${formatNumber(total)}`}
      description={description}
      viewAllHref={viewAllHref as Route}
      viewAllLabel="Open in table"
      bodyClassName="p-0"
    >
      {rows.length === 0 ? (
        <EmptyState icon={emptyIcon} title={emptyTitle} compact />
      ) : (
        <ul className="divide-y">
          {rows.map((row) => (
            <li key={row.variantId} className="flex items-center gap-3 px-4 py-2.5">
              <ProductThumb src={row.imageUrl} alt="" size={32} />
              <div className="min-w-0 flex-1">
                <Link href={productHref(row.productId) as Route} className="block truncate text-sm font-medium hover:underline">
                  {variantLabel(row.productTitle, row.variantName)}
                </Link>
                <p className="text-muted-foreground truncate text-[11px]">
                  {row.sku ? <span className="font-mono">{row.sku} · </span> : null}
                  <span data-numeric>{row.available}</span> available · threshold {row.lowStockThreshold}
                  {row.reserved > 0 ? ` · ${row.reserved} reserved` : ""}
                </p>
              </div>
              <StockBadge state={row.stockState} />
              {canAdjust ? (
                <Button size="xs" variant="outline" onClick={() => onAdjust(row)}>
                  <PackagePlus />
                  Adjust
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {total > rows.length ? (
        <p className="text-muted-foreground border-t px-4 py-2 text-xs">
          Showing the {rows.length} with the least available of {formatNumber(total)}.
        </p>
      ) : null}
    </Panel>
  );
}
