"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { ArrowDown, ArrowUp, Ban, Layers, Plus, RotateCcw, Trash2 } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SearchableSelect } from "@/components/shared/combobox";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";
import { ATTRIBUTE_INPUT_TYPE_META, VARIANT_AXIS_INPUT_TYPES, type AttributeInputType } from "@/lib/enums";

import {
  addCategoryAttributeAction,
  excludeCategoryAttributeAction,
  includeCategoryAttributeAction,
  removeOwnCategoryAttributeAction,
  reorderOwnCategoryAttributesAction,
  setCategoryAttributeFlagAction,
} from "../actions";
import type { CategoryAttributesTab as TabData, EffectiveAttributeRow } from "../queries";
import type { CategoryAttributeFlag } from "../schemas";

/**
 * The Attributes tab (blueprint A1/A2): the EFFECTIVE set - globals, rows
 * inherited from ancestors and this category's own rows - with a Source
 * column. Toggling a flag on an inherited or global row creates an override
 * row on first change (the service copies the current flags), so an operator
 * can think in terms of "what applies here" and never manage rows by hand.
 */
type VisibleFlag = Extract<CategoryAttributeFlag, "isFilterable" | "isRequired" | "isVariant" | "showInSpecs">;

const FLAGS: Array<{ key: VisibleFlag; label: string; hint: string }> = [
  { key: "isFilterable", label: "Filter", hint: "Appears in the storefront filter sidebar." },
  { key: "isRequired", label: "Required", hint: "Products cannot be published without a value." },
  { key: "isVariant", label: "Variant", hint: "Defines variant axes (single-select and colour only)." },
  { key: "showInSpecs", label: "Specs", hint: "Listed in the product's specification table." },
];

