"use client";

import * as React from "react";

import { SearchableSelect } from "@/components/shared/combobox";
import { FormRow } from "@/components/shared/form-layout";
import { MoneyInput } from "@/components/shared/money-input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import { CategorySelect } from "@/features/products/components/category-select";
import type { AttributeCatalogEntry, CategoryOption } from "@/features/products/queries";
import { PRICE_ADJUST_MODES, type BulkOperation, type PriceAdjustMode } from "@/features/products/schemas";

/**
 * The parameter dialogs behind the bulk bar (blueprint A7). Each resolves to a
 * fully-formed BulkOperation so the caller only has to add the ids; the
 * server re-validates with the same zod schema.
 */
export type BulkDialogKind = "SET_CATEGORY" | "ADJUST_PRICE" | "SET_STOCK" | "SET_FLAGS" | "SET_ATTRIBUTE";

export function BulkOpDialog({
  kind,
  count,
  categories,
  attributes,
  onClose,
  onConfirm,
}: {
  kind: BulkDialogKind | null;
  count: number;
  categories: CategoryOption[];
  attributes: AttributeCatalogEntry[];
  onClose(): void;
  onConfirm(op: BulkOperation): Promise<void> | void;
}) {
  return (
    <Dialog open={kind !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {kind === "SET_CATEGORY" ? <SetCategoryBody count={count} categories={categories} onConfirm={onConfirm} /> : null}
        {kind === "ADJUST_PRICE" ? <AdjustPriceBody count={count} onConfirm={onConfirm} /> : null}
        {kind === "SET_STOCK" ? <SetStockBody count={count} onConfirm={onConfirm} /> : null}
        {kind === "SET_FLAGS" ? <SetFlagsBody count={count} onConfirm={onConfirm} /> : null}
        {kind === "SET_ATTRIBUTE" ? <SetAttributeBody count={count} attributes={attributes} onConfirm={onConfirm} /> : null}
      </DialogContent>
    </Dialog>
  );
}

type BodyProps = { count: number; onConfirm(op: BulkOperation): Promise<void> | void };

function Footer({ disabled, pending, label }: { disabled?: boolean; pending: boolean; label: string }) {
  return (
    <DialogFooter>
      <Button type="submit" size="sm" disabled={disabled || pending}>
        {pending ? "Applying" : label}
      </Button>
    </DialogFooter>
  );
}

function useSubmit(onConfirm: BodyProps["onConfirm"]) {
  const [pending, setPending] = React.useState(false);
  const submit = async (op: BulkOperation) => {
    setPending(true);
    try {
      await onConfirm(op);
    } finally {
      setPending(false);
    }
  };
  return { pending, submit };
}

function SetCategoryBody({ count, categories, onConfirm }: BodyProps & { categories: CategoryOption[] }) {
  const [categoryId, setCategoryId] = React.useState<string | null>(null);
  const { pending, submit } = useSubmit(onConfirm);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (categoryId) void submit({ op: "SET_CATEGORY", categoryId });
      }}
      className="space-y-4"
    >
      <DialogHeader>
        <DialogTitle>Move {count} product(s) to a category</DialogTitle>
        <DialogDescription>Attribute values stay on the products; values the new category does not use are flagged in each editor (blueprint A6).</DialogDescription>
      </DialogHeader>
      <FormRow label="Category" required>
        <CategorySelect categories={categories} value={categoryId} onChange={setCategoryId} placeholder="Choose a category" allowClear={false} />
      </FormRow>
      <Footer disabled={!categoryId} pending={pending} label="Move" />
    </form>
  );
}

const MODE_LABELS: Record<PriceAdjustMode, string> = { PERCENT: "Change by %", FIXED: "Change by amount", SET: "Set to amount" };

