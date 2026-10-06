"use client";

import * as React from "react";
import { ArrowRight, TriangleAlert } from "lucide-react";
import { cn } from "cn";

import { adjustStock, bulkAdjustStock } from "@/features/inventory/actions";
import {
  ADJUSTABLE_STOCK_MOVEMENT_TYPES,
  ADJUSTMENT_TYPE_DESCRIPTIONS,
  COMMON_ADJUSTMENT_REASONS,
  QUANTITY_LIMIT,
  type AdjustableStockMovementType,
} from "@/features/inventory/schemas";
import {
  ADJUST_MODES,
  ADJUST_MODE_META,
  formatSigned,
  previewAdjustment,
  type AdjustMode,
} from "@/features/inventory/stock-math";
import type { InventoryRow } from "@/features/inventory/queries";
import { variantLabel } from "@/features/inventory/format";
import { FormRow } from "@/components/shared/form-layout";
import { NumberStepper } from "@/components/shared/number-stepper";
import { StockBadge } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { STOCK_MOVEMENT_META } from "@/lib/enums";

/** What the dialog needs to know about a variant; built from a table row. */
export type AdjustTarget = {
  variantId: string;
  label: string;
  sku: string | null;
  onHand: number;
  reserved: number;
  lowStockThreshold: number;
  allowBackorder: boolean;
};

export function toAdjustTarget(row: InventoryRow): AdjustTarget {
  return {
    variantId: row.variantId,
    label: variantLabel(row.productTitle, row.variantName),
    sku: row.sku,
    onHand: row.onHand,
    reserved: row.reserved,
    lowStockThreshold: row.lowStockThreshold,
    allowBackorder: row.allowBackorder,
  };
}

const CUSTOM_REASON = "__custom";

/**
 * One dialog for a single variant and for a selection. The form is identical;
 * only the preview differs - a single target shows the resulting balance,
 * a selection shows how many rows the same instruction will touch. "Set"
 * derives its delta on the server under the row lock; the preview here is
 * computed from the balances the table was rendered with and says so.
 */
