import { History } from "lucide-react";

import type { BadgeTone } from "@/lib/enums";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusTimeline, type TimelineEvent } from "@/components/shared/status-timeline";

import type { ContentAuditRow } from "../schemas";

/**
 * Activity panel for CMS entities (pages, posts, categories): the audit rows
 * the services wrote inside their transactions (D13), newest first. Server-
 * compatible - it is just a timeline. Shared by pages and blog so a change in
 * how a diff is summarised shows up identically in both.
 */
const TONE_BY_SUFFIX: Record<string, BadgeTone> = {
  create: "success",
  delete: "danger",
  status_change: "warning",
  duplicate: "info",
  reorder: "info",
  preview: "neutral",
  feature: "brand",
};

export function ContentActivity({ rows, entityLabel = "record" }: { rows: ContentAuditRow[]; entityLabel?: string }) {
  if (rows.length === 0) {
    return (
      <div className="surface">
        <EmptyState compact icon={History} title="No activity recorded" description={`Every change to this ${entityLabel} will be listed here with who made it.`} />
      </div>
    );
  }

  const events: TimelineEvent[] = rows.map((row) => ({
    id: row.id,
    title: row.summary,
    description: describeDiff(row.diff, row.action),
    at: new Date(row.createdAt),
    actor: row.actorName ?? row.actorEmail,
    tone: TONE_BY_SUFFIX[row.action.split(".").pop() ?? ""] ?? "neutral",
  }));

  return (
    <div className="surface p-4">
      <StatusTimeline events={events} order="desc" />
    </div>
  );
}

/** "field: from → to" lines for a `diffOf` payload; other shapes are summarised. */
function describeDiff(diff: unknown, action: string): string | undefined {
  if (!diff || typeof diff !== "object") return undefined;
  const entries = Object.entries(diff as Record<string, unknown>);
  if (entries.length === 0) return undefined;
  const changed = entries.filter(([, value]) => value && typeof value === "object" && "from" in (value as object) && "to" in (value as object));
  if (changed.length === 0) {
    return action.endsWith(".create") ? undefined : `${entries.length} field${entries.length === 1 ? "" : "s"} recorded`;
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
