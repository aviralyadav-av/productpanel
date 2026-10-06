"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Receipt, Trash2 } from "lucide-react";

import {
  MARKETPLACE_CHARGE_CONDITIONS,
  MARKETPLACE_CHARGE_TYPES,
  type MarketplaceChargeCondition,
  type MarketplaceChargeType,
} from "@/lib/enums";
import { formatPaise } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/empty-state";
import { FieldError } from "@/components/shared/form-layout";
import { MoneyInput } from "@/components/shared/money-input";
import { PercentInput } from "@/components/shared/percent-input";
import { useActionToast } from "@/components/shared/use-action-toast";

import { saveChargesAction } from "../actions";
import type { ChargeRowValues } from "../ui-schemas";
import { formatBps } from "../ui-identity";

/**
 * Editor for the `marketplace.charges` setting (blueprint §14.B3).
 *
 * These rules are deducted from what a seller is paid on every line, so the
 * editor is deliberately explicit: the amount field switches between a
 * percentage and a rupee amount with the type, and the whole array is saved at
 * once rather than row-by-row - a half-saved charge list would price orders
 * with a rule set nobody chose.
 */

const TYPE_LABEL: Record<MarketplaceChargeType, string> = {
  PERCENT_OF_GROSS: "% of gross",
  FIXED_PER_ITEM: "Fixed per item",
  FIXED_PER_ORDER: "Fixed per order",
};

const CONDITION_LABEL: Record<MarketplaceChargeCondition, string> = {
  ALWAYS: "Always",
  ONLINE_PAYMENT: "Online payments only",
  COD: "COD only",
};

type Row = ChargeRowValues & { key: string };

function toRows(charges: readonly ChargeRowValues[]): Row[] {
  return charges.map((charge, index) => ({ ...charge, key: `${charge.code}-${index}` }));
}

function blankRow(index: number): Row {
  return {
    key: `new-${index}-${Date.now()}`,
    code: "",
    label: "",
    type: "PERCENT_OF_GROSS",
    valueBps: 0,
    valuePaise: null,
    appliesWhen: "ALWAYS",
  };
}

