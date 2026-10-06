import Link from "next/link";
import type { Route } from "next";
import { ScrollText } from "lucide-react";

import { MovementTypeBadge, OrderLink, SignedDelta, reservedSummary } from "@/features/inventory/components/movement-cells";
import { MovementsToolbar } from "@/features/inventory/components/movements-toolbar";
import { inventoryHref, variantLabel } from "@/features/inventory/format";
import type { MovementListResult } from "@/features/inventory/queries";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { PaginationBar } from "@/components/shared/list-controls";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { Button } from "@/components/ui/button";
import { formatIstDateTime } from "@/lib/dates";
import { STOCK_MOVEMENT_META } from "@/lib/enums";

/**
 * The global ledger (`?tab=movements`), newest first. Append-only by design:
 * there is no edit and no delete, because a stock history an operator can
 * rewrite answers no question worth asking. A mistake is corrected by
 * posting the opposite movement - that is what CORRECTION is for.
 *
 * A Server Component: the toolbar is the only client part.
 */
export function MovementsLedger({
  result,
  isFiltered,
  variantScope,
}: {
  result: MovementListResult;
  isFiltered: boolean;
  variantScope: string | null;
}) {
  return (
    <div className="space-y-3">
      <MovementsToolbar typeCounts={result.typeCounts} variantScope={variantScope} />

      <div className="surface overflow-hidden">
        {result.rows.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title={isFiltered ? "No movements match these filters" : "No stock movements yet"}
            description={
              isFiltered
                ? "Widen the date range or clear the type filter."
                : "Every adjustment, reservation and sale will appear here with the balance it left behind."
            }
            action={
              isFiltered ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={inventoryHref({ tab: "movements" }) as Route}>Clear filters</Link>
                </Button>
              ) : null
            }
          />
        ) : (
          <ResponsiveTable
            table={
              <DataTable>
                <DataTableHead>
                  <Th width="11rem">Time (IST)</Th>
                  <Th>Variant</Th>
                  <Th>Type</Th>
                  <Th align="right">Change</Th>
                  <Th align="right">Balance</Th>
                  <Th>Reason</Th>
                  <Th>Order</Th>
                  <Th>By</Th>
                </DataTableHead>
                <DataTableBody>
                  {result.rows.map((row) => (
                    <Tr key={row.id}>
                      <Td numeric className="text-muted-foreground whitespace-nowrap">
                        {formatIstDateTime(row.createdAt)}
                      </Td>
                      <Td className="max-w-[18rem]">
                        <Link
                          href={inventoryHref({ tab: "movements", variant: row.variantId }) as Route}
                          scroll={false}
                          className="block truncate font-medium hover:underline"
                        >
                          {variantLabel(row.productTitle, row.variantName)}
                        </Link>
                        {row.sku ? <p className="text-muted-foreground font-mono text-[11px]">{row.sku}</p> : null}
                      </Td>
                      <Td>
                        <MovementTypeBadge type={row.type} />
                      </Td>
                      <Td align="right">
                        <SignedDelta value={row.delta} />
                        {row.reservedDelta !== 0 ? (
                          <p className="text-muted-foreground text-[11px]">{reservedSummary(row.reservedDelta, row.reservedBalance)}</p>
                        ) : null}
                      </Td>
                      <Td numeric align="right" className="font-medium">
                        {row.balance}
                      </Td>
                      <Td className="text-muted-foreground max-w-[16rem]">
                        <p className="truncate">{row.reason ?? "—"}</p>
                        {row.note ? <p className="truncate text-[11px] italic">{row.note}</p> : null}
                      </Td>
                      <Td>
                        <OrderLink orderId={row.orderId} orderNumber={row.orderNumber} />
                      </Td>
                      <Td className="text-muted-foreground max-w-[10rem] truncate">
                        {row.actorName ?? (row.orderId ? "Order flow" : "System")}
                      </Td>
                    </Tr>
                  ))}
                </DataTableBody>
              </DataTable>
            }
            cards={
              <div className="divide-y">
                {result.rows.map((row) => (
                  <MobileCard
                    key={row.id}
                    title={variantLabel(row.productTitle, row.variantName)}
                    subtitle={formatIstDateTime(row.createdAt)}
                    meta={<MovementTypeBadge type={row.type} />}
                  >
                    <MobileCardField label="Change" numeric>
                      <SignedDelta value={row.delta} />
                    </MobileCardField>
                    <MobileCardField label="Balance" numeric>{row.balance}</MobileCardField>
                    <MobileCardField label="Reason">{row.reason ?? STOCK_MOVEMENT_META[row.type]?.label}</MobileCardField>
                    <MobileCardField label="By">{row.actorName ?? (row.orderId ? "Order flow" : "System")}</MobileCardField>
                  </MobileCard>
                ))}
              </div>
            }
          />
        )}
        <PaginationBar meta={result.meta} itemLabel="movements" />
      </div>
    </div>
  );
}
