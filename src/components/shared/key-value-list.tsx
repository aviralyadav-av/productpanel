import { cn } from "cn";

export type KeyValueItem = {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Right-align and use tabular digits. */
  numeric?: boolean;
  /** Let a long value (address, note) span the full width. */
  wide?: boolean;
};

/**
 * A definition list for detail panels: "Customer / Payment / Shipping"
 * side cards on the order page, the summary column on a seller. Empty values
 * render as an em dash rather than disappearing, so a missing GSTIN is
 * visibly missing.
 *
 * Server-compatible.
 */
export function KeyValueList({
  items,
  columns = 1,
  dense = false,
  className,
}: {
  items: KeyValueItem[];
  columns?: 1 | 2;
  dense?: boolean;
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid gap-x-6 text-xs",
        dense ? "gap-y-1.5" : "gap-y-2.5",
        columns === 2 && "sm:grid-cols-2",
        className,
      )}
    >
      {items.map((item, index) => (
        <div
          key={index}
          className={cn(
            "flex min-w-0 items-baseline justify-between gap-3",
            item.wide && "flex-col items-stretch gap-0.5 sm:col-span-full",
          )}
        >
          <dt className="text-muted-foreground shrink-0">{item.label}</dt>
          <dd
            data-numeric={item.numeric ? "" : undefined}
            className={cn(
              "min-w-0 text-right font-medium break-words",
              item.wide && "text-left font-normal",
            )}
          >
            {item.value === null || item.value === undefined || item.value === "" ? (
              <span className="text-muted-foreground/70">&mdash;</span>
            ) : (
              item.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