export function CategoryAttributesTab({
  categoryId,
  data,
  canManage,
}: {
  categoryId: string;
  data: TabData;
  canManage: boolean;
}) {
  const { pending, run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();
  const [adding, setAdding] = React.useState<string | null>(null);

  const ownRows = data.effective.filter((row) => row.source === "own").sort((a, b) => a.position - b.position);
  const sorted = [...data.effective].sort((a, b) => a.position - b.position || a.attribute.name.localeCompare(b.attribute.name));

  function flag(row: EffectiveAttributeRow, key: VisibleFlag, value: boolean) {
    return run(() => setCategoryAttributeFlagAction({ categoryId, attributeId: row.attribute.id, flag: key, value }));
  }

  async function exclude(row: EffectiveAttributeRow) {
    const usage = row.usage.products + row.usage.variants;
    const ok = await confirm({
      title: `Exclude "${row.attribute.name}"?`,
      description:
        usage > 0
          ? `${row.usage.products} product(s) and ${row.usage.variants} variant(s) under this category carry a value for it. Values are kept; the filter and the spec row disappear for this category and its sub-categories.`
          : "It stops applying to this category and everything below it. You can include it again later.",
      confirmLabel: "Exclude",
      destructive: usage > 0,
    });
    if (!ok.ok) return;
    await run(() => excludeCategoryAttributeAction({ categoryId, attributeId: row.attribute.id }));
  }

  async function removeOwn(row: EffectiveAttributeRow) {
    const ok = await confirm({
      title: `Remove own assignment of "${row.attribute.name}"?`,
      description: `${row.usage.products} product(s) and ${row.usage.variants} variant(s) under this category have values for it. Values stay on the products (§11.3) but the filter is hidden unless an ancestor or the global set still supplies the attribute.`,
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok.ok) return;
    await run(() => removeOwnCategoryAttributeAction({ categoryId, attributeId: row.attribute.id }));
  }

  function moveOwn(row: EffectiveAttributeRow, direction: -1 | 1) {
    const ids = ownRows.map((entry) => entry.attribute.id);
    const index = ids.indexOf(row.attribute.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    return run(() => reorderOwnCategoryAttributesAction({ categoryId, attributeIds: ids }), { silent: true });
  }

  async function add() {
    if (!adding) return;
    await run(() => addCategoryAttributeAction({ categoryId, attributeId: adding }), { onSuccess: () => setAdding(null) });
  }

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-full max-w-sm">
            <SearchableSelect
              options={data.available.map((attribute) => ({
                value: attribute.id,
                label: attribute.name,
                description: `${attribute.code} · ${ATTRIBUTE_INPUT_TYPE_META[attribute.inputType as AttributeInputType]?.label ?? attribute.inputType}${attribute.isGlobal ? " · global (inactive?)" : ""}`,
              }))}
              value={adding}
              onChange={setAdding}
              placeholder={data.available.length === 0 ? "Every attribute already applies" : "Add an attribute to this category"}
              disabled={pending || data.available.length === 0}
            />
          </div>
          <Button type="button" size="sm" disabled={!adding || pending} onClick={add}>
            <Plus /> Add attribute
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href={"/admin/attributes" as Route}>Manage attributes</Link>
          </Button>
        </div>
      ) : null}

      {sorted.length === 0 ? (
        <EmptyState
          compact
          icon={Layers}
          title="No attributes apply here"
          description="Add one above, mark an attribute as global on the Attributes page, or assign it to a parent category with inheritance on."
        />
      ) : (
        <DataTable>
          <DataTableHead>
            <Th>Attribute</Th>
            <Th>Source</Th>
            {FLAGS.map((entry) => (
              <Th key={entry.key} align="center">
                <span title={entry.hint}>{entry.label}</span>
              </Th>
            ))}
            <Th align="right">Position</Th>
            <Th align="right">Values on products</Th>
            <Th align="right">Actions</Th>
          </DataTableHead>
          <DataTableBody>
            {sorted.map((row) => {
              const inputType = row.attribute.inputType as AttributeInputType;
              const canVariant = (VARIANT_AXIS_INPUT_TYPES as readonly string[]).includes(inputType);
              const ownIndex = ownRows.findIndex((entry) => entry.attribute.id === row.attribute.id);
              return (
                <Tr key={row.attribute.id} className={cn(!row.attribute.isActive && "opacity-60")}>
                  <Td>
                    <div className="flex flex-col">
                      <Link href={`/admin/attributes/${row.attribute.id}` as Route} className="font-medium hover:underline">
                        {row.attribute.name}
                      </Link>
                      <span className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
                        <span className="font-mono">{row.attribute.code}</span>
                        <span>·</span>
                        <span>{ATTRIBUTE_INPUT_TYPE_META[inputType]?.label ?? inputType}</span>
                        {row.values.length > 0 ? (
                          <>
                            <span>·</span>
                            <span data-numeric>{row.values.length} values</span>
                          </>
                        ) : null}
                        {!row.attribute.isActive ? <StatusPill label="Inactive" tone="warning" dot={false} /> : null}
                      </span>
                    </div>
                  </Td>
                  <Td>
                    <SourceCell row={row} />
                  </Td>
                  {FLAGS.map((entry) => {
                    const disabled = !canManage || pending || (entry.key === "isVariant" && !canVariant);
                    return (
                      <Td key={entry.key} align="center">
                        <Switch
                          size="sm"
                          checked={row[entry.key]}
                          disabled={disabled}
                          onCheckedChange={(value) => flag(row, entry.key, value)}
                          aria-label={`${entry.label} for ${row.attribute.name}`}
                          title={entry.key === "isVariant" && !canVariant ? "Only single-select and colour attributes can define variants" : undefined}
                        />
                      </Td>
                    );
                  })}
                  <Td align="right" numeric>
                    {row.source === "own" && canManage ? (
                      <span className="inline-flex items-center gap-0.5">
                        <Button variant="ghost" size="icon-xs" disabled={pending || ownIndex <= 0} onClick={() => moveOwn(row, -1)} aria-label="Move up">
                          <ArrowUp />
                        </Button>
                        <span className="w-5 text-center">{row.position}</span>
                        <Button variant="ghost" size="icon-xs" disabled={pending || ownIndex >= ownRows.length - 1} onClick={() => moveOwn(row, 1)} aria-label="Move down">
                          <ArrowDown />
                        </Button>
                      </span>
                    ) : (
                      row.position
                    )}
                  </Td>
                  <Td align="right" numeric>
                    <span title={`${row.usage.products} products, ${row.usage.variants} variants`}>
                      {row.usage.products}
                      {row.usage.variants > 0 ? <span className="text-muted-foreground"> / {row.usage.variants}v</span> : null}
                    </span>
                  </Td>
                  <Td align="right">
                    {canManage ? (
                      <span className="inline-flex items-center gap-0.5">
                        <Button variant="ghost" size="xs" disabled={pending} onClick={() => exclude(row)} title="Exclude from this category and its sub-categories">
                          <Ban /> Exclude
                        </Button>
                        {row.source === "own" ? (
                          <Button variant="ghost" size="icon-xs" disabled={pending} onClick={() => removeOwn(row)} aria-label="Remove own assignment" title="Remove own assignment (values are kept)">
                            <Trash2 />
                          </Button>
                        ) : null}
                      </span>
                    ) : null}
                  </Td>
                </Tr>
              );
            })}
          </DataTableBody>
        </DataTable>
      )}

      {data.excluded.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">Excluded here</h3>
          <ul className="divide-y rounded-md border text-xs">
            {data.excluded.map((row) => (
              <li key={row.attributeId} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">{row.name}</span>
                  <span className="text-muted-foreground font-mono text-[11px]">{row.code}</span>
                </span>
                {canManage ? (
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={pending}
                    onClick={() => run(() => includeCategoryAttributeAction({ categoryId, attributeId: row.attributeId }))}
                  >
                    <RotateCcw /> Include
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {confirmDialog}
    </div>
  );
}

function SourceCell({ row }: { row: EffectiveAttributeRow }) {
  if (row.source === "own") return <StatusPill label="Own" tone="brand" dot={false} />;
  if (row.source === "global") return <StatusPill label="Global" tone="neutral" dot={false} />;
  return (
    <span className="flex items-center gap-1.5">
      <StatusPill label="Inherited" tone="info" dot={false} />
      {row.sourceCategoryId ? (
        <Link href={`/admin/categories/${row.sourceCategoryId}?tab=attributes` as Route} className="text-muted-foreground truncate text-[11px] hover:underline">
          from {row.sourceCategoryName ?? "parent"}
        </Link>
      ) : null}
    </span>
  );
}