export function ChargesEditor({
  charges,
  canManage,
}: {
  charges: ChargeRowValues[];
  canManage: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [rows, setRows] = React.useState<Row[]>(() => toRows(charges));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [dirty, setDirty] = React.useState(false);

  function patch(key: string, changes: Partial<ChargeRowValues>) {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...changes } : row)));
    setDirty(true);
  }

  function addRow() {
    setRows((prev) => [...prev, blankRow(prev.length)]);
    setDirty(true);
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((row) => row.key !== key));
    setDirty(true);
  }

  async function save() {
    const payload = rows.map((row) => ({
      code: row.code,
      label: row.label,
      type: row.type,
      // Only the field the type uses is sent; the other stays null so a
      // percentage rule can never smuggle a stale rupee amount along.
      valueBps: row.type === "PERCENT_OF_GROSS" ? (row.valueBps ?? 0) : null,
      valuePaise: row.type === "PERCENT_OF_GROSS" ? null : (row.valuePaise ?? 0),
      appliesWhen: row.appliesWhen,
    }));

    const result = await run(() => saveChargesAction({ charges: payload }), {
      onSuccess: () => {
        setDirty(false);
        router.refresh();
      },
    });
    if (!result.ok) setErrors(result.fieldErrors ?? {});
    else setErrors({});
  }

  return (
    <section className="surface space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="bg-warning-muted text-warning grid size-8 shrink-0 place-items-center rounded-md">
            <Receipt className="size-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Marketplace charges</h2>
            <p className="text-muted-foreground text-xs">
              Deducted from the seller&apos;s payable on top of commission, snapshotted onto every order line.
            </p>
          </div>
        </div>
        {canManage ? (
          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus />
            Add
          </Button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          compact
          icon={Receipt}
          title="No marketplace charges"
          description="Sellers keep everything but commission. Add a rule to deduct a payment-gateway fee or a fixed handling charge."
        />
      ) : (
        <div className="space-y-2">
          {rows.map((row, index) => (
            <ChargeRowFields
              key={row.key}
              row={row}
              index={index}
              disabled={!canManage}
              errors={errors}
              onChange={(changes) => patch(row.key, changes)}
              onRemove={() => removeRow(row.key)}
            />
          ))}
        </div>
      )}

      {errors.charges ? <FieldError>{errors.charges}</FieldError> : null}

      {canManage ? (
        <div className="flex items-center justify-end gap-2">
          {dirty ? <span className="text-muted-foreground mr-auto text-xs">Unsaved changes</span> : null}
          <Button size="sm" onClick={save} disabled={pending || !dirty}>
            Save charges
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function ChargeRowFields({
  row,
  index,
  disabled,
  errors,
  onChange,
  onRemove,
}: {
  row: Row;
  index: number;
  disabled: boolean;
  errors: Record<string, string>;
  onChange: (changes: Partial<ChargeRowValues>) => void;
  onRemove: () => void;
}) {
  const prefix = `charges.${index}`;
  const isPercent = row.type === "PERCENT_OF_GROSS";

  return (
    <div className="grid gap-2 rounded-md border p-2 sm:grid-cols-[9rem_1fr_10rem_9rem_10rem_auto]">
      <div>
        <Input
          aria-label="Code"
          placeholder="gateway_fee"
          value={row.code}
          disabled={disabled}
          maxLength={40}
          onChange={(event) => onChange({ code: event.target.value })}
          aria-invalid={Boolean(errors[`${prefix}.code`])}
          className="font-mono text-xs"
        />
        {errors[`${prefix}.code`] ? <FieldError>{errors[`${prefix}.code`]}</FieldError> : null}
      </div>
      <div>
        <Input
          aria-label="Label"
          placeholder="Payment gateway fee"
          value={row.label}
          disabled={disabled}
          maxLength={80}
          onChange={(event) => onChange({ label: event.target.value })}
          aria-invalid={Boolean(errors[`${prefix}.label`])}
        />
        {errors[`${prefix}.label`] ? <FieldError>{errors[`${prefix}.label`]}</FieldError> : null}
      </div>
      <Select
        value={row.type}
        disabled={disabled}
        onValueChange={(value) =>
          onChange(
            value === "PERCENT_OF_GROSS"
              ? { type: value as MarketplaceChargeType, valuePaise: null, valueBps: row.valueBps ?? 0 }
              : { type: value as MarketplaceChargeType, valueBps: null, valuePaise: row.valuePaise ?? 0 },
          )
        }
      >
        <SelectTrigger aria-label="Charge type" size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MARKETPLACE_CHARGE_TYPES.map((type) => (
            <SelectItem key={type} value={type}>
              {TYPE_LABEL[type]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div>
        {isPercent ? (
          <PercentInput
            valueBps={row.valueBps}
            disabled={disabled}
            onChangeBps={(valueBps) => onChange({ valueBps })}
            invalid={Boolean(errors[`${prefix}.valueBps`])}
          />
        ) : (
          <MoneyInput
            valuePaise={row.valuePaise}
            disabled={disabled}
            onChangePaise={(valuePaise) => onChange({ valuePaise })}
            invalid={Boolean(errors[`${prefix}.valuePaise`])}
          />
        )}
        {errors[`${prefix}.valueBps`] ? <FieldError>{errors[`${prefix}.valueBps`]}</FieldError> : null}
        {errors[`${prefix}.valuePaise`] ? <FieldError>{errors[`${prefix}.valuePaise`]}</FieldError> : null}
      </div>
      <Select
        value={row.appliesWhen}
        disabled={disabled}
        onValueChange={(value) => onChange({ appliesWhen: value as MarketplaceChargeCondition })}
      >
        <SelectTrigger aria-label="Applies when" size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MARKETPLACE_CHARGE_CONDITIONS.map((condition) => (
            <SelectItem key={condition} value={condition}>
              {CONDITION_LABEL[condition]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {disabled ? (
        <span className="text-muted-foreground self-center text-xs">
          {isPercent ? formatBps(row.valueBps ?? 0) : formatPaise(row.valuePaise ?? 0)}
        </span>
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onRemove}
          aria-label={`Remove ${row.label || row.code || "charge"}`}
          className="self-center"
        >
          <Trash2 />
        </Button>
      )}
    </div>
  );
}
