import Link from "next/link";
import type { Route } from "next";
import { cn } from "cn";

import { inventoryHref } from "@/features/inventory/format";
import type { InventoryTab } from "@/features/inventory/schemas";
import { CountBadge } from "@/components/shared/count-badge";

const TABS: Array<{ value: InventoryTab; label: string }> = [
  { value: "levels", label: "Stock levels" },
  { value: "movements", label: "Movements" },
  { value: "alerts", label: "Alerts" },
  { value: "import", label: "CSV import" },
];

/**
 * The four views of /admin/inventory are `?tab=` on one route. Unlike
 * FilterTabs these links drop the other query params: a search typed on the
 * levels tab means nothing on the import tab.
 */
export function InventoryTabs({ active, alertCount }: { active: InventoryTab; alertCount: number }) {
  return (
    <nav role="tablist" aria-label="Inventory view" className="bg-muted inline-flex items-center gap-0.5 rounded-lg p-0.5">
      {TABS.map((tab) => {
        const isActive = tab.value === active;
        return (
          <Link
            key={tab.value}
            href={inventoryHref({ tab: tab.value === "levels" ? null : tab.value }) as Route}
            role="tab"
            aria-selected={isActive}
            scroll={false}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors",
              isActive ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            {tab.value === "alerts" && alertCount > 0 ? (
              <CountBadge count={alertCount} tone="warning" label={`${alertCount} stock alerts`} />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
