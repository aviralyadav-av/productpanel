import type { Metadata } from "next";

import { can, requirePermission } from "@/lib/auth/guards";
import { one, parseListParams, type ListParams, type SearchParams } from "@/lib/list-params";
import { resolveDateRangeParams } from "@/components/shared/date-range";
import { PageHeader } from "@/components/shared/page-header";
import { AlertsPanel } from "@/features/inventory/components/alerts-panel";
import { HistorySheet } from "@/features/inventory/components/history-sheet";
import { ImportPanel } from "@/features/inventory/components/import-panel";
import { InventoryLevels } from "@/features/inventory/components/inventory-levels";
import { InventoryTabs } from "@/features/inventory/components/inventory-tabs";
import { KpiStrip } from "@/features/inventory/components/kpi-strip";
import { MovementsLedger } from "@/features/inventory/components/movements-ledger";
import { variantLabel } from "@/features/inventory/format";
import {
  getCategoryOptions,
  getInventoryKpis,
  getSellerRef,
  getStockAlerts,
  getVariantInventory,
  listInventory,
  listStockMovements,
} from "@/features/inventory/queries";
import {
  HISTORY_PAGE_SIZE,
  HISTORY_PARAMS,
  hasDateWindow,
  parseInventoryFilters,
  parseInventorySort,
  parseInventoryTab,
  parseMovementFilters,
  parseMovementType,
} from "@/features/inventory/schemas";

export const metadata: Metadata = { title: "Inventory" };

/**
 * parseListParams treats anything but "asc" as the default direction, which
 * on a list that defaults to ascending swallows `?order=desc`. Reading the raw
 * value keeps both directions reachable without touching shared code.
 */
function readOrder(params: SearchParams, fallback: "asc" | "desc"): "asc" | "desc" {
  const raw = one(params, "order");
  return raw === "asc" || raw === "desc" ? raw : fallback;
}

/**
 * /admin/inventory (blueprint §1 Inventory, §11.7/28/29/33, F7).
 *
 * One route, four `?tab=` views, plus `?variant=` opening the history sheet
 * over any of them. Every filter, sort and page lives in the URL; the KPI
 * strip is one aggregate query shared by all tabs.
 */
export default async function InventoryPage({ searchParams }: PageProps<"/admin/inventory">) {
  const actor = await requirePermission("inventory.view");
  const params = (await searchParams) as SearchParams;

  const tab = parseInventoryTab(one(params, "tab"));
  const canAdjust = can(actor, "inventory.adjust");
  const variantId = one(params, HISTORY_PARAMS.variant);

  const [kpis, history] = await Promise.all([getInventoryKpis(), variantId ? loadHistory(variantId, params) : null]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Inventory"
        description="Stock per variant with the ledger behind every number. Nothing changes a balance without a movement row, so replaying the history always reproduces what is on the shelf."
        actions={<InventoryTabs active={tab} alertCount={kpis.low + kpis.out + kpis.backorder} />}
      />

      <KpiStrip kpis={kpis} />

      {tab === "levels" ? <LevelsTab params={params} canAdjust={canAdjust} /> : null}
      {tab === "movements" ? <MovementsTab params={params} /> : null}
      {tab === "alerts" ? <AlertsTab canAdjust={canAdjust} /> : null}
      {tab === "import" ? <ImportPanel canAdjust={canAdjust} /> : null}

      <HistorySheet
        detail={history?.detail ?? null}
        movements={history?.movements ?? null}
        typeFilter={history?.typeFilter}
      />
    </div>
  );
}

async function LevelsTab({ params, canAdjust }: { params: SearchParams; canAdjust: boolean }) {
  const list = parseListParams(params, { defaultSort: "available", defaultOrder: "asc", pageSize: 25 });
  const sort = parseInventorySort(list.sort);
  const order = readOrder(params, "asc");
  const filters = parseInventoryFilters(params);

  const [result, categories, seller] = await Promise.all([
    listInventory({ ...list, sort, order }, filters),
    getCategoryOptions(),
    filters.sellerId ? getSellerRef(filters.sellerId) : Promise.resolve(null),
  ]);

  const isFiltered = Boolean(list.q || filters.stock || filters.categoryId || filters.sellerId || filters.variantIds);

  return (
    <InventoryLevels
      rows={result.rows}
      meta={result.meta}
      counts={result.counts}
      sort={sort}
      order={order}
      categories={categories}
      categoryId={filters.categoryId}
      seller={seller}
      canAdjust={canAdjust}
      isFiltered={isFiltered}
    />
  );
}

async function MovementsTab({ params }: { params: SearchParams }) {
  const list = parseListParams(params, { defaultSort: "createdAt", defaultOrder: "desc", pageSize: 50 });
  // No range in the URL means all time; the picker narrows from there.
  const window = hasDateWindow(params, { from: "from", to: "to", preset: "range" }) ? resolveDateRangeParams(params) : null;
  const filters = { ...parseMovementFilters(params, window), q: list.q || undefined };
  const result = await listStockMovements({ ...list, sort: "createdAt" }, filters);

  const isFiltered = Boolean(list.q || filters.type || filters.variantId || window);
  const scoped = filters.variantId ? result.rows[0] : undefined;

  return (
    <MovementsLedger
      result={result}
      isFiltered={isFiltered}
      variantScope={scoped ? variantLabel(scoped.productTitle, scoped.variantName) : filters.variantId ? "One variant" : null}
    />
  );
}

async function AlertsTab({ canAdjust }: { canAdjust: boolean }) {
  const alerts = await getStockAlerts();
  return <AlertsPanel alerts={alerts} canAdjust={canAdjust} />;
}

async function loadHistory(variantId: string, params: SearchParams) {
  const detail = await getVariantInventory(variantId);
  if (!detail) return null;

  // The sheet's params are h-prefixed; map them onto the canonical names the
  // shared range resolver reads.
  const canonical = new URLSearchParams();
  for (const [from, to] of [
    [HISTORY_PARAMS.from, "from"],
    [HISTORY_PARAMS.to, "to"],
    [HISTORY_PARAMS.preset, "range"],
  ] as const) {
    const value = one(params, from);
    if (value) canonical.set(to, value);
  }
  const window = hasDateWindow(canonical, { from: "from", to: "to", preset: "range" }) ? resolveDateRangeParams(canonical) : null;
  const typeFilter = parseMovementType(one(params, HISTORY_PARAMS.type));

  const page = Math.max(1, Number(one(params, HISTORY_PARAMS.page) ?? 1) || 1);
  const list: ListParams = {
    page,
    pageSize: HISTORY_PAGE_SIZE,
    q: "",
    sort: "createdAt",
    order: "desc",
    skip: (page - 1) * HISTORY_PAGE_SIZE,
  };
  const movements = await listStockMovements(list, { variantId, type: typeFilter, from: window?.from, to: window?.to });
  return { detail, movements, typeFilter };
}
