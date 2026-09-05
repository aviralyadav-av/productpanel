import type { Metadata } from "next";
import Link from "next/link";
import { cn } from "cn";

import { requireAdmin } from "@/lib/auth/guards";
import {
  getInventoryLevels,
  getInventorySummary,
  getStockMovements,
} from "@/features/inventory/queries";
import {
  CategoryFilter,
  InventoryTable,
} from "@/features/inventory/components/inventory-table";
import { MovementHistory } from "@/features/inventory/components/movement-history";
import {
  movementTypeFilterSchema,
  stockStateFilterSchema,
} from "@/features/inventory/schemas";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { StatCard } from "@/components/shared/stat-card";
import {
  FilterTabs,
  PaginationBar,
  SearchInput,
} from "@/components/shared/list-controls";
import { one, parseListParams } from "@/lib/list-params";
import { formatNumber, formatPaise } from "@/lib/money";

export const metadata: Metadata = { title: "Inventory" };

const TABS = [
  { value: "levels", label: "Stock levels", href: "/inventory" },
  {
    value: "movements",
    label: "Movement ledger",
    href: "/inventory?tab=movements",
  },
] as const;

export default async function InventoryPage({
  searchParams,
}: PageProps<"/inventory">) {
  await requireAdmin();
  const params = await searchParams;

  const tab = one(params, "tab") === "movements" ? "movements" : "levels";

  const stockFilter = stockStateFilterSchema.safeParse(one(params, "stock"));
  const typeFilter = movementTypeFilterSchema.safeParse(one(params, "type"));
  const categoryId = one(params, "category");
  const variantId = one(params, "variant");

  const list = parseListParams(params, {
    pageSize: 30,
    defaultSort: tab === "levels" ? "available" : "createdAt",
    defaultOrder: tab === "levels" ? "asc" : "desc",
  });

  /**
   * parseListParams collapses anything that is not exactly "asc" back to the
   * default, so on a list that defaults to ascending, ?order=desc would be
   * swallowed. Reading the raw value keeps both directions reachable without
   * changing shared code other modules depend on.
   */
  const order: "asc" | "desc" =
    one(params, "order") === "desc" ? "desc" : list.order;

  const [summary, levels, movements] = await Promise.all([
    getInventorySummary(),
    tab === "levels"
      ? getInventoryLevels(
          { ...list, order },
          {
            stock: stockFilter.success ? stockFilter.data : undefined,
            categoryId,
          },
        )
      : null,
    tab === "movements"
      ? getStockMovements(list, {
          type: typeFilter.success ? typeFilter.data : undefined,
          variantId,
        })
      : null,
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Inventory"
        description={
          <>
            On-hand stock for every product variant, and the ledger of every
            change. Inventory value is at <strong>retail price, not cost</strong>
            , because no product records a cost price yet. Stock is admin-only
            today: the storefront has no inventory concept at all, so nothing
            changed here affects what a shopper can add to their cart.
          </>
        }
        actions={<TabBar active={tab} />}
      />

      <section
        aria-label="Stock summary"
        className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5"
      >
        <StatCard
          label="Variants"
          value={formatNumber(summary.variants)}
          hint={`${formatNumber(summary.unitsOnHand)} units on hand`}
        />
        <StatCard
          label="In stock"
          value={formatNumber(summary.inStock)}
          hint="Above their threshold"
          href={"/inventory?stock=IN_STOCK" as never}
        />
        <StatCard
          label="Low stock"
          value={formatNumber(summary.lowStock)}
          hint="At or below their threshold"
          href={"/inventory?stock=LOW_STOCK" as never}
        />
        <StatCard
          label="Out of stock"
          value={formatNumber(summary.outOfStock)}
          hint="Nothing available to sell"
          href={"/inventory?stock=OUT_OF_STOCK" as never}
        />
        <StatCard
          label="Inventory value"
          value={formatPaise(summary.retailValuePaise)}
          hint="On hand × retail price"
        />
      </section>

      {levels ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              placeholder="Search product, variant or SKU…"
              className="w-full sm:w-64"
            />
            <FilterTabs
              paramKey="stock"
              allLabel="All"
              options={[
                {
                  value: "IN_STOCK",
                  label: "In stock",
                  count: levels.counts.IN_STOCK,
                },
                {
                  value: "LOW_STOCK",
                  label: "Low",
                  count: levels.counts.LOW_STOCK,
                },
                {
                  value: "OUT_OF_STOCK",
                  label: "Out",
                  count: levels.counts.OUT_OF_STOCK,
                },
              ]}
            />
            <CategoryFilter options={levels.categories} />
          </div>

          {summary.untracked > 0 ? (
            <p className="text-muted-foreground text-xs">
              {formatNumber(summary.untracked)} variant
              {summary.untracked === 1 ? " has" : "s have"} never been counted
              and read as zero on hand. Adjusting one creates its first
              inventory record.
            </p>
          ) : null}

          <Panel
            title="Stock levels"
            description="Available is on hand minus stock reserved by open orders"
            bodyClassName="p-0"
          >
            <InventoryTable rows={levels.rows} />
            <PaginationBar meta={levels.meta} itemLabel="variants" />
          </Panel>
        </div>
      ) : null}

      {movements ? (
        <MovementHistory
          result={movements}
          variantFilter={
            variantId && movements.variantLabel
              ? {
                  label: movements.variantLabel,
                  clearHref: buildMovementsHref({
                    type: typeFilter.success ? typeFilter.data : undefined,
                  }),
                }
              : null
          }
        />
      ) : null}
    </div>
  );
}

/** The two sub-sections of this page are tabs on one route, driven by ?tab=. */
function TabBar({ active }: { active: string }) {
  return (
    <div
      role="tablist"
      aria-label="Inventory view"
      className="bg-muted inline-flex items-center gap-0.5 rounded-lg p-0.5"
    >
      {TABS.map((item) => {
        const isActive = item.value === active;
        return (
          <Link
            key={item.value}
            href={item.href as never}
            role="tab"
            aria-selected={isActive}
            scroll={false}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              isActive
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

function buildMovementsHref(filters: { type?: string }): string {
  const query = new URLSearchParams({ tab: "movements" });
  if (filters.type) query.set("type", filters.type);
  return `/inventory?${query.toString()}`;
}
