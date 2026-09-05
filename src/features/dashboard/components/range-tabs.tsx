"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "cn";

import { RANGE_PRESETS, type RangePreset } from "@/lib/dates";

/**
 * The date range lives in the URL, not in React state. That makes the current
 * view shareable and bookmarkable, keeps the back button working, and lets the
 * page stay a Server Component that simply reads searchParams.
 */
export function RangeTabs({ value }: { value: RangePreset }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function hrefFor(preset: RangePreset) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", preset);
    return `${pathname}?${params.toString()}`;
  }

  return (
    <div
      role="tablist"
      aria-label="Date range"
      className="bg-muted inline-flex items-center gap-0.5 rounded-lg p-0.5"
    >
      {(Object.keys(RANGE_PRESETS) as RangePreset[]).map((preset) => {
        const isActive = preset === value;
        return (
          <Link
            key={preset}
            href={hrefFor(preset) as never}
            role="tab"
            aria-selected={isActive}
            scroll={false}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              isActive
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {RANGE_PRESETS[preset].label}
          </Link>
        );
      })}
    </div>
  );
}