function AdjustPriceBody({ count, onConfirm }: BodyProps) {
  const [mode, setMode] = React.useState<PriceAdjustMode>("PERCENT");
  const [percent, setPercent] = React.useState("");
  const [paise, setPaise] = React.useState<number | null>(null);
  const { pending, submit } = useSubmit(onConfirm);
  const value = mode === "PERCENT" ? Number(percent) : paise;
  const valid = mode === "PERCENT" ? percent.trim() !== "" && Number.isFinite(value) && (value as number) >= -90 && (value as number) <= 1000 : paise !== null && (mode !== "SET" || paise > 0);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && value !== null) void submit({ op: "ADJUST_PRICE", mode, value });
      }}
      className="space-y-4"
    >
      <DialogHeader>
        <DialogTitle>Adjust prices on {count} product(s)</DialogTitle>
        <DialogDescription>Applies to the product price and to variants with their own price. A sale price that would no longer be lower is removed.</DialogDescription>
      </DialogHeader>
      <FormRow label="Mode">
        <Select value={mode} onValueChange={(next) => setMode(next as PriceAdjustMode)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRICE_ADJUST_MODES.map((item) => (
              <SelectItem key={item} value={item}>
                {MODE_LABELS[item]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormRow>
      {mode === "PERCENT" ? (
        <FormRow label="Percent" hint="Negative lowers the price: -10 = 10% off. Range -90 to 1000." required>
          <Input type="number" step="0.1" min={-90} max={1000} value={percent} onChange={(event) => setPercent(event.target.value)} />
        </FormRow>
      ) : (
        <FormRow label={mode === "SET" ? "New price" : "Amount"} hint={mode === "FIXED" ? "Negative lowers the price." : undefined} required>
          <MoneyInput valuePaise={paise} onChangePaise={setPaise} allowEmpty />
        </FormRow>
      )}
      <Footer disabled={!valid} pending={pending} label="Adjust prices" />
    </form>
  );
}

function SetStockBody({ count, onConfirm }: BodyProps) {
  const [onHand, setOnHand] = React.useState("");
  const [reason, setReason] = React.useState("Bulk stock update");
  const { pending, submit } = useSubmit(onConfirm);
  const quantity = Number(onHand);
  const valid = onHand.trim() !== "" && Number.isInteger(quantity) && quantity >= 0 && reason.trim().length > 0;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) void submit({ op: "SET_STOCK", onHand: quantity, reason: reason.trim() });
      }}
      className="space-y-4"
    >
      <DialogHeader>
        <DialogTitle>Set stock on {count} product(s)</DialogTitle>
        <DialogDescription>Writes an ADJUSTMENT movement on each product&apos;s default variant so the ledger stays the source of truth. Needs the inventory.adjust permission.</DialogDescription>
      </DialogHeader>
      <FormRow label="On hand" required>
        <Input type="number" min={0} step={1} value={onHand} onChange={(event) => setOnHand(event.target.value)} />
      </FormRow>
      <FormRow label="Reason" required hint="Recorded on every movement.">
        <Input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={200} />
      </FormRow>
      <Footer disabled={!valid} pending={pending} label="Set stock" />
    </form>
  );
}

const FLAGS = [
  ["isFeatured", "Featured"],
  ["isNewArrival", "New arrival"],
  ["isBestseller", "Bestseller"],
  ["isTrending", "Trending"],
] as const;

