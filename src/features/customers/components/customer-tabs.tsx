import Link from "next/link";
import type { Route } from "next";

import { cn } from "cn";

import { CUSTOMER_TAB_LABELS, CUSTOMER_TABS, type CustomerTab } from "@/features/customers/filters";

/**
 * Tab strip for the customer profile. Plain links writing `?tab=` so the
 * Server Component page only loads the active tab's data and the URL is
 * shareable. Counts come from the detail query; zero is shown as nothing.
 */
export function CustomerTabs({ customerId, active, counts }: { customerId: string; active: CustomerTab; counts: Partial<Record<CustomerTab, number>> }) {
  return (
    <nav aria-label="Customer sections" className="surface overflow-x-auto">
      <ul role="tablist" className="flex min-w-max items-center gap-0.5 p-1">
        {CUSTOMER_TABS.map((tab) => {
          const isActive = tab === active;
          const count = counts[tab];
          return (
            <li key={tab}>
              <Link
                href={`/admin/customers/${customerId}${tab === "overview" ? "" : `?tab=${tab}`}` as Route}
                role="tab"
                aria-selected={isActive}
                scroll={false}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
                  isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                  tab === "danger" && !isActive && "text-destructive/80 hover:text-destructive",
                )}
              >
                {CUSTOMER_TAB_LABELS[tab]}
                {count ? (
                  <span data-numeric className="text-muted-foreground text-[10px]">
                    {count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
