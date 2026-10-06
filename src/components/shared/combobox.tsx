"use client";

import * as React from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type ComboboxOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  /** Optional group heading; options with the same group are listed together. */
  group?: string;
};

/**
 * A single-value select with a search box, for lists too long for a native
 * select (categories, sellers, templates) but small enough to ship to the
 * client. For lists that need a server search use EntityPicker instead.
 *
 * Built on cmdk inside a popover, so it has typeahead, arrow keys, Enter and
 * Escape for free. `allowClear` adds an inline x that sets the value to null.
 *
 * @example
 *   <SearchableSelect options={sellers} value={sellerId} onChange={setSellerId} placeholder="Choose a seller" allowClear />
 */
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Select",
  searchPlaceholder = "Search",
  emptyText = "No matches.",
  searchable = true,
  allowClear = false,
  disabled,
  name,
  id,
  invalid,
  className,
  renderOption,
}: {
  options: ComboboxOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  searchable?: boolean;
  allowClear?: boolean;
  disabled?: boolean;
  name?: string;
  id?: string;
  invalid?: boolean;
  className?: string;
  renderOption?: (option: ComboboxOption) => React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find((option) => option.value === value) ?? null;
  const groups = groupOptions(options);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          className={cn(
            "h-8 w-full justify-between px-2.5 font-normal",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate text-xs">{selected?.label ?? placeholder}</span>
          <span className="flex items-center gap-0.5">
            {allowClear && selected && !disabled ? (
              <span
                role="button"
                tabIndex={-1}
                aria-label="Clear"
                className="text-muted-foreground hover:text-foreground rounded-sm"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onChange(null);
                }}
              >
                <X className="size-3.5" />
              </span>
            ) : null}
            <ChevronsUpDown className="text-muted-foreground size-3.5" />
          </span>
        </Button>
      </PopoverTrigger>
      {name ? <input type="hidden" name={name} value={value ?? ""} /> : null}
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-56 p-0"
      >
        <Command>
          {searchable ? <CommandInput placeholder={searchPlaceholder} className="text-xs" /> : null}
          <CommandList>
            <CommandEmpty className="text-muted-foreground py-4 text-xs">{emptyText}</CommandEmpty>
            {groups.map(([group, items]) => (
              <CommandGroup key={group ?? "__ungrouped"} heading={group ?? undefined}>
                {items.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={`${option.label} ${option.description ?? ""}`}
                    disabled={option.disabled}
                    data-checked={option.value === value}
                    onSelect={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    className="text-xs"
                  >
                    {renderOption ? (
                      renderOption(option)
                    ) : (
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{option.label}</span>
                        {option.description ? (
                          <span className="text-muted-foreground truncate text-[11px]">
                            {option.description}
                          </span>
                        ) : null}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Alias for callers that think in shadcn terms. */
export const Combobox = SearchableSelect;

/**
 * Same popover, many values, rendered as chips in the trigger. Selected items
 * stay in the list with a tick so they can be deselected from the same place.
 *
 * @example
 *   <MultiSelect options={tags} value={selected} onChange={setSelected} placeholder="Tags" maxVisibleChips={3} />
 */
export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "Select",
  searchPlaceholder = "Search",
  emptyText = "No matches.",
  maxVisibleChips = 3,
  disabled,
  name,
  id,
  invalid,
  className,
}: {
  options: ComboboxOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  maxVisibleChips?: number;
  disabled?: boolean;
  name?: string;
  id?: string;
  invalid?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const selected = options.filter((option) => value.includes(option.value));
  const overflow = selected.length - maxVisibleChips;
  const groups = groupOptions(options);

  function toggle(optionValue: string) {
    onChange(
      value.includes(optionValue)
        ? value.filter((item) => item !== optionValue)
        : [...value, optionValue],
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          className={cn(
            "h-auto min-h-8 w-full justify-between px-1.5 py-1 font-normal",
            selected.length === 0 && "text-muted-foreground",
            className,
          )}
        >
          <span className="flex min-w-0 flex-wrap items-center gap-1">
            {selected.length === 0 ? (
              <span className="px-1 text-xs">{placeholder}</span>
            ) : (
              <>
                {selected.slice(0, maxVisibleChips).map((option) => (
                  <span
                    key={option.value}
                    className="bg-muted inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-xs"
                  >
                    {option.label}
                    <span
                      role="button"
                      tabIndex={-1}
                      aria-label={`Remove ${option.label}`}
                      className="text-muted-foreground hover:text-foreground"
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        toggle(option.value);
                      }}
                    >
                      <X className="size-3" />
                    </span>
                  </span>
                ))}
                {overflow > 0 ? (
                  <span data-numeric className="text-muted-foreground px-1 text-xs">
                    +{overflow} more
                  </span>
                ) : null}
              </>
            )}
          </span>
          <ChevronsUpDown className="text-muted-foreground size-3.5 shrink-0" />
        </Button>
      </PopoverTrigger>
      {name ? value.map((item) => <input key={item} type="hidden" name={name} value={item} />) : null}
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-56 p-0"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} className="text-xs" />
          <CommandList>
            <CommandEmpty className="text-muted-foreground py-4 text-xs">{emptyText}</CommandEmpty>
            {groups.map(([group, items]) => (
              <CommandGroup key={group ?? "__ungrouped"} heading={group ?? undefined}>
                {items.map((option) => {
                  const checked = value.includes(option.value);
                  return (
                    <CommandItem
                      key={option.value}
                      value={`${option.label} ${option.description ?? ""}`}
                      disabled={option.disabled}
                      onSelect={() => toggle(option.value)}
                      className="text-xs"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "border-input flex size-3.5 items-center justify-center rounded-[3px] border",
                          checked && "bg-primary text-primary-foreground border-primary",
                        )}
                      >
                        {checked ? <Check className="size-2.5" /> : null}
                      </span>
                      <span className="truncate">{option.label}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function groupOptions(options: ComboboxOption[]): Array<[string | undefined, ComboboxOption[]]> {
  const map = new Map<string | undefined, ComboboxOption[]>();
  for (const option of options) {
    const list = map.get(option.group) ?? [];
    list.push(option);
    map.set(option.group, list);
  }
  return [...map.entries()];
}
