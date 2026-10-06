import type { Route } from "next";

import type { InventoryKpis } from "@/features/inventory/queries";
import { inventoryHref } from "@/features/inventory/format";
import { StatCard } from "@/components/shared/stat-card";
import { formatNumber, formatPaise } from "@/lib/money";

/**
 * Seven tiles, all from one aggregate query. The state tiles link to the
 * filtered table so a number is never a dead end.
 */
export function KpiStrip({ kpis }: { kpis: InventoryKpis }) {
  return (
    <section aria-label="Stock summary" className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
      <StatCard label="SKUs tracked" value={formatNumber(kpis.skusTracked)} hint="Variants with a stock record" />
      <StatCard label="Units on hand" value={formatNumber(kpis.unitsOnHand)} hint="Physical stock" />
      <StatCard label="Reserved" value={formatNumber(kpis.unitsReserved)} hint="Held by pending orders" />
      <StatCard
        label="Value at cost"
        value={formatPaise(kpis.costValuePaise)}
        hint="On hand × unit cost; uncosted reads as zero"
      />
      <StatCard
        label="Low stock"
        value={formatNumber(kpis.low)}
        hint="At or below threshold"
        href={inventoryHref({ stock: "LOW_STOCK" }) as Route}
      />
      <StatCard
        label="Out of stock"
        value={formatNumber(kpis.out)}
        hint="Nothing available"
        href={inventoryHref({ stock: "OUT_OF_STOCK" }) as Route}
      />
      <StatCard
        label="Backorder"
        value={formatNumber(kpis.backorder)}
        hint="Selling below zero"
        href={inventoryHref({ stock: "BACKORDER" }) as Route}
      />
    </section>
  );
}
