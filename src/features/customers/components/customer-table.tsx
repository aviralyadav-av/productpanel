import Link from "next/link";
import { ChevronDown, ChevronRight, ChevronsUpDown, ChevronUp } from "lucide-react";
import { cn } from "cn";

import {
  DataTable,
  DataTableBody,
  DataTableHead,
  Td,
  Th,
  Tr,
} from "@/components/shared/data-table";
import { CustomerStatusBadge } from "@/components/shared/status-badge";
import { formatIstDate } from "@/lib/dates";
import { formatNumber, formatPaise } from "@/lib/money";
import type { SearchParams } from "@/lib/list-params";
import type { CustomerRow, CustomerSort } from "../schemas";

/**
 * A Server Component. Opening a customer is a plain link that adds
 * ?customer=<id> to the URL, so the detail panel needs no client state and an
 * open record can be pasted to someone else exactly as it looks.
 */

function toSearchParams(params: SearchParams): URLSearchParams {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, item);
    } else if (value !== undefined) {
      search.set(key, value);
    }
  }

  return search;
}

function href(search: URLSearchParams): string {
  const query = search.toString();
  return `/customers${query ? `?${query}` : ""}`;
}

function rowHref(params: SearchParams, id: string): string {
  const search = toSearchParams(params);
  search.set("customer", id);
  return href(search);
}

function sortHref(
  params: SearchParams,
  key: CustomerSort,
  nextOrder: "asc" | "desc",
): string {
  const search = toSearchParams(params);
  search.set("sort", key);
  search.set("order", nextOrder);
  // Re-sorting invalidates the page number, and there is no reason to keep a
  // detail panel open behind the list you are reordering.
  search.delete("page");
  search.delete("customer");
  return href(search);
}

export function CustomerTable({
  rows,
  params,
  sort,
  order,
  selectedId,
}: {
  rows: CustomerRow[];
  params: SearchParams;
  sort: CustomerSort;
  order: "asc" | "desc";
  selectedId?: string;
}) {
  return (
    <DataTable>
      <DataTableHead>
        <Th>Customer</Th>
        <Th>Email</Th>
        <Th>Phone</Th>
        <SortTh
          label="Orders"
          sortKey="orders"
          params={params}
          sort={sort}
          order={order}
        />
        <SortTh
          label="Lifetime value"
          sortKey="ltv"
          params={params}
          sort={sort}
          order={order}
        />
        <Th align="right">Avg order</Th>
        <Th align="right">Last order</Th>
        <SortTh
          label="Joined"
          sortKey="joined"
          params={params}
          sort={sort}
          order={order}
        />
        <Th>Status</Th>
        <Th width="2.5rem">
          <span className="sr-only">Open</span>
        </Th>
      </DataTableHead>

      <DataTableBody>
        {rows.map((row) => {
          const open = rowHref(params, row.id);
          const isSelected = row.id === selectedId;

          return (
            <Tr key={row.id} className={cn(isSelected && "bg-accent/60")}>
              <Td>
                <div className="max-w-60">
                  <Link
                    href={open as never}
                    scroll={false}
                    className={cn(
                      "block truncate font-medium hover:underline",
                      !row.fullName && "text-muted-foreground",
                    )}
                  >
                    {row.fullName ?? row.email}
                  </Link>
                  {row.hasAccount ? (
                    <p className="text-muted-foreground text-[10px]">
                      Storefront login linked
                    </p>
                  ) : null}
                </div>
              </Td>

              <Td className="text-muted-foreground">
                <span className="block max-w-56 truncate">
                  {row.email}
                </span>
              </Td>

              <Td className="text-muted-foreground tabular">
                {row.phoneMasked ?? "—"}
              </Td>

              <Td align="right" numeric>
                {formatNumber(row.orderCount)}
              </Td>

              <Td align="right" numeric className="font-medium">
                {formatPaise(row.lifetimeValuePaise)}
              </Td>

              <Td align="right" numeric className="text-muted-foreground">
                {row.orderCount > 0 ? formatPaise(row.averageOrderPaise) : "—"}
              </Td>

              <Td align="right" numeric className="text-muted-foreground">
                {row.lastOrderAt ? formatIstDate(row.lastOrderAt) : "—"}
              </Td>

              <Td align="right" numeric className="text-muted-foreground">
                {formatIstDate(row.createdAt)}
              </Td>

              <Td>
                <CustomerStatusBadge status={row.status} />
              </Td>

              <Td align="right">
                <Link
                  href={open as never}
                  scroll={false}
                  aria-label={`Open ${row.fullName ?? row.email}`}
                  className="text-muted-foreground hover:text-foreground inline-flex"
                >
                  <ChevronRight className="size-3.5" />
                </Link>
              </Td>
            </Tr>
          );
        })}
      </DataTableBody>
    </DataTable>
  );
}

function SortTh({
  label,
  sortKey,
  params,
  sort,
  order,
}: {
  label: string;
  sortKey: CustomerSort;
  params: SearchParams;
  sort: CustomerSort;
  order: "asc" | "desc";
}) {
  const isActive = sort === sortKey;
  // Every sortable column here is a "biggest first" question, so an inactive
  // header goes to descending and a second click flips it.
  const nextOrder = isActive && order === "desc" ? "asc" : "desc";

  const Icon = !isActive
    ? ChevronsUpDown
    : order === "desc"
      ? ChevronDown
      : ChevronUp;

  return (
    <Th align="right">
      <Link
        href={sortHref(params, sortKey, nextOrder) as never}
        scroll={false}
        aria-label={`Sort by ${label.toLowerCase()}, ${nextOrder === "desc" ? "highest first" : "lowest first"}`}
        className={cn(
          "hover:text-foreground inline-flex items-center gap-1 transition-colors",
          isActive && "text-foreground",
        )}
      >
        {label}
        <Icon className={cn("size-3", !isActive && "opacity-40")} />
      </Link>
    </Th>
  );
}
