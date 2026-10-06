"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { ChevronLeft, ChevronRight, ScrollText } from "lucide-react";

import { MovementTypeBadge, OrderLink, SignedDelta, reservedSummary } from "@/features/inventory/components/movement-cells";
import { productHref, variantLabel } from "@/features/inventory/format";
import type { MovementListResult, VariantInventoryDetail } from "@/features/inventory/queries";
import { HISTORY_PARAMS } from "@/features/inventory/schemas";
import { Sparkline } from "@/components/charts/sparkline";
import { CopyButton } from "@/components/shared/copy-button";
import { DateRangePicker } from "@/components/shared/date-range-picker";
import { ProductThumb } from "@/components/shared/product-thumb";
import { StatusTimeline, type TimelineEvent } from "@/components/shared/status-timeline";
import { StockBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useQueryNav } from "@/hooks/use-query-nav";
import { STOCK_MOVEMENT_META, STOCK_MOVEMENT_TYPES, type StockMovementType } from "@/lib/enums";
import { formatNumber } from "@/lib/money";

const ALL_TYPES = "__all";

/**
 * `?variant=<id>` opens this over whichever tab is underneath. Its own
 * filters and page are `h`-prefixed (HISTORY_PARAMS) so paging through a
 * variant's history never moves the table behind it. Closing the sheet
 * removes every `h*` param in one navigation.
 *
 * The timeline is the ledger, newest first: each row carries the balance
 * after it, so the operator reads "what happened and where that left us"
 * without replaying anything. Server-paginated - a busy SKU has thousands.
 */
export function HistorySheet({
  detail,
  movements,
  typeFilter,
}: {
  detail: VariantInventoryDetail | null;
  movements: MovementListResult | null;
  typeFilter: StockMovementType | undefined;
}) {
  const { navigate } = useQueryNav();

  function close() {
    navigate({
      [HISTORY_PARAMS.variant]: null,
      [HISTORY_PARAMS.page]: null,
      [HISTORY_PARAMS.type]: null,
      [HISTORY_PARAMS.from]: null,
      [HISTORY_PARAMS.to]: null,
      [HISTORY_PARAMS.preset]: null,
    });
  }

  const events: TimelineEvent[] = (movements?.rows ?? []).map((row) => ({
    id: row.id,
    at: row.createdAt,
    tone: STOCK_MOVEMENT_META[row.type]?.tone ?? "neutral",
    actor: row.actorName ?? (row.orderId ? "Order flow" : "System"),
    title: (
      <span className="flex flex-wrap items-center gap-1.5">
        <MovementTypeBadge type={row.type} />
        <SignedDelta value={row.delta} />
        <span className="text-muted-foreground font-normal">
          → <span data-numeric>{row.balance}</span> on hand
        </span>
        {row.reservedDelta !== 0 ? (
          <span className="text-muted-foreground font-normal">· {reservedSummary(row.reservedDelta, row.reservedBalance)}</span>
        ) : null}
      </span>
    ),
    description: (
      <span className="flex flex-wrap items-center gap-x-2">
        {row.reason ? <span>{row.reason}</span> : null}
        {row.note ? <span className="italic">“{row.note}”</span> : null}
        {row.orderId ? (
          <span>
            Order <OrderLink orderId={row.orderId} orderNumber={row.orderNumber} />
          </span>
        ) : null}
      </span>
    ),
  }));

  return (
    <Sheet open={detail !== null} onOpenChange={(open) => !open && close()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        {detail ? (
          <>
            <SheetHeader className="pb-0">
              <div className="flex items-start gap-3">
                <ProductThumb src={detail.imageUrl} alt="" size={48} />
                <div className="min-w-0 flex-1">
                  <SheetTitle className="truncate text-base">
                    {variantLabel(detail.productTitle, detail.variantName)}
                  </SheetTitle>
                  <SheetDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {detail.sku ? (
                      <span className="inline-flex items-center gap-1 font-mono text-xs">
                        {detail.sku}
                        <CopyButton value={detail.sku} label="Copy SKU" size="icon-xs" />
                      </span>
                    ) : null}
                    {detail.options.map((option) => (
                      <span key={`${option.attribute}:${option.value}`} className="bg-muted rounded px-1 text-[11px]">
                        {option.attribute}: {option.value}
                      </span>
                    ))}
                    <Link href={productHref(detail.productId) as Route} className="text-brand text-xs hover:underline">
                      View product
                    </Link>
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <div className="grid grid-cols-3 gap-2 px-4 text-xs sm:grid-cols-5">
              <Stat label="On hand" value={detail.onHand} />
              <Stat label="Reserved" value={detail.reserved} />
              <Stat label="Available" value={detail.available} />
              <div className="col-span-3 flex flex-col gap-1 sm:col-span-2">
                <span className="text-muted-foreground">Trend · last {detail.series.length} movements</span>
                <div className="flex items-center gap-2">
                  <Sparkline values={detail.series} width="100%" height={32} label="On hand" />
                  <StockBadge state={detail.stockState} />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 px-4">
              <Select
                value={typeFilter ?? ALL_TYPES}
                onValueChange={(value) => navigate({ [HISTORY_PARAMS.type]: value === ALL_TYPES ? null : value, [HISTORY_PARAMS.page]: null })}
              >
                <SelectTrigger className="h-7 w-40 text-xs" aria-label="Movement type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_TYPES}>All types</SelectItem>
                  {STOCK_MOVEMENT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {STOCK_MOVEMENT_META[type].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <DateRangePicker
                paramFrom={HISTORY_PARAMS.from}
                paramTo={HISTORY_PARAMS.to}
                paramPreset={HISTORY_PARAMS.preset}
                fallback="this_year"
                align="end"
              />
              <span className="text-muted-foreground ml-auto text-xs" data-numeric>
                {formatNumber(detail.movementCount)} movements in total
              </span>
            </div>

            <div className="px-4 pb-4">
              {events.length === 0 ? (
                <div className="text-muted-foreground flex flex-col items-center gap-2 py-10 text-center text-xs">
                  <ScrollText className="size-5" />
                  No movements match this filter.
                </div>
              ) : (
                <StatusTimeline events={events} order="desc" />
              )}
              {movements && movements.meta.totalPages > 1 ? (
                <div className="text-muted-foreground mt-3 flex items-center justify-between text-xs">
                  <span data-numeric>
                    {movements.meta.from}–{movements.meta.to} of {movements.meta.total}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon-xs"
                      aria-label="Newer movements"
                      disabled={movements.meta.page <= 1}
                      onClick={() => navigate({ [HISTORY_PARAMS.page]: movements.meta.page - 1 <= 1 ? null : movements.meta.page - 1 })}
                    >
                      <ChevronLeft />
                    </Button>
                    <span data-numeric className="px-1">
                      {movements.meta.page} / {movements.meta.totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="icon-xs"
                      aria-label="Older movements"
                      disabled={movements.meta.page >= movements.meta.totalPages}
                      onClick={() => navigate({ [HISTORY_PARAMS.page]: movements.meta.page + 1 })}
                    >
                      <ChevronRight />
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col">
      <span className="text-muted-foreground">{label}</span>
      <span data-numeric className="text-base font-semibold">
        {formatNumber(value)}
      </span>
    </div>
  );
}
