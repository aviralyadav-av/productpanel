"use client";

import * as React from "react";

import { bulkSetThreshold, setThreshold } from "@/features/inventory/actions";
import { QUANTITY_LIMIT } from "@/features/inventory/schemas";
import type { AdjustTarget } from "@/features/inventory/components/adjust-dialog";
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
import { Switch } from "@/components/ui/switch";
import { stockState } from "@/lib/enums";

/**
 * Low-stock threshold + backorder flag. No ledger row is written - a
 * threshold is a reporting rule, not stock - but the item's stockState is
 * re-derived on save, so the badge in the preview is what the table will show.
 */
export function ThresholdDialog({
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
      <DialogContent className="sm:max-w-md">
        {/* Mounted only while open, so the form always starts from the target's current values. */}
        {open ? <ThresholdForm targets={targets} onOpenChange={onOpenChange} onDone={onDone} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ThresholdForm({
  targets,
  onOpenChange,
  onDone,
}: {
  targets: AdjustTarget[];
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const { pending, run } = useActionToast();
  const single = targets.length === 1 ? targets[0] : null;
  const [threshold, setThresholdValue] = React.useState(single?.lowStockThreshold ?? 3);
  const [allowBackorder, setAllowBackorder] = React.useState(single?.allowBackorder ?? false);
  // In bulk, leaving the backorder flag alone is the safe default.
  const [touchBackorder, setTouchBackorder] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();

  const nextState = single ? stockState(single.onHand - single.reserved, threshold, allowBackorder) : null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    const result = single
      ? await run(() => setThreshold({ variantId: single.variantId, lowStockThreshold: threshold, allowBackorder }))
      : await run(() =>
          bulkSetThreshold({
            variantIds: targets.map((target) => target.variantId),
            lowStockThreshold: threshold,
            allowBackorder: touchBackorder ? allowBackorder : undefined,
          }),
        );
    if (result.ok) {
      onOpenChange(false);
      onDone?.();
    } else {
      setError(result.fieldErrors?.lowStockThreshold);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{single ? "Low-stock threshold" : `Threshold for ${targets.length} variants`}</DialogTitle>
            <DialogDescription>
              {single
                ? `${single.label}. The variant reports low stock when available units fall to this number or below.`
                : "Applied to every selected variant. Nothing moves; only the reporting rule changes."}
            </DialogDescription>
          </DialogHeader>

          <FormRow label="Threshold" htmlFor="threshold-value" error={error} required>
            <NumberStepper
              id="threshold-value"
              value={threshold}
              onChange={setThresholdValue}
              min={0}
              max={QUANTITY_LIMIT}
              className="w-40"
            />
          </FormRow>

          {single ? (
            <FormRow
              label="Allow backorders"
              htmlFor="threshold-backorder"
              inline
              hint="When on, stock may go below zero and the storefront shows “backorder” instead of “out of stock”."
            >
              <Switch id="threshold-backorder" checked={allowBackorder} onCheckedChange={setAllowBackorder} />
            </FormRow>
          ) : (
            <>
              <FormRow label="Change backorder setting" htmlFor="threshold-touch" inline hint="Off leaves each variant's current setting alone.">
                <Switch id="threshold-touch" checked={touchBackorder} onCheckedChange={setTouchBackorder} />
              </FormRow>
              {touchBackorder ? (
                <FormRow label="Allow backorders" htmlFor="threshold-backorder-bulk" inline>
                  <Switch id="threshold-backorder-bulk" checked={allowBackorder} onCheckedChange={setAllowBackorder} />
                </FormRow>
              ) : null}
            </>
          )}

          {single && nextState ? (
            <p className="text-muted-foreground flex items-center gap-2 text-xs" aria-live="polite">
              With {single.onHand - single.reserved} available this variant will read as <StockBadge state={nextState} />
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending || targets.length === 0}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
    </form>
  );
}
