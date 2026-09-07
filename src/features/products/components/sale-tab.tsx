"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Info, Loader2, Percent, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";

import { Panel } from "@/components/shared/panel";
import { EmptyState } from "@/components/shared/empty-state";
import { ProductThumb } from "@/components/shared/product-thumb";
import {
  ProductStatusBadge,
  StatusPill,
} from "@/components/shared/status-badge";
import {
  DataTable,
  DataTableBody,
  DataTableHead,
  Td,
  Th,
  Tr,
} from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatIstDate } from "@/lib/dates";
import { formatNumber, formatPaise } from "@/lib/money";
import type { SaleTabData, SaleRow } from "@/features/products/queries";
import type { SaleMode } from "@/features/products/schemas";
import {
  bulkSetSale,
  bulkSetStatus,
  clearSale,
} from "@/features/products/actions";

/**
 * Selection here is genuinely transient UI - it is a multi-select for one bulk
 * write, not a filter - so it lives in React state rather than the URL. Every
 * filter on this page still goes through the URL like everywhere else.
 */
export function SaleTab({ data }: { data: SaleTabData }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const [mode, setMode] = React.useState<SaleMode>("PERCENT");
  const [value, setValue] = React.useState("10");
  const [startsAt, setStartsAt] = React.useState("");
  const [endsAt, setEndsAt] = React.useState("");

  const ids = React.useMemo(() => data.rows.map((row) => row.id), [data.rows]);
  const allSelected = selected.size > 0 && selected.size === ids.length;

  function toggle(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectMany(rows: SaleRow[]) {
    setSelected(new Set(rows.map((row) => row.id)));
  }

  function applySale() {
    startTransition(async () => {
      const result = await bulkSetSale({
        productIds: [...selected],
        mode,
        value: Number(value),
        startsAt: startsAt || null,
        endsAt: endsAt || null,
      });

      if (result.ok) {
        toast.success(result.message ?? "Sale applied.");
        setSelected(new Set());
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function removeSale() {
    startTransition(async () => {
      const result = await clearSale([...selected]);
      if (result.ok) {
        toast.success(result.message ?? "Sale cleared.");
        setSelected(new Set());
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function setStatus(status: "PUBLISHED" | "DRAFT") {
    startTransition(async () => {
      const result = await bulkSetStatus({
        productIds: [...selected],
        status,
      });
      if (result.ok) {
        toast.success(result.message ?? "Updated.");
        setSelected(new Set());
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <section
        aria-label="Sale summary"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        <SaleStat
          label="On sale now"
          value={data.onSaleCount}
          hint="Below list price and inside the date window"
        />
        <SaleStat
          label="Scheduled"
          value={data.scheduledCount}
          hint="Sale price set, window has not opened"
        />
        <SaleStat
          label="Expired"
          value={data.expiredCount}
          hint="Sale price still set, window has closed"
        />
        <SaleStat
          label="Flagged"
          value={data.brokenCount}
          hint="Sale price at or above list price"
          tone={data.brokenCount > 0 ? "warning" : undefined}
        />
      </section>

      {data.brokenCount > 0 ? (
        <div className="border-warning/30 bg-warning-muted/40 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-xs">
          <TriangleAlert className="text-warning size-3.5 shrink-0" />
          <span className="font-medium">
            {data.brokenCount} product{data.brokenCount === 1 ? " has" : "s have"}{" "}
            a sale price at or above the list price.
          </span>
          <span className="text-muted-foreground">
            They are highlighted below. Either lower the sale price or clear it.
          </span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="ml-auto"
            onClick={() =>
              selectMany(data.rows.filter((row) => row.saleIsBroken))
            }
          >
            Select them
          </Button>
        </div>
      ) : null}

      <Panel
        title="Sale pricing"
        description="Every product except archived ones, sale rows first"
        bodyClassName="p-0"
        action={
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() =>
                selectMany(data.rows.filter((row) => row.salePricePaise !== null))
              }
            >
              Select on sale
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setSelected(new Set())}
              disabled={selected.size === 0}
            >
              Clear selection
            </Button>
          </div>
        }
      >
        {data.rows.length === 0 ? (
          <EmptyState
            icon={Percent}
            title="Nothing to price"
            description="There are no active products in the catalogue to put on sale."
          />
        ) : (
          <DataTable>
            <DataTableHead>
              <Th width="2.5rem">
                <Checkbox
                  checked={
                    allSelected
                      ? true
                      : selected.size > 0
                        ? "indeterminate"
                        : false
                  }
                  onCheckedChange={(checked) =>
                    setSelected(checked === true ? new Set(ids) : new Set())
                  }
                  aria-label="Select all products"
                />
              </Th>
              <Th width="3rem" />
              <Th>Product</Th>
              <Th>Status</Th>
              <Th align="right">List price</Th>
              <Th align="right">Sale price</Th>
              <Th align="right">Discount</Th>
              <Th>Window</Th>
              <Th>State</Th>
            </DataTableHead>

            <DataTableBody>
              {data.rows.map((row) => (
                <Tr
                  key={row.id}
                  className={cn(
                    row.saleIsBroken && "bg-warning-muted/30",
                    selected.has(row.id) && "bg-accent/50",
                  )}
                >
                  <Td>
                    <Checkbox
                      checked={selected.has(row.id)}
                      onCheckedChange={() => toggle(row.id)}
                      aria-label={`Select ${row.title}`}
                    />
                  </Td>

                  <Td>
                    <ProductThumb src={row.imageUrl} alt={row.title} size={32} />
                  </Td>

                  <Td className="max-w-[16rem]">
                    <Link
                      href={`/products/${row.id}` as never}
                      className="block truncate font-medium hover:underline"
                    >
                      {row.title}
                    </Link>
                    <p className="text-muted-foreground truncate text-[11px]">
                      {row.categoryName ?? "Uncategorised"}
                    </p>
                  </Td>

                  <Td>
                    <ProductStatusBadge status={row.status} />
                  </Td>

                  <Td align="right" numeric>
                    {formatPaise(row.pricePaise)}
                  </Td>

                  <Td align="right" numeric>
                    {row.salePricePaise === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span
                        className={cn(
                          "font-medium",
                          row.saleIsBroken && "text-warning",
                        )}
                      >
                        {formatPaise(row.salePricePaise)}
                      </span>
                    )}
                  </Td>

                  <Td align="right" numeric>
                    {row.salePricePaise === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : row.saleIsBroken ? (
                      <span className="text-warning">0%</span>
                    ) : (
                      `${row.discountPercent}%`
                    )}
                  </Td>

                  <Td className="text-muted-foreground text-[11px]">
                    {row.saleStartsAt || row.saleEndsAt ? (
                      <span data-numeric>
                        {row.saleStartsAt ? formatIstDate(row.saleStartsAt) : "—"}
                        {" → "}
                        {row.saleEndsAt ? formatIstDate(row.saleEndsAt) : "—"}
                      </span>
                    ) : row.salePricePaise !== null ? (
                      "Always on"
                    ) : (
                      "—"
                    )}
                  </Td>

                  <Td>
                    <SaleStateBadge row={row} />
                  </Td>
                </Tr>
              ))}
            </DataTableBody>
          </DataTable>
        )}
      </Panel>

      <p className="text-muted-foreground flex items-start gap-1.5 text-xs leading-relaxed">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span>
          The storefront Sale page filters on <code>isOnSale</code>, which is
          derived — a product is on sale when a sale price is set, is below the
          list price, and today falls inside its window. It is never stored, so
          it can never disagree with the prices above. Separately: on the live
          storefront today the cart bills <code>product.price</code> while the
          product cards show <code>salePrice</code>, so any sale set here would
          be advertised but not charged until that is fixed at cutover.
        </span>
      </p>

      {selected.size > 0 ? (
        <div className="bg-background/95 sticky bottom-0 z-20 space-y-2 rounded-lg border p-3 backdrop-blur">
          <div className="flex flex-wrap items-end gap-2">
            <p className="mb-1.5 text-xs font-medium">
              <span data-numeric>{selected.size}</span> selected
            </p>

            <div className="space-y-1">
              <Label className="text-muted-foreground text-[11px]">
                Sale type
              </Label>
              <Select
                value={mode}
                onValueChange={(next) => setMode(next as SaleMode)}
              >
                <SelectTrigger size="sm" className="w-40" aria-label="Sale type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PERCENT">Percentage off</SelectItem>
                  <SelectItem value="FIXED">Fixed sale price</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="w-28 space-y-1">
              <Label
                htmlFor="sale-value"
                className="text-muted-foreground text-[11px]"
              >
                {mode === "PERCENT" ? "Percent off" : "Sale price ₹"}
              </Label>
              <Input
                id="sale-value"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                inputMode="decimal"
                className="tabular h-7"
              />
            </div>

            <div className="w-36 space-y-1">
              <Label
                htmlFor="sale-starts"
                className="text-muted-foreground text-[11px]"
              >
                Starts
              </Label>
              <Input
                id="sale-starts"
                type="date"
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
                className="h-7"
              />
            </div>

            <div className="w-36 space-y-1">
              <Label
                htmlFor="sale-ends"
                className="text-muted-foreground text-[11px]"
              >
                Ends
              </Label>
              <Input
                id="sale-ends"
                type="date"
                value={endsAt}
                onChange={(event) => setEndsAt(event.target.value)}
                className="h-7"
              />
            </div>

            <Button
              type="button"
              size="sm"
              onClick={applySale}
              disabled={pending || value.trim().length === 0}
            >
              {pending ? <Loader2 className="animate-spin" /> : <Percent />}
              Apply sale
            </Button>

            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={removeSale}
              disabled={pending}
            >
              <X />
              Clear sale
            </Button>

            <div className="ml-auto flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setStatus("PUBLISHED")}
                disabled={pending}
              >
                Publish
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setStatus("DRAFT")}
                disabled={pending}
              >
                Move to draft
              </Button>
            </div>
          </div>

          <p className="text-muted-foreground text-[11px]">
            {mode === "PERCENT"
              ? "Each product's sale price is computed from its own list price, so mixed pricing stays correct."
              : "Every selected product gets the same sale price. Any that ends up at or above its list price is reported back and flagged above."}
          </p>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function SaleStat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  tone?: "warning";
}) {
  return (
    <div
      className={cn(
        "surface p-3",
        tone === "warning" && "border-warning/30 bg-warning-muted/30",
      )}
    >
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <p data-numeric className="mt-1 text-xl font-semibold tracking-tight">
        {formatNumber(value)}
      </p>
      <p className="text-muted-foreground mt-0.5 text-[11px] leading-snug">
        {hint}
      </p>
    </div>
  );
}

function SaleStateBadge({ row }: { row: SaleRow }) {
  if (row.saleIsBroken) {
    return <StatusPill label="No real discount" tone="warning" />;
  }
  if (row.onSale) return <StatusPill label="On sale" tone="success" />;
  if (row.scheduled) return <StatusPill label="Scheduled" tone="info" />;
  if (row.salePricePaise !== null) {
    return <StatusPill label="Window closed" tone="neutral" />;
  }
  return <span className="text-muted-foreground/50 text-xs">—</span>;
}
