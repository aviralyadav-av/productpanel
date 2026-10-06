"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { useActionToast } from "@/components/shared/use-action-toast";

import { addAttributeValueAction, deleteAttributeValueAction, reorderAttributeValuesAction, updateAttributeValueAction } from "../actions";
import type { AttributeValueRow } from "../queries";
import { valueTokenFromLabel } from "../schemas";

/**
 * Values of a SELECT / MULTI_SELECT / COLOR attribute. The stored `value`
 * (the filter token) is derived from the label unless the operator edits it;
 * COLOR attributes carry a swatch. A value in use cannot be deleted (its
 * products would lose data) - the row shows the counts and offers
 * deactivation instead.
 */
export function AttributeValuesPanel({
  attributeId,
  isColor,
  values,
  canManage,
}: {
  attributeId: string;
  isColor: boolean;
  values: AttributeValueRow[];
  canManage: boolean;
}) {
  const { pending, run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();
  const [draft, setDraft] = React.useState({ label: "", value: "", colorHex: "#888888", touched: false });
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [addError, setAddError] = React.useState<string | null>(null);

  async function add() {
    setAddError(null);
    const result = await run(
      () =>
        addAttributeValueAction(attributeId, {
          label: draft.label,
          value: draft.value || undefined,
          colorHex: isColor ? draft.colorHex : "",
          isActive: true,
        }),
      { onSuccess: () => setDraft({ label: "", value: "", colorHex: "#888888", touched: false }) },
    );
    if (!result.ok && result.fieldErrors) setAddError(Object.values(result.fieldErrors)[0] ?? null);
  }

  async function remove(row: AttributeValueRow) {
    const used = row.usage.products + row.usage.variants;
    if (used > 0) {
      await run(() => deleteAttributeValueAction(attributeId, row.id)); // the service explains why in the toast
      return;
    }
    const ok = await confirm({ title: `Delete "${row.label ?? row.value}"?`, description: "Nothing uses this value.", confirmLabel: "Delete", destructive: true });
    if (!ok.ok) return;
    await run(() => deleteAttributeValueAction(attributeId, row.id));
  }

  function move(row: AttributeValueRow, direction: -1 | 1) {
    const ids = values.map((value) => value.id);
    const index = ids.indexOf(row.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    return run(() => reorderAttributeValuesAction(attributeId, ids), { silent: true });
  }

  return (
    <div className="space-y-3">
      {canManage ? (
        <div className="flex flex-wrap items-end gap-2 px-3 pt-3">
          <div className="min-w-40 flex-1 space-y-1">
            <label htmlFor="value-label" className="text-muted-foreground text-[11px]">
              Label
            </label>
            <Input
              id="value-label"
              value={draft.label}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  label: event.target.value,
                  value: current.touched ? current.value : valueTokenFromLabel(event.target.value),
                }))
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (draft.label.trim()) add();
                }
              }}
              placeholder={isColor ? "e.g. Terracotta" : "e.g. Large"}
              disabled={pending}
              className="h-8"
            />
          </div>
          <div className="min-w-36 space-y-1">
            <label htmlFor="value-token" className="text-muted-foreground text-[11px]">
              Value (filter token)
            </label>
            <Input
              id="value-token"
              value={draft.value}
              onChange={(event) => setDraft((current) => ({ ...current, value: event.target.value, touched: true }))}
              disabled={pending}
              className="h-8 font-mono"
            />
          </div>
          {isColor ? (
            <div className="space-y-1">
              <label htmlFor="value-color" className="text-muted-foreground text-[11px]">
                Swatch
              </label>
              <input
                id="value-color"
                type="color"
                value={draft.colorHex}
                onChange={(event) => setDraft((current) => ({ ...current, colorHex: event.target.value }))}
                disabled={pending}
                className="border-input h-8 w-12 cursor-pointer rounded-md border bg-transparent p-0.5"
              />
            </div>
          ) : null}
          <Button type="button" size="sm" disabled={pending || !draft.label.trim()} onClick={add}>
            <Plus /> Add value
          </Button>
          {addError ? <p className="text-destructive w-full text-xs">{addError}</p> : null}
        </div>
      ) : null}

      {values.length === 0 ? (
        <EmptyState compact title="No values yet" description="Add the options shoppers can pick from; products and variants reference these rows." />
      ) : (
        <DataTable>
          <DataTableHead>
            <Th width="1%" />
            <Th>Label</Th>
            <Th>Value</Th>
            {isColor ? <Th>Swatch</Th> : null}
            <Th align="right">Products</Th>
            <Th align="right">Variants</Th>
            <Th align="center">Active</Th>
            <Th align="right" />
          </DataTableHead>
          <DataTableBody>
            {values.map((row, index) =>
              editingId === row.id ? (
                <EditRow
                  key={row.id}
                  attributeId={attributeId}
                  row={row}
                  isColor={isColor}
                  onDone={() => setEditingId(null)}
                />
              ) : (
                <Tr key={row.id} className={cn(!row.isActive && "opacity-60")}>
                  <Td>
                    {canManage ? (
                      <span className="inline-flex items-center">
                        <Button variant="ghost" size="icon-xs" disabled={pending || index === 0} onClick={() => move(row, -1)} aria-label="Move up">
                          <ArrowUp />
                        </Button>
                        <Button variant="ghost" size="icon-xs" disabled={pending || index === values.length - 1} onClick={() => move(row, 1)} aria-label="Move down">
                          <ArrowDown />
                        </Button>
                      </span>
                    ) : null}
                  </Td>
                  <Td className="font-medium">{row.label ?? row.value}</Td>
                  <Td className="text-muted-foreground font-mono">{row.value}</Td>
                  {isColor ? (
                    <Td>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="size-4 rounded-full border" style={{ backgroundColor: row.colorHex ?? "transparent" }} aria-hidden />
                        <span className="text-muted-foreground font-mono text-[11px]">{row.colorHex ?? "—"}</span>
                      </span>
                    </Td>
                  ) : null}
                  <Td align="right" numeric>
                    {row.usage.products}
                  </Td>
                  <Td align="right" numeric>
                    {row.usage.variants}
                  </Td>
                  <Td align="center">
                    <Switch
                      size="sm"
                      checked={row.isActive}
                      disabled={!canManage || pending}
                      onCheckedChange={(value) => run(() => updateAttributeValueAction(attributeId, row.id, { isActive: value }))}
                      aria-label={`${row.isActive ? "Deactivate" : "Activate"} ${row.label ?? row.value}`}
                    />
                  </Td>
                  <Td align="right">
                    {canManage ? (
                      <span className="inline-flex items-center">
                        <Button variant="ghost" size="icon-xs" disabled={pending} onClick={() => setEditingId(row.id)} aria-label="Edit value">
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          disabled={pending}
                          onClick={() => remove(row)}
                          aria-label="Delete value"
                          title={row.usage.products + row.usage.variants > 0 ? "In use - deactivate instead" : "Delete"}
                        >
                          <Trash2 />
                        </Button>
                      </span>
                    ) : null}
                  </Td>
                </Tr>
              ),
            )}
          </DataTableBody>
        </DataTable>
      )}
      {confirmDialog}
    </div>
  );
}

