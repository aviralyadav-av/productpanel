"use client";

import Link from "next/link";
import type { Route } from "next";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "cn";

import { useQueryNav } from "@/hooks/use-query-nav";
import { Th } from "./data-table";

/**
 * A column header that sorts by rewriting `?sort=&order=` in the URL.
 *
 * It is a link, not a button: the page is a Server Component that re-queries
 * from searchParams, so sorting is navigation. That also means a sorted view
 * is shareable and the back button undoes a sort - both things a client-side
 * table engine would have to reimplement.
 *
 * Clicking the active column flips direction; clicking another column starts
 * it descending for dates and numbers (newest / largest first is what an
 * operator almost always wants) and ascending for text.
 *
 * @example
 *   <SortableTh column="createdAt" label="Placed" currentSort={params.sort} currentOrder={params.order} />
 */
export function SortableTh({
  column,
  label,
  currentSort,
  currentOrder,
  align = "left",
  defaultOrder = "desc",
  width,
  className,
}: {
  column: string;
  label: React.ReactNode;
  currentSort: string;
  currentOrder: "asc" | "desc";
  align?: "left" | "right" | "center";
  /** Direction used the first time this column is clicked. */
  defaultOrder?: "asc" | "desc";
  width?: string;
  className?: string;
}) {
  const { hrefFor } = useQueryNav();
  const isActive = currentSort === column;
  const nextOrder = isActive
    ? currentOrder === "asc"
      ? "desc"
      : "asc"
    : defaultOrder;

  const href = hrefFor({ sort: column, order: nextOrder });
  const Icon = !isActive ? ChevronsUpDown : currentOrder === "asc" ? ArrowUp : ArrowDown;

  return (
    <Th
      align={align}
      width={width}
      // The link carries the cell padding so the whole header is clickable;
      // the th keeps only the extra 4px the first/last columns get.
      className={cn("p-0 first:pl-1 last:pr-1", className)}
      aria-sort={isActive ? (currentOrder === "asc" ? "ascending" : "descending") : "none"}
    >
      <Link
        href={href as Route}
        scroll={false}
        className={cn(
          "group/sort hover:text-foreground focus-visible:ring-ring/50 inline-flex h-full w-full items-center gap-1 px-3 py-2 whitespace-nowrap transition-colors outline-none focus-visible:ring-2",
          align === "right" && "flex-row-reverse text-right",
          align === "center" && "justify-center",
          isActive && "text-foreground",
        )}
      >
        <span>{label}</span>
        <Icon
          aria-hidden
          className={cn(
            "size-3 shrink-0",
            isActive
              ? "text-foreground"
              : "text-muted-foreground/50 group-hover/sort:text-muted-foreground",
          )}
        />
      </Link>
    </Th>
  );
}
