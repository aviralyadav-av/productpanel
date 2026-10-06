import type { Route } from "next";

import { StatCard } from "@/components/shared/stat-card";
import { formatNumber } from "@/lib/money";

import type { ProductKpis } from "@/features/products/queries";

/**
 * The KPI strip above the product list. Each tile links to the filtered view
 * it counts, so "3 out of stock" is one click from the three products.
 */
export function ProductKpiStrip({ kpis }: { kpis: ProductKpis }) {
  const tiles: Array<{ label: string; value: number; href: string; hint?: string }> = [
    { label: "Total products", value: kpis.total, href: "/admin/products", hint: `${kpis.archived} archived` },
    { label: "Published", value: kpis.published, href: "/admin/products?status=PUBLISHED", hint: "Live on the storefront" },
    { label: "Drafts", value: kpis.draft, href: "/admin/products?status=DRAFT", hint: "Not yet visible" },
    { label: "Out of stock", value: kpis.outOfStock, href: "/admin/products?stock=out", hint: "No available units" },
    { label: "Low stock", value: kpis.lowStock, href: "/admin/products?stock=low", hint: "At or below threshold" },
    { label: "Customisable", value: kpis.customizable, href: "/admin/products?flags=customizable", hint: "With active options" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {tiles.map((tile) => (
        <StatCard key={tile.label} label={tile.label} value={formatNumber(tile.value)} hint={tile.hint} href={tile.href as Route} />
      ))}
    </div>
  );
}
