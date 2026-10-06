"use client";

import * as React from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import type { DateRange as DayPickerRange } from "react-day-picker";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useQueryNav } from "@/hooks/use-query-nav";
import {
  DATE_RANGE_PRESETS,
  DATE_RANGE_PRESET_LABELS,
  formatRangeLabel,
  resolveDateRangeParams,
  toIstDayParam,
  type DateRangePreset,
} from "./date-range";

/**
 * Preset list on the left, two-month calendar on the right, writes
 * `?range=` for a preset or `?from=&to=` for a custom span. The page reads it
 * back with resolveDateRangeParams so the picker and the query can never
 * disagree about what "last month" means.
 *
 * Custom selection is staged locally and applied on "Apply" rather than on
 * every click: a range needs two clicks, and navigating after the first would
 * re-render the list with a one-day window.
 */
export function DateRangePicker({
  paramFrom = "from",
  paramTo = "to",
  paramPreset = "range",
  presets = DATE_RANGE_PRESETS,
  fallback = "30d",
  align = "start",
  className,
}: {
  paramFrom?: string;
  paramTo?: string;
  paramPreset?: string;
  presets?: readonly DateRangePreset[];
  fallback?: Exclude<DateRangePreset, "custom">;
  align?: "start" | "end";
  className?: string;
}) {
  const { navigate, searchParams } = useQueryNav();
  const [open, setOpen] = React.useState(false);

  // Map the configured param names onto the canonical ones the resolver reads.
  const canonical = new URLSearchParams();
  const preset = searchParams.get(paramPreset);
  const from = searchParams.get(paramFrom);
  const to = searchParams.get(paramTo);
  if (preset) canonical.set("range", preset);
  if (from) canonical.set("from", from);
  if (to) canonical.set("to", to);
  const current = resolveDateRangeParams(canonical, fallback);

  const [draft, setDraft] = React.useState<DayPickerRange | undefined>();

  function choosePreset(next: DateRangePreset) {
    if (next === "custom") return;
    navigate({ [paramPreset]: next, [paramFrom]: null, [paramTo]: null });
    setOpen(false);
  }

  function applyCustom() {
    if (!draft?.from) return;
    navigate({
      [paramPreset]: null,
      [paramFrom]: toIstDayParam(draft.from),
      [paramTo]: toIstDayParam(draft.to ?? draft.from),
    });
    setOpen(false);
  }

  const summary =
    current.preset === "custom"
      ? current.label
      : `${DATE_RANGE_PRESET_LABELS[current.preset]}`;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setDraft({ from: current.from, to: current.to });
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("justify-start font-normal", className)}
          aria-label={`Date range: ${summary}`}
        >
          <CalendarDays className="text-muted-foreground" />
          <span className="truncate">{summary}</span>
          {current.preset !== "custom" ? (
            <span className="text-muted-foreground hidden truncate sm:inline" data-numeric>
              {formatRangeLabel(current.from, current.to)}
            </span>
          ) : null}
          <ChevronDown className="text-muted-foreground ml-auto" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align={align} className="w-auto p-0">
        <div className="flex flex-col sm:flex-row">
          <ul
            role="listbox"
            aria-label="Preset ranges"
            className="flex flex-row flex-wrap gap-0.5 border-b p-1.5 sm:w-36 sm:flex-col sm:border-r sm:border-b-0"
          >
            {presets
              .filter((item) => item !== "custom")
              .map((item) => (
                <li key={item} role="option" aria-selected={current.preset === item}>
                  <button
                    type="button"
                    onClick={() => choosePreset(item)}
                    className={cn(
                      "hover:bg-accent w-full rounded-md px-2 py-1 text-left text-xs transition-colors",
                      current.preset === item && "bg-accent font-medium",
                    )}
                  >
                    {DATE_RANGE_PRESET_LABELS[item]}
                  </button>
                </li>
              ))}
          </ul>

          {presets.includes("custom") ? (
            <div className="flex flex-col">
              <Calendar
                mode="range"
                numberOfMonths={2}
                defaultMonth={draft?.from ?? current.from}
                selected={draft}
                onSelect={setDraft}
                disabled={{ after: new Date() }}
                className="[--cell-size:--spacing(7)]"
              />
              <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
                <span className="text-muted-foreground text-xs" data-numeric>
                  {draft?.from
                    ? formatRangeLabel(draft.from, draft.to ?? draft.from)
                    : "Pick a start and end day"}
                </span>
                <Button
                  type="button"
                  size="sm"
                  disabled={!draft?.from}
                  onClick={applyCustom}
                >
                  Apply
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
