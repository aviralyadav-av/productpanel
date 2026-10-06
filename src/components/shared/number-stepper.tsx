"use client";

import * as React from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";

/**
 * An integer input with -/+ buttons, for quantities and positions where the
 * operator adjusts by one far more often than they type a number. Arrow keys
 * step too; Shift steps by ten. Bounds are clamped, never rejected, so the
 * value is always valid.
 *
 * @example
 *   <NumberStepper value={qty} onChange={setQty} min={0} max={stock} aria-label="Quantity" />
 */
export function NumberStepper({
  value,
  onChange,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  step = 1,
  name,
  id,
  disabled,
  size = "sm",
  className,
  "aria-label": ariaLabel,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  name?: string;
  id?: string;
  disabled?: boolean;
  size?: "sm" | "default";
  className?: string;
  "aria-label"?: string;
}) {
  const [text, setText] = React.useState(String(value));
  // Previous-prop-in-state: re-sync the text when the parent changes value.
  const [prevValue, setPrevValue] = React.useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setText(String(value));
  }

  function commit(next: number) {
    const clamped = Math.min(max, Math.max(min, Math.round(next)));
    setPrevValue(clamped);
    setText(String(clamped));
    if (clamped !== value) onChange(clamped);
  }

  const height = size === "sm" ? "h-7" : "h-8";

  return (
    <div
      className={cn(
        "border-input focus-within:border-ring focus-within:ring-ring/50 inline-flex items-stretch overflow-hidden rounded-lg border transition-colors focus-within:ring-3 dark:bg-input/30",
        height,
        disabled && "opacity-50",
        className,
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={cn("rounded-none border-r", height)}
        disabled={disabled || value <= min}
        aria-label="Decrease"
        onClick={() => commit(value - step)}
      >
        <Minus />
      </Button>
      <input
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        role="spinbutton"
        aria-label={ariaLabel}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        value={text}
        disabled={disabled}
        className="w-12 bg-transparent text-center text-xs tabular outline-none"
        onChange={(event) => {
          const next = event.target.value.replace(/[^\d-]/g, "");
          setText(next);
          if (next !== "" && next !== "-") commit(Number(next));
        }}
        onBlur={() => commit(text === "" || text === "-" ? min : Number(text))}
        onKeyDown={(event) => {
          const factor = event.shiftKey ? 10 : 1;
          if (event.key === "ArrowUp") {
            event.preventDefault();
            commit(value + step * factor);
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            commit(value - step * factor);
          }
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={cn("rounded-none border-l", height)}
        disabled={disabled || value >= max}
        aria-label="Increase"
        onClick={() => commit(value + step)}
      >
        <Plus />
      </Button>
    </div>
  );
}
