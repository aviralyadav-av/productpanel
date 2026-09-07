import { cn } from "cn";

/**
 * Table primitives, not a table library.
 *
 * Sorting, filtering and pagination all happen on the server driven by the
 * URL, so a client-side table engine would be dead weight. These wrappers
 * exist so every list in the app has the same row height, the same header
 * treatment, and the same right-aligned tabular numerics.
 *
 * Rules encoded here:
 *   - numbers are right-aligned and tabular so digits line up between rows
 *   - the header is sticky, because operators scroll long lists
 *   - horizontal overflow scrolls inside the table, never the page
 */

export function DataTable({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <table className="w-full min-w-max text-xs">{children}</table>
    </div>
  );
}

export function DataTableHead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="bg-card text-muted-foreground sticky top-0 z-10 border-b">
      <tr>{children}</tr>
    </thead>
  );
}

export function Th({
  children,
  align = "left",
  className,
  width,
}: {
  children?: React.ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
  width?: string;
}) {
  return (
    <th
      scope="col"
      style={width ? { width } : undefined}
      className={cn(
        "px-3 py-2 font-medium whitespace-nowrap first:pl-4 last:pr-4",
        align === "right" && "text-right",
        align === "center" && "text-center",
        align === "left" && "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function DataTableBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y">{children}</tbody>;
}

export function Tr({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <tr className={cn("hover:bg-accent/40 transition-colors", className)}>
      {children}
    </tr>
  );
}

export function Td({
  children,
  align = "left",
  numeric = false,
  className,
}: {
  children?: React.ReactNode;
  align?: "left" | "right" | "center";
  numeric?: boolean;
  className?: string;
}) {
  return (
    <td
      data-numeric={numeric ? "" : undefined}
      className={cn(
        "px-3 py-2 align-middle first:pl-4 last:pr-4",
        align === "right" && "text-right",
        align === "center" && "text-center",
        numeric && "tabular",
        className,
      )}
    >
      {children}
    </td>
  );
}

export function TableCaptionRow({
  colSpan,
  children,
}: {
  colSpan: number;
  children: React.ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-0">
        {children}
      </td>
    </tr>
  );
}
