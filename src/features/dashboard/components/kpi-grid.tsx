import type { Route } from "next";

import { StatCard } from "@/components/shared/stat-card";

import type { KpiTile } from "../types";

/**
 * The KPI strip.
 *
 * D14: "dashboard widgets are bound to module permissions and omitted
 * server-side". Filtering happens here, before render, so a tile the actor
 * may not see never reaches the HTML - hiding it with CSS or a client gate
 * would still ship the number to the browser.
 *
 * Two rows on a phone and up to six on a wide screen: at this tile size six
 * across is the point where the label still fits on one line.
 */
export function KpiGrid({
  tiles,
  allowed,
  title,
  description,
}: {
  tiles: readonly KpiTile[];
  allowed: (permission: string) => boolean;
  title: string;
  description?: string;
}) {
  const visible = tiles.filter((tile) => allowed(tile.permission));
  if (visible.length === 0) return null;

  return (
    <section aria-label={title} className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h2 className="text-xs font-semibold tracking-tight">{title}</h2>
        {description ? (
          <p className="text-muted-foreground truncate text-[11px]">{description}</p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
        {visible.map((tile) => (
          <StatCard
            key={tile.key}
            label={tile.label}
            value={tile.value}
            delta={tile.delta}
            hint={tile.hint}
            href={tile.href ? (tile.href as Route) : undefined}
            higherIsBetter={tile.higherIsBetter ?? true}
          />
        ))}
      </div>
    </section>
  );
}
