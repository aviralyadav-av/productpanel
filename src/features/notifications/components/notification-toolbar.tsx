"use client";

import * as React from "react";

import {
  NOTIFICATION_SEVERITIES,
  NOTIFICATION_SEVERITY_META,
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_META,
} from "@/lib/enums";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/shared/date-range-picker";
import { useQueryNav } from "@/hooks/use-query-nav";

/**
 * Secondary filters for the inbox. Native selects that write straight to the
 * URL, matching the rest of the admin: the page is a Server Component and the
 * query string is the state.
 */
const selectClass =
  "border-input bg-background h-8 rounded-md border px-2 text-xs shadow-xs focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none";

export function NotificationFilters({ counts }: { counts: Partial<Record<string, number>> }) {
  const { navigate, searchParams } = useQueryNav();
  const type = searchParams.get("type") ?? "";
  const severity = searchParams.get("severity") ?? "";
  const unread = searchParams.get("unread") === "1";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Filter by notification type"
        className={selectClass}
        value={type}
        onChange={(event) => navigate({ type: event.target.value || null })}
      >
        <option value="">All types</option>
        {NOTIFICATION_TYPES.map((value) => (
          <option key={value} value={value}>
            {NOTIFICATION_TYPE_META[value].label}
            {counts[value] ? ` (${counts[value]})` : ""}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by severity"
        className={selectClass}
        value={severity}
        onChange={(event) => navigate({ severity: event.target.value || null })}
      >
        <option value="">Any severity</option>
        {NOTIFICATION_SEVERITIES.map((value) => (
          <option key={value} value={value}>
            {NOTIFICATION_SEVERITY_META[value].label}
          </option>
        ))}
      </select>

      <Button
        type="button"
        variant={unread ? "default" : "outline"}
        size="sm"
        aria-pressed={unread}
        onClick={() => navigate({ unread: unread ? null : "1" })}
      >
        Unread only
      </Button>

      <DateRangePicker fallback="30d" />
    </div>
  );
}
