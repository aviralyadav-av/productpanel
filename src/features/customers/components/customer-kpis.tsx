import type { Route } from "next";

import { StatCard } from "@/components/shared/stat-card";
import { formatNumber, formatPaise, formatPercent } from "@/lib/money";

import type { CustomerKpis } from "@/features/customers/queries";

/**
 * The KPI strip above the customer list. Each tile links to the filtered view
 * it counts so "4 blocked" is one click from the four customers.
 */
export function CustomerKpiStrip({ kpis }: { kpis: CustomerKpis }) {
  const tiles: Array<{ label: string; value: string; href?: string; hint: string }> = [
    { label: "Total customers", value: formatNumber(kpis.total), href: "/admin/customers", hint: "Live accounts" },
    { label: "New this month", value: formatNumber(kpis.newThisMonth), href: "/admin/customers?range=this_month", hint: "Registered this calendar month" },
    { label: "Repeat rate", value: formatPercent(kpis.repeatRatePct), href: "/admin/customers?segment=RETURNING", hint: "Buyers who ordered again" },
    { label: "Avg lifetime value", value: formatPaise(kpis.averageLifetimeValuePaise), href: "/admin/customers?sort=totalSpentPaise", hint: "Net of refunds, per buyer" },
    { label: "Blocked", value: formatNumber(kpis.blocked), href: "/admin/customers?status=BLOCKED", hint: "Cannot sign in or order" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {tiles.map((tile) => (
        <StatCard key={tile.label} label={tile.label} value={tile.value} hint={tile.hint} href={tile.href as Route} />
      ))}
    </div>
  );
}