function SetFlagsBody({ count, onConfirm }: BodyProps) {
  const [flags, setFlags] = React.useState<Record<string, boolean | undefined>>({});
  const { pending, submit } = useSubmit(onConfirm);
  const touched = Object.values(flags).some((value) => value !== undefined);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (touched) void submit({ op: "SET_FLAGS", ...flags });
      }}
      className="space-y-4"
    >
      <DialogHeader>
        <DialogTitle>Set flags on {count} product(s)</DialogTitle>
        <DialogDescription>Only flags you change here are written; untouched flags keep each product&apos;s current value.</DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        {FLAGS.map(([key, label]) => (
          <div key={key} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
            <span>{label}</span>
            <div className="flex items-center gap-1">
              {(["off", "keep", "on"] as const).map((choice) => {
                const current = flags[key] === undefined ? "keep" : flags[key] ? "on" : "off";
                return (
                  <Button
                    key={choice}
                    type="button"
                    size="xs"
                    variant={current === choice ? "secondary" : "ghost"}
                    onClick={() => setFlags((prev) => ({ ...prev, [key]: choice === "keep" ? undefined : choice === "on" }))}
                  >
                    {choice === "keep" ? "Keep" : choice === "on" ? "On" : "Off"}
                  </Button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <Footer disabled={!touched} pending={pending} label="Apply flags" />
    </form>
  );
}

function SetAttributeBody({ count, attributes, onConfirm }: BodyProps & { attributes: AttributeCatalogEntry[] }) {
  const [attributeId, setAttributeId] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<"set" | "add" | "remove">("set");
  const [valueId, setValueId] = React.useState<string | null>(null);
  const [text, setText] = React.useState("");
  const [bool, setBool] = React.useState(true);
  const { pending, submit } = useSubmit(onConfirm);
  const attribute = attributes.find((item) => item.id === attributeId) ?? null;
  const isSelect = attribute ? ["SELECT", "MULTI_SELECT", "COLOR"].includes(attribute.inputType) : false;

  const build = (): BulkOperation | null => {
    if (!attribute) return null;
    if (mode === "remove") return { op: "SET_ATTRIBUTE", attributeId: attribute.id, mode, valueId: isSelect && valueId ? valueId : undefined };
    if (isSelect) return valueId ? { op: "SET_ATTRIBUTE", attributeId: attribute.id, mode, valueId } : null;
    if (attribute.inputType === "NUMBER") return text.trim() && Number.isFinite(Number(text)) ? { op: "SET_ATTRIBUTE", attributeId: attribute.id, mode: "set", numberValue: Number(text) } : null;
    if (attribute.inputType === "BOOLEAN") return { op: "SET_ATTRIBUTE", attributeId: attribute.id, mode: "set", boolValue: bool };
    return text.trim() ? { op: "SET_ATTRIBUTE", attributeId: attribute.id, mode: "set", textValue: text.trim() } : null;
  };
  const op = build();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (op) void submit(op);
      }}
      className="space-y-4"
    >
      <DialogHeader>
        <DialogTitle>Set an attribute on {count} product(s)</DialogTitle>
        <DialogDescription>Writes the product&apos;s own value (variant-derived values are untouched). Products outside the attribute&apos;s category keep the value as an orphan.</DialogDescription>
      </DialogHeader>
      <FormRow label="Attribute" required>
        <SearchableSelect
          options={attributes.map((item) => ({ value: item.id, label: item.name, description: `${item.code} · ${item.inputType}` }))}
          value={attributeId}
          onChange={(next) => {
            setAttributeId(next);
            setValueId(null);
          }}
          placeholder="Choose an attribute"
        />
      </FormRow>
      {attribute ? (
        <>
          {isSelect ? (
            <FormRow label="Mode">
              <Select value={mode} onValueChange={(next) => setMode(next as typeof mode)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="set">Set (replace current values)</SelectItem>
                  <SelectItem value="add">Add to current values</SelectItem>
                  <SelectItem value="remove">Remove</SelectItem>
                </SelectContent>
              </Select>
            </FormRow>
          ) : null}
          {isSelect ? (
            <FormRow label="Value" required={mode !== "remove"} hint={mode === "remove" ? "Leave blank to remove every value of this attribute." : undefined}>
              <SearchableSelect
                options={attribute.values.map((item) => ({ value: item.id, label: item.label, description: item.colorHex ?? undefined }))}
                value={valueId}
                onChange={setValueId}
                placeholder="Choose a value"
                allowClear
              />
            </FormRow>
          ) : attribute.inputType === "BOOLEAN" ? (
            <FormRow label="Value" inline>
              <Switch checked={bool} onCheckedChange={setBool} />
            </FormRow>
          ) : (
            <FormRow label={attribute.unit ? `Value (${attribute.unit})` : "Value"} required>
              <Input type={attribute.inputType === "NUMBER" ? "number" : "text"} value={text} onChange={(event) => setText(event.target.value)} />
            </FormRow>
          )}
        </>
      ) : null}
      <Footer disabled={!op} pending={pending} label={mode === "remove" ? "Remove" : "Apply"} />
    </form>
  );
}
