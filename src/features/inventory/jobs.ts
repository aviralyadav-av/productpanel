import { db } from "@/lib/db";
import { registerJobHandler } from "@/lib/queue";
import { notify } from "@/features/notifications/service";

/**
 * Inventory background jobs. No `server-only` / `next/*` imports: the worker
 * (`npm run worker`) loads this through src/lib/queue/register-all.ts as a
 * plain tsx process.
 *
 *   stock.check_low   daily (RECURRING_JOBS). One digest per state - "12
 *                     variants are low", "3 are out" - instead of one
 *                     notification per variant, because the per-variant alerts
 *                     already fire the moment a movement crosses the line
 *                     (afterStockChange). The digest is the morning summary
 *                     for whoever restocks; it links to the alerts tab.
 *
 * Idempotent per run: the scheduler dedupes the job itself, and a re-run
 * merely posts the same counts again.
 */

export const ALERTS_HREF = "/admin/inventory?tab=alerts";

export type LowStockCheckResult = {
  low: number;
  out: number;
  backorder: number;
  notified: number;
};

export async function checkLowStock(): Promise<LowStockCheckResult> {
  const grouped = await db.inventoryItem.groupBy({
    by: ["stockState"],
    where: {
      stockState: { in: ["LOW_STOCK", "OUT_OF_STOCK", "BACKORDER"] },
      // Only stock somebody can actually buy: inactive variants and unpublished
      // products being empty is not news.
      variant: { deletedAt: null, isActive: true, product: { deletedAt: null, status: "PUBLISHED" } },
    },
    _count: { _all: true },
  });
  const count = (state: string) => grouped.find((row) => row.stockState === state)?._count._all ?? 0;
  const low = count("LOW_STOCK");
  const out = count("OUT_OF_STOCK");
  const backorder = count("BACKORDER");

  let notified = 0;
  if (low > 0) {
    const result = await notify({
      type: "LOW_STOCK",
      severity: "warning",
      title: `${low} variant${low === 1 ? " is" : "s are"} low on stock`,
      body: "Daily stock check: at or below their low-stock threshold, still sellable.",
      href: ALERTS_HREF,
      entityType: "InventoryItem",
    });
    notified += result.recipients;
  }
  if (out + backorder > 0) {
    const total = out + backorder;
    const result = await notify({
      type: "OUT_OF_STOCK",
      severity: "critical",
      title: `${total} variant${total === 1 ? " has" : "s have"} nothing available`,
      body:
        backorder > 0
          ? `Daily stock check: ${out} out of stock, ${backorder} on backorder.`
          : "Daily stock check: nothing available to sell.",
      href: ALERTS_HREF,
      entityType: "InventoryItem",
    });
    notified += result.recipients;
  }

  return { low, out, backorder, notified };
}

export function registerInventoryJobHandlers(): void {
  registerJobHandler("stock.check_low", async ({ log }) => {
    const result = await checkLowStock();
    log(`low=${result.low} out=${result.out} backorder=${result.backorder} notified=${result.notified}`);
    return result;
  });
}
