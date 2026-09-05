"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";

import {
  adjustStock,
  bulkAdjustStock,
  setLowStockThreshold,
} from "@/features/inventory/actions";
import {
  ADJUSTABLE_STOCK_MOVEMENT_TYPES,
  ADJUST_MODES,
  type AdjustMode,
  type AdjustableStockMovementType,
} from "@/features/inventory/schemas";
import { StockBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { STOCK_MOVEMENT_META, stockState } from "@/lib/enums";

export type AdjustTarget = {
  variantId: string;
  productTitle: string;
  variantName: string;
  sku: string | null;
  onHand: number;
  reserved: number;
  lowStockThreshold: number;
};

const MODE_LABEL: Record<AdjustMode, string> = {
  DELTA: "Change by",
  SET: "Set to",
};

/**
 * One dialog for both a single variant and a selection of them.
 *
 * The arithmetic, the guards and the wording are identical either way; only
 * the preview differs, and splitting it into two components would mean two
 * places to keep the "never below zero" rule correct.
 *
 * Mount it only while it is open, keyed per adjustment: a fresh mount is how
 * the form resets, so there is no effect syncing props into state.
 */
export function AdjustStockDialog({
  targets,
  open,
  onOpenChange,
}: {
  targets: AdjustTarget[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const isBulk = targets.length > 1;
  const single = targets.length === 1 ? targets[0] : null;

  // The caller mounts this component fresh for each adjustment, so the form
  // starts from these values every time and needs no reset effect.
  const [mode, setMode] = React.useState<AdjustMode>("DELTA");
  const [amount, setAmount] = React.useState("");
  const [type, setType] =
    React.useState<AdjustableStockMovementType>("ADJUSTMENT");
  const [note, setNote] = React.useState("");
  const [threshold, setThreshold] = React.useState(
    single ? String(single.lowStockThreshold) : "",
  );

  const amountNumber = Number(amount);
  const hasAmount =
    amount.trim() !== "" &&
    Number.isFinite(amountNumber) &&
    Number.isInteger(amountNumber);

  const previews = targets.map((target) => {
    const next = mode === "SET" ? amountNumber : target.onHand + amountNumber;
    return { target, next, delta: next - target.onHand };
  });

  const anyNegative = hasAmount && previews.some((row) => row.next < 0);
  const belowReserved =
    hasAmount && previews.some((row) => row.next < row.target.reserved);

  const thresholdNumber = Number(threshold);
  const thresholdValid =
    threshold.trim() !== "" &&
    Number.isInteger(thresholdNumber) &&
    thresholdNumber >= 0;
  const thresholdChanged =
    single !== null && thresholdValid && thresholdNumber !== single.lowStockThreshold;

  // A change of zero units is a no-op, not an adjustment - refuse to write a
  // ledger row for it. "Set to 0" is a real change and is not caught here,
  // because it is judged on the resulting delta rather than on the number.
  const allDeltasZero = hasAmount && previews.every((row) => row.delta === 0);
  const canSave =
    !pending &&
    targets.length > 0 &&
    (hasAmount || thresholdChanged) &&
    !anyNegative &&
    (!allDeltasZero || thresholdChanged) &&
    (single === null || thresholdValid);

  function close() {
    if (!pending) onOpenChange(false);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSave) return;

    startTransition(async () => {
      const trimmedNote = note.trim();

      // A threshold-only edit writes no ledger row, so it goes through the
      // action that does not pretend stock moved.
      const result =
        !hasAmount && single
          ? await setLowStockThreshold({
              variantId: single.variantId,
              lowStockThreshold: thresholdNumber,
            })
          : isBulk
            ? await bulkAdjustStock({
                variantIds: targets.map((target) => target.variantId),
                mode,
                quantity: amountNumber,
                type,
                note: trimmedNote || undefined,
              })
            : await adjustStock({
                variantId: targets[0].variantId,
                mode,
                quantity: amountNumber,
                type,
                note: trimmedNote || undefined,
                lowStockThreshold: thresholdChanged
                  ? thresholdNumber
                  : undefined,
              });

      if (result.ok) {
        toast.success(result.message ?? "Stock updated.");
        onOpenChange(false);
        // revalidatePath refreshes the server payload; this makes sure the
        // table the operator is looking at repaints even mid-transition.
        router.refresh();
        return;
      }

      toast.error(result.error);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>
            {isBulk ? `Adjust ${targets.length} variants` : "Adjust stock"}
          </DialogTitle>
          <DialogDescription>
            {single ? (
              <>
                {single.productTitle} · {single.variantName}
                {single.sku ? ` · ${single.sku}` : ""}
              </>
            ) : (
              "The same change is applied to every selected variant."
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">How</Label>
            <div className="bg-muted inline-flex w-full items-center gap-0.5 rounded-lg p-0.5">
              {ADJUST_MODES.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={mode === option}
                  onClick={() => setMode(option)}
                  className={cn(
                    "flex-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    mode === option
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {MODE_LABEL[option]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="stock-amount" className="text-xs">
                {mode === "SET" ? "New count" : "Units"}
              </Label>
              <Input
                id="stock-amount"
                type="number"
                inputMode="numeric"
                step={1}
                autoFocus
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder={mode === "SET" ? "0" : "e.g. -2"}
                aria-invalid={anyNegative || undefined}
                className="tabular"
              />
              <p className="text-muted-foreground text-[11px]">
                {mode === "SET"
                  ? "The count after a physical stock take."
                  : "Negative removes stock."}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="stock-type" className="text-xs">
                Reason
              </Label>
              <Select
                value={type}
                onValueChange={(next) =>
                  setType(next as AdjustableStockMovementType)
                }
              >
                <SelectTrigger id="stock-type" className="h-8 w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ADJUSTABLE_STOCK_MOVEMENT_TYPES.map((option) => (
                    <SelectItem key={option} value={option} className="text-xs">
                      {STOCK_MOVEMENT_META[option].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-[11px]">
                Sales are written by order flow only.
              </p>
            </div>
          </div>

          {single ? (
            <div className="space-y-1.5">
              <Label htmlFor="stock-threshold" className="text-xs">
                Low-stock threshold
              </Label>
              <Input
                id="stock-threshold"
                type="number"
                inputMode="numeric"
                step={1}
                min={0}
                value={threshold}
                onChange={(event) => setThreshold(event.target.value)}
                aria-invalid={!thresholdValid || undefined}
                className="tabular w-28"
              />
              <p className="text-muted-foreground text-[11px]">
                Flags this variant as low once available stock falls to this
                number or below.
              </p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="stock-note" className="text-xs">
              Note <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="stock-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Why the count changed - a delivery, a damaged unit, a recount."
              className="min-h-14 text-xs"
            />
          </div>

          <PreviewPanel
            previews={previews}
            hasAmount={hasAmount}
            isBulk={isBulk}
            anyNegative={anyNegative}
            belowReserved={belowReserved}
            thresholdNumber={thresholdValid ? thresholdNumber : null}
          />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={close}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!canSave}>
              {pending ? "Saving…" : "Save adjustment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The resulting balance, shown before saving. An operator who can see the
 * answer before committing makes fewer corrections afterwards - and every
 * correction is another permanent row in the ledger.
 */
function PreviewPanel({
  previews,
  hasAmount,
  isBulk,
  anyNegative,
  belowReserved,
  thresholdNumber,
}: {
  previews: Array<{
    target: AdjustTarget;
    next: number;
    delta: number;
  }>;
  hasAmount: boolean;
  isBulk: boolean;
  anyNegative: boolean;
  belowReserved: boolean;
  thresholdNumber: number | null;
}) {
  const first = previews[0];

  if (!hasAmount || !first) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed px-3 py-2.5 text-xs">
        Enter a number to see the resulting balance.
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border px-3 py-2.5">
      {isBulk ? (
        <>
          <p className="text-muted-foreground text-[11px] font-medium">
            Resulting balances
          </p>
          <ul className="scrollbar-thin max-h-36 space-y-1 overflow-y-auto">
            {previews.map((row) => (
              <li
                key={row.target.variantId}
                className="flex items-center gap-2 text-xs"
              >
                <span className="min-w-0 flex-1 truncate">
                  {row.target.productTitle}
                  <span className="text-muted-foreground">
                    {" "}
                    · {row.target.variantName}
                  </span>
                </span>
                <span data-numeric className="text-muted-foreground">
                  {row.target.onHand}
                </span>
                <ArrowRight className="text-muted-foreground/60 size-3" />
                <span
                  data-numeric
                  className={cn(
                    "w-8 text-right font-medium",
                    row.next < 0 && "text-destructive",
                  )}
                >
                  {row.next}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="flex items-center gap-2">
          <span data-numeric className="text-muted-foreground text-sm">
            {first.target.onHand}
          </span>
          <ArrowRight className="text-muted-foreground/60 size-3.5" />
          <span
            data-numeric
            className={cn(
              "text-lg font-semibold",
              first.next < 0 && "text-destructive",
            )}
          >
            {first.next}
          </span>
          <span className="text-muted-foreground text-xs">on hand</span>

          <span
            data-numeric
            className={cn(
              "ml-auto text-xs font-medium",
              first.delta > 0 && "text-success",
              first.delta < 0 && "text-destructive",
              first.delta === 0 && "text-muted-foreground",
            )}
          >
            {first.delta > 0 ? "+" : ""}
            {first.delta}
          </span>

          {first.next >= 0 && thresholdNumber !== null ? (
            <StockBadge
              state={stockState(
                first.next - first.target.reserved,
                thresholdNumber,
              )}
            />
          ) : null}
        </div>
      )}

      {anyNegative ? (
        <p className="text-destructive flex items-start gap-1.5 text-[11px]">
          <TriangleAlert className="mt-px size-3 shrink-0" />
          Stock cannot go below zero. Adjust the number before saving.
        </p>
      ) : belowReserved ? (
        <p className="text-warning flex items-start gap-1.5 text-[11px]">
          <TriangleAlert className="mt-px size-3 shrink-0" />
          The new count is below the units already reserved against open
          orders.
        </p>
      ) : null}
    </div>
  );
}
