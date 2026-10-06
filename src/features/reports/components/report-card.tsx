import Link from "next/link";
import { ArrowRight } from "lucide-react";

import type { ReportCard as ReportCardData } from "../queries";
import { formatTotal } from "./report-totals";

/**
 * One card on /admin/reports. It carries the headline for the last 30 days so
 * the index is itself a small dashboard: an operator scanning it sees which
 * report is worth opening before opening any of them.
 *
 * A card only exists for a report the actor may open (D14), so the whole card
 * is the link - there is no disabled state to explain.
 */
export function ReportCard({ card }: { card: ReportCardData }) {
  return (
    <Link
      href={card.href}
      className="surface hover:border-brand/40 group flex flex-col gap-3 p-4 transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight">{card.title}</h2>
        <ArrowRight className="text-muted-foreground/50 group-hover:text-brand size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" />
      </div>

      <p className="text-muted-foreground min-h-8 text-xs leading-relaxed">{card.description}</p>

      <div className="mt-auto">
        {card.headline ? (
          <>
            <p data-numeric className="text-xl font-semibold tracking-tight">
              {formatTotal(card.headline)}
            </p>
            <p className="text-muted-foreground/80 text-[11px]">
              {card.headline.label} &middot; last 30 days
            </p>
          </>
        ) : (
          <p className="text-muted-foreground/70 text-[11px]">
            Headline unavailable &mdash; open the report for details.
          </p>
        )}
      </div>
    </Link>
  );
}
