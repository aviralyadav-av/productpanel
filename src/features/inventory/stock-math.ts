import { stockState, type StockState } from "@/lib/enums";

/**
 * The arithmetic behind every manual stock change, kept pure so the dialog
 * preview, the CSV import report and the service compute the same numbers
 * from the same inputs. Unit-tested in stock-math.test.ts.
 *
 * Three ways an operator expresses a change, one signed ledger delta:
 *
 *   add     +quantity                (a delivery arrived)
 *   remove  -quantity                (damaged, sampled, written off)
 *   set     quantity - onHand        (a physical count; the delta is derived)
 *
 * "set" is the only mode whose delta depends on the current balance, which is
 * why the service re-derives it under the row lock rather than trusting a
 * number the browser computed from a stale table.
 */

export const ADJUST_MODES = ["add", "remove", "set"] as const;
export type AdjustMode = (typeof ADJUST_MODES)[number];

export const ADJUST_MODE_META: Record<AdjustMode, { label: string; hint: string }> = {
  add: { label: "Add", hint: "Units received or found. Increases on hand." },
  remove: { label: "Remove", hint: "Units lost, damaged or written off. Decreases on hand." },
  set: { label: "Set to", hint: "The count after a stock take. The change is derived." },
};

export function isAdjustMode(value: unknown): value is AdjustMode {
  return typeof value === "string" && (ADJUST_MODES as readonly string[]).includes(value);
}

/** Signed on-hand change for a mode + quantity against the current balance. */
export function resolveDelta(mode: AdjustMode, quantity: number, onHand: number): number {
  const units = Math.trunc(quantity);
  switch (mode) {
    case "add":
      return units;
    case "remove":
      return -units;
    case "set":
      return units - Math.trunc(onHand);
  }
}

export type AdjustmentPreview = {
  delta: number;
  nextOnHand: number;
  nextAvailable: number;
  nextState: StockState;
  /** The result would take on hand or available below zero. */
  negative: boolean;
  /** Negative and the item does not accept backorders: the service will refuse it. */
  blocked: boolean;
  /** Nothing would move (a "set" to the current count, or a zero quantity). */
  noop: boolean;
};

export function previewAdjustment(input: {
  mode: AdjustMode;
  quantity: number;
  onHand: number;
  reserved: number;
  lowStockThreshold: number;
  allowBackorder: boolean;
}): AdjustmentPreview {
  const delta = resolveDelta(input.mode, input.quantity, input.onHand);
  const nextOnHand = input.onHand + delta;
  const nextAvailable = nextOnHand - input.reserved;
  const negative = nextOnHand < 0 || nextAvailable < 0;

  return {
    delta,
    nextOnHand,
    nextAvailable,
    nextState: stockState(nextAvailable, input.lowStockThreshold, input.allowBackorder),
    negative,
    blocked: negative && !input.allowBackorder,
    noop: delta === 0,
  };
}

/** "+3", "-2", "0" - the ledger convention for a signed delta. */
export function formatSigned(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}
