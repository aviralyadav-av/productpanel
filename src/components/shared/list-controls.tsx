"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mergeQuery, type PageMeta } from "@/lib/list-params";

/**
 * All three controls write to the URL and nothing else. The page is a Server
 * Component that re-renders from searchParams, so there is no client cache to
 * keep in sync and no stale-state class of bug.
 */

function useQueryNav() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return React.useCallback(
    (changes: Record<string, string | number | null | undefined>) => {
      const query = mergeQuery(searchParams.toString(), changes);
      router.replace(`${pathname}${query}` as never, { scroll: false });
    },
    [router, pathname, searchParams],
  );
}

export function SearchInput({
  placeholder = "Search…",
  paramKey = "q",
  className,
}: {
  placeholder?: string;
  paramKey?: string;
  className?: string;
}) {
  const searchParams = useSearchParams();
  const navigate = useQueryNav();
  const initial = searchParams.get(paramKey) ?? "";
  const [value, setValue] = React.useState(initial);

  // Keep in sync when the URL changes from elsewhere (back button, a filter
  // chip clearing search, a link from the dashboard).
  React.useEffect(() => setValue(initial), [initial]);

  React.useEffect(() => {
    if (value === initial) return;
    const timer = setTimeout(() => navigate({ [paramKey]: value || null }), 300);
    return () => clearTimeout(timer);
  }, [value, initial, navigate, paramKey]);

  return (
    <div className={cn("relative", className)}>
      <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2" />
      <Input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-8 pl-8 pr-8"
      />
      {value ? (
        <button
          type="button"
          onClick={() => setValue("")}
          aria-label="Clear search"
          className="text-muted-foreground hover:text-foreground absolute right-2 top-1/2 -translate-y-1/2"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export type FilterOption = { value: string; label: string; count?: number };

export function FilterTabs({
  paramKey,
  options,
  allLabel = "All",
  className,
}: {
  paramKey: string;
  options: FilterOption[];
  allLabel?: string;
  className?: string;
}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const active = searchParams.get(paramKey);

  const items: Array<FilterOption & { isActive: boolean; href: string }> = [
    { value: "", label: allLabel },
    ...options,
  ].map((option) => ({
    ...option,
    isActive: (active ?? "") === option.value,
    href: `${pathname}${mergeQuery(searchParams.toString(), {
      [paramKey]: option.value || null,
    })}`,
  }));

  return (
    <div
      role="tablist"
      className={cn(
        "bg-muted inline-flex items-center gap-0.5 rounded-lg p-0.5",
        className,
      )}
    >
      {items.map((item) => (
        <Link
          key={item.value || "__all"}
          href={item.href as never}
          role="tab"
          aria-selected={item.isActive}
          scroll={false}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors",
            item.isActive
              ? "bg-background text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {item.label}
          {typeof item.count === "number" ? (
            <span
              data-numeric
              className={cn(
                "text-[10px]",
                item.isActive ? "text-muted-foreground" : "text-muted-foreground/70",
              )}
            >
              {item.count}
            </span>
          ) : null}
        </Link>
      ))}
    </div>
  );
}

export function PaginationBar({
  meta,
  itemLabel = "results",
}: {
  meta: PageMeta;
  itemLabel?: string;
}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();

  function pageHref(page: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (page <= 1) params.delete("page");
    else params.set("page", String(page));
    const query = params.toString();
    return `${pathname}${query ? `?${query}` : ""}`;
  }

  return (
    <div className="text-muted-foreground flex items-center justify-between gap-3 border-t px-4 py-2 text-xs">
      <p data-numeric>
        {meta.total === 0
          ? `No ${itemLabel}`
          : `${meta.from}–${meta.to} of ${meta.total} ${itemLabel}`}
      </p>

      <div className="flex items-center gap-1">
        <Button
          asChild={meta.page > 1}
          variant="outline"
          size="icon-xs"
          disabled={meta.page <= 1}
          aria-label="Previous page"
        >
          {meta.page > 1 ? (
            <Link href={pageHref(meta.page - 1) as never} scroll={false}>
              <ChevronLeft />
            </Link>
          ) : (
            <ChevronLeft />
          )}
        </Button>

        <span data-numeric className="px-1">
          {meta.page} / {meta.totalPages}
        </span>

        <Button
          asChild={meta.page < meta.totalPages}
          variant="outline"
          size="icon-xs"
          disabled={meta.page >= meta.totalPages}
          aria-label="Next page"
        >
          {meta.page < meta.totalPages ? (
            <Link href={pageHref(meta.page + 1) as never} scroll={false}>
              <ChevronRight />
            </Link>
          ) : (
            <ChevronRight />
          )}
        </Button>
      </div>
    </div>
  );
}
