"use client";

import * as React from "react";

import { SearchableSelect, type ComboboxOption } from "@/components/shared/combobox";

import { buildParentOptions, type TreeSortable } from "../tree-helpers";

/**
 * A single-category picker that shows the tree as indented options, for
 * every module that points at a category (parent picker here, product
 * category, coupon scope, navigation link target).
 *
 * Pass `categories` when the page already has them; otherwise the component
 * fetches the flat list from `GET /api/admin/categories` once on mount. The
 * fetch path means a coupon form does not have to thread the whole tree
 * through its Server Component just to render one select.
 *
 * `excludeId` removes that category AND its descendants (a category cannot be
 * moved under itself); `allowNone` adds an explicit "none" option that
 * reports `null`.
 *
 * @example
 *   <CategoryTreeSelect value={parentId} onChange={setParentId} excludeId={category.id} allowNone noneLabel="No parent (top level)" />
 */
export type CategoryTreeSelectItem = TreeSortable & { slug?: string; isActive?: boolean; depth?: number };

export type CategoryTreeSelectProps = {
  value: string | null;
  onChange: (value: string | null) => void;
  excludeId?: string | null;
  allowNone?: boolean;
  noneLabel?: string;
  /** Pre-loaded categories; when omitted they are fetched from the admin API. */
  categories?: readonly CategoryTreeSelectItem[];
  /** Listed but not selectable. */
  disabledIds?: readonly string[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  invalid?: boolean;
  className?: string;
};

const NONE = "__none__";

export function CategoryTreeSelect({
  value,
  onChange,
  excludeId,
  allowNone = false,
  noneLabel = "None",
  categories,
  disabledIds,
  placeholder = "Choose a category",
  disabled,
  id,
  name,
  invalid,
  className,
}: CategoryTreeSelectProps) {
  const [fetched, setFetched] = React.useState<CategoryTreeSelectItem[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const needsFetch = categories === undefined;

  React.useEffect(() => {
    if (!needsFetch) return;
    const controller = new AbortController();
    fetch("/api/admin/categories", { signal: controller.signal, credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as { data: CategoryTreeSelectItem[] };
        setFetched(body.data);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : "Could not load categories.");
      });
    return () => controller.abort();
  }, [needsFetch]);

  const options = React.useMemo<ComboboxOption[]>(() => {
    const source = categories ?? fetched ?? [];
    const tree = buildParentOptions(source, { excludeId, disabledIds }).map((option) => ({
      value: option.value,
      label: option.label,
      description: option.node.slug ? `/${option.node.slug}${option.node.isActive === false ? " · inactive" : ""}` : undefined,
      disabled: option.disabled,
    }));
    return allowNone ? [{ value: NONE, label: noneLabel }, ...tree] : tree;
  }, [categories, fetched, excludeId, disabledIds, allowNone, noneLabel]);

  const loading = needsFetch && fetched === null && !loadError;

  return (
    <SearchableSelect
      id={id}
      name={name}
      options={options}
      value={value ?? (allowNone ? NONE : null)}
      onChange={(next) => onChange(next === NONE ? null : next)}
      placeholder={loading ? "Loading categories…" : loadError ? "Categories unavailable" : placeholder}
      searchPlaceholder="Search categories"
      emptyText={loadError ?? "No categories match."}
      allowClear={!allowNone}
      disabled={disabled || loading}
      invalid={invalid}
      className={className}
    />
  );
}
