import Link from "next/link";
import { ScrollText, X } from "lucide-react";
import { cn } from "cn";

import type { MovementsResult } from "@/features/inventory/queries";
import {
  DataTable,
  DataTableBody,
  DataTableHead,
  Td,
  Th,
  Tr,
} from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Panel } from "@/components/shared/panel";
import { StatusPill } from "@/components/shared/status-badge";
import { FilterTabs, PaginationBar } from "@/components/shared/list-controls";
import { formatIstDateTime } from "@/lib/dates";
import { STOCK_MOVEMENT_META, type StockMovementType } from "@/lib/enums";

/**
 * The ledger, newest first. Append-only by design: there is no edit and no
 * delete here, because a stock history an operator can rewrite answers no
 * question worth asking. A mistake is corrected by posting the opposite
 * movement, which is why CORRECTION is one of the types.
 */
export function MovementHistory({
  result,
  variantFilter,
}: {
  result: MovementsResult;
  variantFilter: { label: string; clearHref: string } | null;
}) {
  const hasAnyMovement = result.typeCounts.length > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {hasAnyMovement ? (
          <FilterTabs
            paramKey="type"
            allLabel="All types"
            options={result.typeCounts.map((row) => ({
              value: row.type,
              label: STOCK_MOVEMENT_META[row.type].label,
              count: row.count,
            }))}
          />
        ) : null}

        {variantFilter ? (
          <Link
            href={variantFilter.clearHref as never}
            scroll={false}
            className="bg-brand-muted text-brand hover:bg-brand-muted/70 inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors"
          >
            {variantFilter.label}
            <X className="size-3" />
            <span className="sr-only">Clear the variant filter</span>
          </Link>
        ) : null}
      </div>

      <Panel
        title="Movement ledger"
        description="Every change to stock, in the order it happened"
        bodyClassName="p-0"
      >
        {result.rows.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No movements recorded"
            description={
              variantFilter
                ? "This variant has no ledger entries yet. Adjusting its stock writes the first one."
                : "Stock movements are written when an adjustment is saved here, or when order flow consumes stock. Nothing has moved yet."
            }
          />
        ) : (
          <>
            <DataTable>
              <DataTableHead>
                <Th>When (IST)</Th>
                <Th>Product</Th>
                <Th>Type</Th>
                <Th align="right">Change</Th>
                <Th align="right">Balance</Th>
                <Th>Reason</Th>
                <Th>Order</Th>
                <Th>By</Th>
              </DataTableHead>

              <DataTableBody>
                {result.rows.map((movement) => {
                  const meta =
                    STOCK_MOVEMENT_META[movement.type as StockMovementType];

                  return (
                    <Tr key={movement.id}>
                      <Td className="text-muted-foreground whitespace-nowrap">
                        <span data-numeric>
                          {formatIstDateTime(movement.createdAt)}
                        </span>
                      </Td>

                      <Td className="max-w-[16rem]">
                        <Link
                          href={`/products/${movement.productId}` as never}
                          className="block truncate font-medium hover:underline"
                        >
                          {movement.productTitle}
                        </Link>
                        <Link
                          href={
                            `/inventory?tab=movements&variant=${movement.variantId}` as never
                          }
                          scroll={false}
                          className="text-muted-foreground block truncate text-[11px] hover:underline"
                        >
                          {movement.variantName}
                          {movement.sku ? ` · ${movement.sku}` : ""}
                        </Link>
                      </Td>

                      <Td>
                        <StatusPill
                          label={meta?.label ?? movement.type}
                          tone={meta?.tone ?? "neutral"}
                        />
                      </Td>

                      <Td
                        numeric
                        align="right"
                        className={cn(
                          "font-medium",
                          movement.delta > 0 && "text-success",
                          movement.delta < 0 && "text-destructive",
                          movement.delta === 0 && "text-muted-foreground",
                        )}
                      >
                        {movement.delta > 0 ? "+" : ""}
                        {movement.delta}
                      </Td>

                      <Td numeric align="right">
                        {movement.balance}
                      </Td>

                      <Td className="text-muted-foreground max-w-[20rem]">
                        <p className="truncate">{movement.reason ?? "—"}</p>
                        {movement.note ? (
                          <p className="truncate text-[11px] opacity-80">
                            {movement.note}
                          </p>
                        ) : null}
                      </Td>

                      <Td>
                        {movement.orderId ? (
                          <Link
                            href={`/orders/${movement.orderId}` as never}
                            className="font-medium hover:underline"
                          >
                            {movement.orderNumber ?? "View"}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </Td>

                      <Td className="text-muted-foreground max-w-[12rem] truncate">
                        {/* No actor means the seeder or order flow wrote it. */}
                        {movement.actorName ?? "System"}
                      </Td>
                    </Tr>
                  );
                })}
              </DataTableBody>
            </DataTable>

            <PaginationBar meta={result.meta} itemLabel="movements" />
          </>
        )}
      </Panel>
    </div>
  );
}
