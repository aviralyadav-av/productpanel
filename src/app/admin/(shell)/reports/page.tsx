import type { Metadata } from "next";
import { BarChart3 } from "lucide-react";

import { requirePermission } from "@/lib/auth/guards";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";

import { ReportCard } from "@/features/reports/components/report-card";
import { reportIndexCards } from "@/features/reports/queries";

export const metadata: Metadata = { title: "Reports" };

/**
 * /admin/reports - the index of the thirteen reports of blueprint E4.
 *
 * D14: a report needs `reports.view` plus its own `requires` codes, and the
 * index lists ONLY what this actor can open. A finance-only operator sees the
 * money reports and never learns that an inventory one exists; nothing here
 * renders a card that would 403 on click.
 *
 * Each card carries its last-30-day headline, computed by the report itself,
 * so the index doubles as a summary of the month.
 */
export default async function ReportsPage() {
  const actor = await requirePermission("reports.view");
  const cards = await reportIndexCards(actor);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reports"
        description="Sales, catalogue, seller and finance reports over any date range, with filters, sorting and CSV / Excel / print export. Every figure is bucketed by the IST business day."
      />

      {cards.length === 0 ? (
        <div className="surface">
          <EmptyState
            icon={BarChart3}
            title="No reports available to you"
            description="Reports also require the permission of the module they read - orders, products, sellers, finance. Ask an administrator for the module permission you need."
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {cards.map((card) => (
            <ReportCard key={card.key} card={card} />
          ))}
        </div>
      )}
    </div>
  );
}
