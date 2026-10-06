"use client";

import * as React from "react";
import { cn } from "cn";

import { Input } from "@/components/ui/input";

/**
 * The operator types a percentage ("12.5"); the form submits basis points
 * (1250). Rates are stored as Int bps everywhere (commission, GST, discounts)
 * so that 12.5% of a paise amount is integer arithmetic with no float drift.
 *
 * @example
 *   <PercentInput name="commissionBps" defaultValueBps={seller.commissionBps} />
 *   <PercentInput valueBps={rate} onChangeBps={setRate} max={100} />
 */
export function PercentInput({
  name,
  id,
  valueBps,
  defaultValueBps,
  onChangeBps,
  min = 0,
  max = 100,
  placeholder = "0",
  disabled,
  required,
  invalid,
  className,
}: {
  name?: string;
  id?: string;
  valueBps?: number | null;
  defaultValueBps?: number | null;
  onChangeBps?: (bps: number | null) => void;
  /** Percent bounds; values outside are clamped on blur. */
  min?: number;
  max?: number;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  className?: string;
}) {
  const isControlled = valueBps !== undefined;
  const [text, setText] = React.useState(() =>
    formatPercentText(isControlled ? valueBps : (defaultValueBps ?? null)),
  );
  const [bps, setBps] = React.useState<number | null>(
    isControlled ? (valueBps ?? null) : (defaultValueBps ?? null),
  );
  const [focused, setFocused] = React.useState(false);

  // Previous-prop-in-state: follow external changes while not typing.
  const [prevExternal, setPrevExternal] = React.useState(valueBps);
  if (isControlled && valueBps !== prevExternal) {
    setPrevExternal(valueBps);
    if (!focused && valueBps !== bps) {
      setBps(valueBps ?? null);
      setText(formatPercentText(valueBps ?? null));
    }
  }

  function commit(raw: string, clamp: boolean) {
    let parsed = parsePercent(raw);
    if (parsed !== null && clamp) {
      parsed = Math.min(Math.round(max * 100), Math.max(Math.round(min * 100), parsed));
    }
    setBps(parsed);
    onChangeBps?.(parsed);
    return parsed;
  }

  return (
    <div className={cn("relative", className)}>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        aria-invalid={invalid || undefined}
        className="h-8 pr-7 text-xs tabular"
        onFocus={() => setFocused(true)}
        onChange={(event) => {
          const next = event.target.value.replace(/[^\d.]/g, "");
          setText(next);
          commit(next, false);
        }}
        onBlur={(event) => {
          setFocused(false);
          const parsed = commit(event.target.value, true);
          setText(formatPercentText(parsed));
        }}
      />
      <span
        aria-hidden
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs"
      >
        %
      </span>
      {name ? (
        <input type="hidden" name={name} value={bps === null ? "" : String(bps)} />
      ) : null}
    </div>
  );
}

function formatPercentText(bps: number | null): string {
  if (bps === null || Number.isNaN(bps)) return "";
  const percent = bps / 100;
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(2).replace(/0$/, "");
}

/** "12.5" -> 1250. Two decimals of a percent is the resolution of a bp. */
function parsePercent(raw: string): number | null {
  const cleaned = raw.trim();
  if (cleaned === "" || cleaned === ".") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}
