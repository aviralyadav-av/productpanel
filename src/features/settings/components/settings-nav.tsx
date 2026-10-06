import Link from "next/link";
import type { Route } from "next";
import { cn } from "cn";

import { TAB_LABELS, type SettingsTab } from "@/features/settings/schemas";

/**
 * The settings tab strip. A plain list of links rather than a client tab
 * component: the page is a Server Component keyed on `?tab=`, so a tab is
 * navigation - shareable, back-button friendly and rendered on the server with
 * only the fields that tab needs.
 */
export function SettingsNav({
  tabs,
  active,
}: {
  tabs: readonly SettingsTab[];
  active: SettingsTab;
}) {
  return (
    <nav aria-label="Settings sections" className="surface overflow-x-auto p-1">
      <ul className="flex min-w-max items-center gap-0.5">
        {tabs.map((tab) => {
          const isActive = tab === active;
          return (
            <li key={tab}>
              <Link
                href={`/admin/settings?tab=${tab}` as Route}
                aria-current={isActive ? "page" : undefined}
                scroll={false}
                className={cn(
                  "inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors",
                  isActive
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {TAB_LABELS[tab]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
