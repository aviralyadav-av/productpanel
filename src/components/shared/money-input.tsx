"use client";

import * as React from "react";
import { cn } from "cn";

import { Input } from "@/components/ui/input";
import { paiseToRupees, rupeesToPaise } from "@/lib/money";

/**
 * The operator types rupees; the form submits paise.
 *
 * The visible input is free text so "1,299.50" and "1299.5" both work while
 * typing; on blur it is normalised to "1,299.50". The hidden input named
 * `name` carries the integer paise, which is the only unit the server accepts
 * (see src/lib/money.ts). Controlled use gets `valuePaise` / `onChangePaise`.
 *
 * @example
 *   <MoneyInput name="pricePaise" defaultValuePaise={product.pricePaise} />
 *   <MoneyInput valuePaise={draft.pricePaise} onChangePaise={(p) => update("pricePaise", p)} />
 */
export function MoneyInput({
  name,
  id,
  valuePaise,
  defaultValuePaise,
  onChangePaise,
  placeholder = "0",
  disabled,
  required,
  invalid,
  className,
  allowEmpty = true,
}: {
  name?: string;
  id?: string;
  valuePaise?: number | null;
  defaultValuePaise?: number | null;
  onChangePaise?: (paise: number | null) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  className?: string;
  /** When false, an empty field submits 0 rather than "". */
  allowEmpty?: boolean;
}) {
  const isControlled = valuePaise !== undefined;
  const [text, setText] = React.useState(() =>
    formatRupees(isControlled ? valuePaise : (defaultValuePaise ?? null)),
  );
  const [paise, setPaise] = React.useState<number | null>(
    isControlled ? (valuePaise ?? null) : (defaultValuePaise ?? null),
  );
  const [focused, setFocused] = React.useState(false);

  // Follow external changes while not typing (a reset, a loaded record).
  // "Previous prop in state" is the React-sanctioned way to derive state from
  // a prop change without an effect and without touching a ref in render.
  const [prevExternal, setPrevExternal] = React.useState(valuePaise);
  if (isControlled && valuePaise !== prevExternal) {
    setPrevExternal(valuePaise);
    if (!focused && valuePaise !== paise) {
      setPaise(valuePaise ?? null);
      setText(formatRupees(valuePaise ?? null));
    }
  }

  function commit(raw: string) {
    const parsed = parseRupees(raw);
    setPaise(parsed);
    onChangePaise?.(parsed);
    return parsed;
  }

  return (
    <div className={cn("relative", className)}>
      <span
        aria-hidden
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs"
      >
        &#8377;
      </span>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        aria-invalid={invalid || undefined}
        className="h-8 pl-6 text-xs tabular"
        onFocus={() => setFocused(true)}
        onChange={(event) => {
          // Allow digits, one dot, commas; reject letters early.
          const next = event.target.value.replace(/[^\d.,]/g, "");
          setText(next);
          commit(next);
        }}
        onBlur={(event) => {
          setFocused(false);
          const parsed = commit(event.target.value);
          setText(formatRupees(parsed));
        }}
      />
      {name ? (
        <input
          type="hidden"
          name={name}
          value={paise === null ? (allowEmpty ? "" : "0") : String(paise)}
        />
      ) : null}
    </div>
  );
}

const RUPEE_TEXT = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function formatRupees(paise: number | null): string {
  if (paise === null || Number.isNaN(paise)) return "";
  return RUPEE_TEXT.format(paiseToRupees(paise));
}

function parseRupees(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").trim();
  if (cleaned === "" || cleaned === ".") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return rupeesToPaise(value);
}
