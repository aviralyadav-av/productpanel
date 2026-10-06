import { cn } from "cn";

import { formatPaise, formatPaiseCompact } from "@/lib/money";

/**
 * Renders paise as rupees, tabular, with the two display rules the app
 * agrees on: a strike-through original next to a sale price, and negative
 * amounts (refunds, adjustments) in the destructive colour with a leading
 * minus rather than parentheses.
 *
 * @example
 *   <PriceText paise={order.totalPaise} />
 *   <PriceText paise={product.salePricePaise} comparePaise={product.pricePaise} />
 *   <PriceText paise={-refund.amountPaise} signed />
 */
export function PriceText({
  paise,
  comparePaise,
  compact = false,
  signed = false,
  muted = false,
  className,
}: {
  paise: number | null | undefined;
  /** Original price to show struck through when higher than `paise`. */
  comparePaise?: number | null;
  compact?: boolean;
  /** Prefix positive numbers with "+" as well as negatives with "-". */
  signed?: boolean;
  muted?: boolean;
  className?: string;
}) {
  if (paise === null || paise === undefined) {
    return <span className={cn("text-muted-foreground/70", className)}>&mdash;</span>;
  }

  const format = compact ? formatPaiseCompact : formatPaise;
  const negative = paise < 0;
  const text = format(Math.abs(paise));
  const prefix = negative ? "-" : signed && paise > 0 ? "+" : "";
  const showCompare = typeof comparePaise === "number" && comparePaise > paise;

  return (
    <span
      data-numeric
      className={cn(
        "inline-flex items-baseline gap-1.5 whitespace-nowrap",
        negative && "text-destructive",
        muted && "text-muted-foreground",
        className,
      )}
    >
      <span>
        {prefix}
        {text}
      </span>
      {showCompare ? (
        <s className="text-muted-foreground text-[0.9em] font-normal">{format(comparePaise)}</s>
      ) : null}
    </span>
  );
}

/** Alias: reads better in finance screens. */
export const Money = PriceText;
