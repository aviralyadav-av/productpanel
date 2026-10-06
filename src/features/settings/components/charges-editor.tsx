"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";

import {
  MARKETPLACE_CHARGE_CONDITIONS,
  MARKETPLACE_CHARGE_TYPES,
  type MarketplaceChargeCondition,
  type MarketplaceChargeType,
} from "@/lib/enums";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MoneyInput } from "@/components/shared/money-input";
import { PercentInput } from "@/components/shared/percent-input";

/**
 * Structured editor for the `marketplace.charges` JSON setting (B3): the rules
 * deducted from a seller's payable on top of commission.
 *
 * It edits rows and serialises them back to the JSON string the setting
 * stores, because asking an operator to hand-write
 * `[{"code":"PACKAGING","type":"FIXED_PER_ITEM","valuePaise":500}]` is how a
 * seller ends up paying 500 rupees per item instead of 5.
 */

type Row = {
  code: string;
  label: string;
  type: MarketplaceChargeType;
  valueBps: number | null;
  valuePaise: number | null;
  appliesWhen: MarketplaceChargeCondition;
};

const TYPE_LABELS: Record<MarketplaceChargeType, string> = {
  PERCENT_OF_GROSS: "% of gross",
  FIXED_PER_ITEM: "Fixed per item",
  FIXED_PER_ORDER: "Fixed per order",
};

const CONDITION_LABELS: Record<MarketplaceChargeCondition, string> = {
  ALWAYS: "Always",
  ONLINE_PAYMENT: "Online payments only",
  COD: "COD only",
};

function parseRows(json: string): Row[] {
  try {
    const parsed = JSON.parse(json || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((raw) => {
      const item = (raw ?? {}) as Record<string, unknown>;
      const type = (MARKETPLACE_CHARGE_TYPES as readonly string[]).includes(String(item.type))
        ? (item.type as MarketplaceChargeType)
        : "PERCENT_OF_GROSS";
      const appliesWhen = (MARKETPLACE_CHARGE_CONDITIONS as readonly string[]).includes(
        String(item.appliesWhen),
      )
        ? (item.appliesWhen as MarketplaceChargeCondition)
        : "ALWAYS";
      return {
        code: String(item.code ?? ""),
        label: String(item.label ?? ""),
        type,
        valueBps: typeof item.valueBps === "number" ? item.valueBps : null,
        valuePaise: typeof item.valuePaise === "number" ? item.valuePaise : null,
        appliesWhen,
      };
    });
  } catch {
    return [];
  }
}

function serialiseRows(rows: readonly Row[]): string {
  return JSON.stringify(
    rows
      .filter((row) => row.code.trim() !== "")
      .map((row) => ({
        code: row.code.trim(),
        label: row.label.trim() || row.code.trim(),
        type: row.type,
        appliesWhen: row.appliesWhen,
        ...(row.type === "PERCENT_OF_GROSS"
          ? { valueBps: row.valueBps ?? 0 }
          : { valuePaise: row.valuePaise ?? 0 }),
      })),
  );
}

export function ChargesEditor({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  // The JSON string is the source of truth (it is what gets posted), but
  // re-parsing on every keystroke would fight the inputs, so rows are local
  // state seeded from the incoming value.
  const [rows, setRows] = React.useState<Row[]>(() => parseRows(value));

  function apply(next: Row[]) {
    setRows(next);
    onChange(serialiseRows(next));
  }

  function update(index: number, patch: Partial<Row>) {
    apply(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No charges. Sellers keep everything except commission and tax.
        </p>
      ) : null}

      {rows.map((row, index) => (
        <div key={index} className="grid gap-2 rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1">
            <Label htmlFor={`charge-code-${index}`} className="text-[11px]">
              Code
            </Label>
            <Input
              id={`charge-code-${index}`}
              value={row.code}
              onChange={(event) => update(index, { code: event.target.value })}
              disabled={disabled}
              placeholder="PACKAGING"
              className="font-mono text-xs"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor={`charge-label-${index}`} className="text-[11px]">
              Label
            </Label>
            <Input
              id={`charge-label-${index}`}
              value={row.label}
              onChange={(event) => update(index, { label: event.target.value })}
              disabled={disabled}
              placeholder="Packaging fee"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-[11px]">Type</Label>
            <Select
              value={row.type}
              onValueChange={(next) => update(index, { type: next as MarketplaceChargeType })}
              disabled={disabled}
            >
              <SelectTrigger size="sm" aria-label="Charge type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MARKETPLACE_CHARGE_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-[11px]">Value</Label>
            {row.type === "PERCENT_OF_GROSS" ? (
              <PercentInput
                valueBps={row.valueBps}
                onChangeBps={(bps) => update(index, { valueBps: bps })}
                disabled={disabled}
              />
            ) : (
              <MoneyInput
                valuePaise={row.valuePaise}
                onChangePaise={(paise) => update(index, { valuePaise: paise })}
                disabled={disabled}
                allowEmpty={false}
              />
            )}
          </div>

          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <Label className="text-[11px]">Applies when</Label>
              <Select
                value={row.appliesWhen}
                onValueChange={(next) =>
                  update(index, { appliesWhen: next as MarketplaceChargeCondition })
                }
                disabled={disabled}
              >
                <SelectTrigger size="sm" aria-label="Applies when">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MARKETPLACE_CHARGE_CONDITIONS.map((condition) => (
                    <SelectItem key={condition} value={condition}>
                      {CONDITION_LABELS[condition]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${row.code || "charge"}`}
              disabled={disabled}
              onClick={() => apply(rows.filter((_, i) => i !== index))}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="xs"
        disabled={disabled}
        onClick={() =>
          apply([
            ...rows,
            {
              code: "",
              label: "",
              type: "PERCENT_OF_GROSS",
              valueBps: 0,
              valuePaise: null,
              appliesWhen: "ALWAYS",
            },
          ])
        }
      >
        <Plus className="size-3.5" />
        Add charge
      </Button>
    </div>
  );
}
