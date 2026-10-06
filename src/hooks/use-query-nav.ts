"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { mergeQuery } from "@/lib/list-params";

/**
 * Writes filter changes to the URL and nothing else.
 *
 * List pages are Server Components that re-render from searchParams, so the
 * URL *is* the state. Every control that changes a filter (search, tabs, date
 * range, sort) goes through this one hook so they all agree on the rules:
 * empties are dropped, and any filter change resets the page number (see
 * mergeQuery). `replace` rather than `push` keeps the back button meaningful -
 * ten keystrokes in a search box should not be ten history entries.
 */
export function useQueryNav() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const navigate = React.useCallback(
    (changes: Record<string, string | number | null | undefined>) => {
      const query = mergeQuery(searchParams.toString(), changes);
      router.replace(`${pathname}${query}` as never, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  /** The href a Link would use for the same change, for anchor-based controls. */
  const hrefFor = React.useCallback(
    (changes: Record<string, string | number | null | undefined>) =>
      `${pathname}${mergeQuery(searchParams.toString(), changes)}`,
    [pathname, searchParams],
  );

  return { navigate, hrefFor, searchParams, pathname };
}
