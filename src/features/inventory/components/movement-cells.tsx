import Link from "next/link";
import type { Route } from "next";
import { cn } from "cn";

import { orderHref } from "@/features/inventory/format";
import { formatSigned } from "@/features/inventory/stock-math";
import { StatusPill } from "@/components/shared/status-badge";
import { STOCK_MOVEMENT_META, type StockMovementType } from "@/lib/enums";

/**
 * The three cells every ledger view shares - type pill, signed delta and the
 * order link - so the global ledger, the history sheet and the mobile cards
 * render a movement identically.
 */

export function MovementTypeBadge({ type }: { type: StockMovementType }) {
  const meta = STOCK_MOVEMENT_META[type];
  return <StatusPill label={meta?.label ?? type} tone={meta?.tone ?? "neutral"} />;
}

export function SignedDelta({ value, className }: { value: number; className?: string }) {
  return (
    <span
      data-numeric
      className={cn(
        "font-mono tabular-nums",
        value > 0 && "text-success",
        value < 0 && "text-destructive",
        value === 0 && "text-muted-foreground",
        className,
      )}
    >
      {formatSigned(value)}
    </span>
  );
}

export function OrderLink({ orderId, orderNumber }: { orderId: string | null; orderNumber: string | null }) {
  if (!orderId) return <span className="text-muted-foreground">—</span>;
  return (
    <Link href={orderHref(orderId) as Route} className="text-brand font-medium hover:underline">
      {orderNumber ?? orderId}
    </Link>
  );
}

/** "RESERVE +2 (reserved 2 → 4)" style detail for a movement that touched reservations. */
export function reservedSummary(reservedDelta: number, reservedBalance: number): string | null {
  if (reservedDelta === 0) return null;
  return `reserved ${formatSigned(reservedDelta)} → ${reservedBalance}`;
}