export function AdjustDialog({
  open,
  onOpenChange,
  targets,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targets: AdjustTarget[];
  onDone?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* Mounted only while open, so every opening starts from a blank form. */}
        {open ? <AdjustForm targets={targets} onOpenChange={onOpenChange} onDone={onDone} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function AdjustForm({
  targets,
  onOpenChange,
  onDone,
}: {
  targets: AdjustTarget[];
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const { pending, run } = useActionToast();
  const [mode, setMode] = React.useState<AdjustMode>("add");
  const [quantity, setQuantity] = React.useState(1);
  const [type, setType] = React.useState<AdjustableStockMovementType>("ADJUSTMENT");
  const [reasonChoice, setReasonChoice] = React.useState<string>(COMMON_ADJUSTMENT_REASONS[0]);
  const [customReason, setCustomReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const single = targets.length === 1 ? targets[0] : null;
  const reason = reasonChoice === CUSTOM_REASON ? customReason.trim() : reasonChoice;

  // Sensible default type per intent, unless the operator already chose one.
  function changeMode(next: AdjustMode) {
    setMode(next);
    if (next === "set" && type === "ADJUSTMENT") setType("CORRECTION");
    if (next !== "set" && type === "CORRECTION") setType("ADJUSTMENT");
  }

  const preview = single
    ? previewAdjustment({
        mode,
        quantity,
        onHand: single.onHand,
        reserved: single.reserved,
        lowStockThreshold: single.lowStockThreshold,
        allowBackorder: single.allowBackorder,
      })
    : null;

  const blockedCount = single
    ? preview?.blocked
      ? 1
      : 0
    : targets.filter(
        (target) =>
          previewAdjustment({
            mode,
            quantity,
            onHand: target.onHand,
            reserved: target.reserved,
            lowStockThreshold: target.lowStockThreshold,
            allowBackorder: target.allowBackorder,
          }).blocked,
      ).length;

  const canSubmit =
    targets.length > 0 &&
    !pending &&
    (mode === "set" || quantity > 0) &&
    blockedCount === 0 &&
    (reasonChoice !== CUSTOM_REASON || customReason.trim().length > 0);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setErrors({});
    const common = { mode, quantity, type, reason: reason || undefined, note: note.trim() || undefined };
    const result = single
      ? await run(() => adjustStock({ variantId: single.variantId, ...common }))
      : await run(() => bulkAdjustStock({ variantIds: targets.map((target) => target.variantId), ...common }));
    if (result.ok) {
      onOpenChange(false);
      onDone?.();
    } else if (result.fieldErrors) {
      setErrors(result.fieldErrors);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{single ? "Adjust stock" : `Adjust ${targets.length} variants`}</DialogTitle>
            <DialogDescription>
              {single ? (
                <>
                  {single.label}
                  {single.sku ? <span className="font-mono"> · {single.sku}</span> : null}. Currently{" "}
                  <strong data-numeric>{single.onHand}</strong> on hand, <strong data-numeric>{single.reserved}</strong>{" "}
                  reserved.
                </>
              ) : (
                "The same instruction is applied to every selected variant in one transaction; if any would go below zero, nothing changes."
              )}
            </DialogDescription>
          </DialogHeader>

          <FormRow label="Change" hint={ADJUST_MODE_META[mode].hint}>
            <ToggleGroup
              type="single"
              variant="outline"
              value={mode}
              onValueChange={(value) => value && changeMode(value as AdjustMode)}
              className="w-full"
            >
              {ADJUST_MODES.map((option) => (
                <ToggleGroupItem key={option} value={option} className="flex-1 text-xs">
                  {ADJUST_MODE_META[option].label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </FormRow>

          <FormRow label={mode === "set" ? "New count" : "Quantity"} htmlFor="adjust-quantity" error={errors.quantity} required>
            <NumberStepper
              id="adjust-quantity"
              value={quantity}
              onChange={setQuantity}
              min={0}
              max={QUANTITY_LIMIT}
              className="w-40"
            />
          </FormRow>

          <FormRow label="Movement type" htmlFor="adjust-type" hint={ADJUSTMENT_TYPE_DESCRIPTIONS[type]} error={errors.type}>
            <Select value={type} onValueChange={(value) => setType(value as AdjustableStockMovementType)}>
              <SelectTrigger id="adjust-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ADJUSTABLE_STOCK_MOVEMENT_TYPES.map((option) => (
                  <SelectItem key={option} value={option}>
                    <span className="flex flex-col">
                      <span>{STOCK_MOVEMENT_META[option].label}</span>
                      <span className="text-muted-foreground text-[11px]">{ADJUSTMENT_TYPE_DESCRIPTIONS[option]}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>

          <FormRow label="Reason" htmlFor="adjust-reason" error={errors.reason}>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select value={reasonChoice} onValueChange={setReasonChoice}>
                <SelectTrigger id="adjust-reason" className="sm:w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMMON_ADJUSTMENT_REASONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_REASON}>Other…</SelectItem>
                </SelectContent>
              </Select>
              {reasonChoice === CUSTOM_REASON ? (
                <Input
                  value={customReason}
                  onChange={(event) => setCustomReason(event.target.value)}
                  placeholder="Describe the reason"
                  maxLength={120}
                  aria-label="Custom reason"
                  className="flex-1"
                />
              ) : null}
            </div>
          </FormRow>

          <FormRow label="Note" htmlFor="adjust-note" hint="Optional. Stored on the ledger row." error={errors.note}>
            <Textarea
              id="adjust-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              maxLength={500}
              placeholder="PO number, who counted, where the units went…"
            />
          </FormRow>

          {single && preview ? (
            <PreviewCard target={single} preview={preview} />
          ) : blockedCount > 0 ? (
            <p className="text-destructive flex items-start gap-2 text-xs">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              {blockedCount} of the selected variants would go below zero and do not allow backorders. Reduce the
              quantity or adjust them individually.
            </p>
          ) : (
            <p className="text-muted-foreground text-xs">
              {mode === "set"
                ? `Every selected variant will be set to ${quantity} on hand; the change for each is derived on the server.`
                : `${formatSigned(mode === "add" ? quantity : -quantity)} on each of ${targets.length} variants.`}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {pending ? "Saving…" : single ? "Record movement" : `Adjust ${targets.length} variants`}
            </Button>
          </DialogFooter>
    </form>
  );
}

function PreviewCard({
  target,
  preview,
}: {
  target: AdjustTarget;
  preview: ReturnType<typeof previewAdjustment>;
}) {
  return (
    <div
      className={cn(
        "rounded-md border p-3 text-xs",
        preview.blocked ? "border-destructive/40 bg-destructive/5" : "bg-muted/40",
      )}
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-muted-foreground">On hand</span>
        <span data-numeric className="font-medium">
          {target.onHand}
        </span>
        <ArrowRight className="text-muted-foreground size-3" />
        <span data-numeric className="font-medium">
          {preview.nextOnHand}
        </span>
        <span data-numeric className={cn("font-mono", preview.delta < 0 ? "text-destructive" : "text-success")}>
          ({formatSigned(preview.delta)})
        </span>
        <span className="text-muted-foreground ml-auto">Available</span>
        <span data-numeric className="font-medium">
          {preview.nextAvailable}
        </span>
        <StockBadge state={preview.nextState} />
      </div>
      {preview.blocked ? (
        <p className="text-destructive mt-2 flex items-start gap-1.5">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          This would take available stock below zero. Enable backorders in the threshold dialog to allow it, or
          reduce the quantity.
        </p>
      ) : preview.noop ? (
        <p className="text-muted-foreground mt-2">Nothing would move; no ledger row will be written.</p>
      ) : preview.negative ? (
        <p className="text-muted-foreground mt-2">Goes negative; allowed because this variant accepts backorders.</p>
      ) : null}
    </div>
  );
}
