import { History } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { StatusTimeline, type TimelineEvent } from "@/components/shared/status-timeline";
import type { BadgeTone } from "@/lib/enums";

import type { CategoryAuditRow } from "../queries";

/**
 * Activity tab: the audit rows written for this category (D13). Every
 * mutation in the service writes one inside its transaction, so this list
 * is complete by construction - there is no "changed outside the log" case.
 */
const TONE_BY_ACTION: Record<string, BadgeTone> = {
  "category.create": "success",
  "category.delete": "danger",
  "category.status_change": "warning",
  "category.feature": "brand",
  "category.reorder": "info",
  "category.commission_set": "info",
  "category.commission_remove": "warning",
  "category.attribute_exclude": "warning",
  "category.attribute_remove": "warning",
};

export function CategoryActivityTab({ rows }: { rows: CategoryAuditRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="surface">
        <EmptyState compact icon={History} title="No activity recorded" description="Every change to this category will be listed here with who made it." />
      </div>
    );
  }

  const events: TimelineEvent[] = rows.map((row) => ({
    id: row.id,
    title: row.summary,
    description: describeDiff(row.diff, row.action),
    at: new Date(row.createdAt),
    actor: row.actorName ?? row.actorEmail,
    tone: TONE_BY_ACTION[row.action] ?? "neutral",
  }));

  return (
    <div className="surface p-4">
      <StatusTimeline events={events} order="desc" />
    </div>
  );
}

/** "field: from → to" lines for a `diffOf` payload; other diff shapes are summarised. */
function describeDiff(diff: unknown, action: string): string | undefined {
  if (!diff || typeof diff !== "object") return undefined;
  const entries = Object.entries(diff as Record<string, unknown>);
  if (entries.length === 0) return undefined;
  const changed = entries.filter(([, value]) => value && typeof value === "object" && "from" in (value as object) && "to" in (value as object));
  if (changed.length === 0) {
    return action === "category.create" ? undefined : `${entries.length} field${entries.length === 1 ? "" : "s"} recorded`;
  }
  return changed
    .slice(0, 6)
    .map(([key, value]) => {
      const { from, to } = value as { from: unknown; to: unknown };
      return `${key}: ${short(from)} → ${short(to)}`;
    })
    .join(" · ");
}

function short(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value).slice(0, 40);
  const text = String(value);
  return text.length > 40 ? `${text.slice(0, 37)}…` : text;
}
