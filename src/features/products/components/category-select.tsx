"use client";

import * as React from "react";

import { SearchableSelect, type ComboboxOption } from "@/components/shared/combobox";

import type { CategoryOption } from "@/features/products/queries";

/**
 * The category picker every product screen uses: the full tree as one
 * searchable list, indented by depth so "Cushions" is visibly under "Home &
 * Living". Typing matches the leaf name or any ancestor because the option
 * label carries the whole path; the indent is a purely visual prefix.
 */
export function categoryOptions(categories: readonly CategoryOption[], options: { includeNone?: boolean } = {}): ComboboxOption[] {
  const list: ComboboxOption[] = categories.map((category) => ({
    value: category.id,
    label: `${"— ".repeat(category.depth)}${category.name}`,
    description: category.depth > 0 ? category.namePath : undefined,
    disabled: !category.isActive ? false : undefined,
  }));
  if (options.includeNone) list.unshift({ value: "none", label: "Uncategorised", description: "Products with no category" });
  return list;
}

export function CategorySelect({
  categories,
  value,
  onChange,
  placeholder = "Any category",
  allowClear = true,
  includeNone = false,
  disabled,
  invalid,
  id,
  className,
}: {
  categories: readonly CategoryOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  allowClear?: boolean;
  includeNone?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  className?: string;
}) {
  const options = React.useMemo(() => categoryOptions(categories, { includeNone }), [categories, includeNone]);
  return (
    <SearchableSelect
      id={id}
      options={options}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      searchPlaceholder="Search categories"
      allowClear={allowClear}
      disabled={disabled}
      invalid={invalid}
      className={className}
    />
  );
}