function EditRow({ attributeId, row, isColor, onDone }: { attributeId: string; row: AttributeValueRow; isColor: boolean; onDone: () => void }) {
  const { pending, run } = useActionToast();
  const [label, setLabel] = React.useState(row.label ?? "");
  const [token, setToken] = React.useState(row.value);
  const [colorHex, setColorHex] = React.useState(row.colorHex ?? "#888888");
  const [error, setError] = React.useState<string | null>(null);

  async function save() {
    setError(null);
    const result = await run(() => updateAttributeValueAction(attributeId, row.id, { label, value: token, colorHex: isColor ? colorHex : row.colorHex }), {
      onSuccess: onDone,
    });
    if (!result.ok) setError(result.fieldErrors ? Object.values(result.fieldErrors)[0] ?? result.error : result.error);
  }

  return (
    <Tr className="bg-muted/30">
      <Td />
      <Td>
        <Input value={label} onChange={(event) => setLabel(event.target.value)} disabled={pending} className="h-7" aria-label="Label" />
      </Td>
      <Td>
        <Input value={token} onChange={(event) => setToken(event.target.value)} disabled={pending} className="h-7 font-mono" aria-label="Value token" />
        {error ? <p className="text-destructive mt-1 text-[11px]">{error}</p> : null}
      </Td>
      {isColor ? (
        <Td>
          <input type="color" value={colorHex} onChange={(event) => setColorHex(event.target.value)} disabled={pending} className="border-input h-7 w-10 rounded-md border bg-transparent p-0.5" aria-label="Swatch colour" />
        </Td>
      ) : null}
      <Td align="right" numeric>
        {row.usage.products}
      </Td>
      <Td align="right" numeric>
        {row.usage.variants}
      </Td>
      <Td align="center">
        <span className="text-muted-foreground text-[11px]">{row.isActive ? "Active" : "Inactive"}</span>
      </Td>
      <Td align="right">
        <span className="inline-flex items-center">
          <Button variant="ghost" size="icon-xs" disabled={pending || !label.trim()} onClick={save} aria-label="Save value">
            {pending ? <Loader2 className="animate-spin" /> : <Check />}
          </Button>
          <Button variant="ghost" size="icon-xs" disabled={pending} onClick={onDone} aria-label="Cancel">
            <X />
          </Button>
        </span>
      </Td>
    </Tr>
  );
}
