import { History } from "lucide-react";

import type { BadgeTone } from "@/lib/enums";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusTimeline, type TimelineEvent } from "@/components/shared/status-timeline";

import type { CouponActivityRow } from "../queries";

const TONE_BY_ACTION: Record<string, BadgeTone> = {
  "coupon.create": "success",
  "coupon.duplicate": "info",
  "coupon.enable": "success",
  "coupon.disable": "warning",
  "coupon.delete": "danger",
};

function describeDiff(diff: unknown): string | undefined {
  if (!diff || typeof diff !== "object" || Array.isArray(diff)) return undefined;
  const keys = Object.keys(diff as Record<string, unknown>);
  if (keys.length === 0) return undefined;
  const shown = keys.slice(0, 6).join(", ");
  return keys.length > 6 ? `Changed ${shown} and ${keys.length - 6} more` : `Changed ${shown}`;
}

/** Audit trail for one coupon (D13 makes coupon.create mandatory; the rest come free from the service). */
export function CouponActivity({ rows }: { rows: CouponActivityRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="surface">
        <EmptyState icon={History} title="No activity recorded" description="Creation, edits, enable/disable and deletion are logged here with who did them." compact />
      </div>
    );
  }

  const events: TimelineEvent[] = rows.map((row) => ({
    id: row.id,
    title: row.summary,
    description: row.action === "coupon.update" ? describeDiff(row.diff) : undefined,
    at: row.createdAt,
    actor: row.actorEmail,
    tone: TONE_BY_ACTION[row.action] ?? "neutral",
  }));

  return (
    <div className="surface p-4">
      <StatusTimeline events={events} />
    </div>
  );
}
