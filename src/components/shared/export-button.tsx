"use client";

import * as React from "react";
import { Download, FileSpreadsheet, FileText, Loader2, Printer } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ExportFormat = "csv" | "xlsx" | "print";

const FORMAT_META: Record<ExportFormat, { label: string; icon: LucideIcon }> = {
  csv: { label: "Download CSV", icon: FileText },
  xlsx: { label: "Download Excel", icon: FileSpreadsheet },
  print: { label: "Print", icon: Printer },
};

/**
 * "Export" as a small menu of formats. Two ways to wire it:
 *
 *   - `hrefFor(format)`: the export is a GET route (src/lib/export streams
 *     CSV/XLSX for the current filters), so the menu item is a plain link and
 *     the browser handles the download. Preferred - it works without JS and
 *     the URL can be bookmarked.
 *   - `onExport(format)`: for client-side exports (print, or a small table
 *     serialised in the browser). May return a promise; the button shows a
 *     spinner until it settles.
 *
 * "print" always calls window.print() unless onExport handles it, so pages
 * only need a print stylesheet to support it.
 */
export function ExportButton({
  formats = ["csv", "xlsx"],
  hrefFor,
  onExport,
  label = "Export",
  size = "sm",
  disabled,
}: {
  formats?: ExportFormat[];
  hrefFor?: (format: Exclude<ExportFormat, "print">) => string;
  onExport?: (format: ExportFormat) => void | Promise<void>;
  label?: string;
  size?: "sm" | "default" | "xs";
  disabled?: boolean;
}) {
  const [pending, setPending] = React.useState(false);

  async function handle(format: ExportFormat) {
    if (format === "print" && !onExport) {
      window.print();
      return;
    }
    if (!onExport) return;
    setPending(true);
    try {
      await onExport(format);
    } finally {
      setPending(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size={size} disabled={disabled || pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Download />}
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {formats.map((format) => {
          const meta = FORMAT_META[format];
          const Icon = meta.icon;
          const href = format !== "print" && hrefFor ? hrefFor(format) : undefined;
          return (
            <DropdownMenuItem
              key={format}
              asChild={Boolean(href)}
              className="text-xs"
              onSelect={href ? undefined : () => handle(format)}
            >
              {href ? (
                <a href={href} download>
                  <Icon />
                  {meta.label}
                </a>
              ) : (
                <>
                  <Icon />
                  {meta.label}
                </>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A standalone print button for detail pages (invoices, packing slips). */
export function PrintButton({
  label = "Print",
  size = "sm",
  onBeforePrint,
}: {
  label?: string;
  size?: "sm" | "default" | "xs" | "icon-sm";
  onBeforePrint?: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      aria-label={label}
      onClick={() => {
        onBeforePrint?.();
        window.print();
      }}
    >
      <Printer />
      {size.startsWith("icon") ? null : label}
    </Button>
  );
}
