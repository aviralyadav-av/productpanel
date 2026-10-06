"use client";

import * as React from "react";

import { INQUIRY_PRIORITIES, INQUIRY_PRIORITY_META, INQUIRY_TYPES, INQUIRY_TYPE_META } from "@/lib/enums";
import { DateRangePicker } from "@/components/shared/date-range-picker";
import { useQueryNav } from "@/hooks/use-query-nav";

import type { AssigneeRef } from "@/features/inquiries/types";

/** Secondary filters for /admin/inquiries; native selects that write to the URL. */
const selectClass =
  "border-input bg-background h-8 rounded-md border px-2 text-xs shadow-xs focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none";

export function InquiryFilters({ users }: { users: AssigneeRef[] }) {
  const { navigate, searchParams } = useQueryNav();
  const type = searchParams.get("type") ?? "";
  const priority = searchParams.get("priority") ?? "";
  const assignedTo = searchParams.get("assignedTo") ?? "";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Filter by type" className={selectClass} value={type} onChange={(event) => navigate({ type: event.target.value || null })}>
        <option value="">All types</option>
        {INQUIRY_TYPES.map((item) => (
          <option key={item} value={item}>
            {INQUIRY_TYPE_META[item].label}
          </option>
        ))}
      </select>
      <select aria-label="Filter by priority" className={selectClass} value={priority} onChange={(event) => navigate({ priority: event.target.value || null })}>
        <option value="">Any priority</option>
        {INQUIRY_PRIORITIES.map((item) => (
          <option key={item} value={item}>
            {INQUIRY_PRIORITY_META[item].label}
          </option>
        ))}
      </select>
      <select aria-label="Filter by assignee" className={selectClass} value={assignedTo} onChange={(event) => navigate({ assignedTo: event.target.value || null })}>
        <option value="">Anyone</option>
        <option value="unassigned">Unassigned</option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name ?? user.email}
          </option>
        ))}
      </select>
      <DateRangePicker fallback="this_year" />
    </div>
  );
}
