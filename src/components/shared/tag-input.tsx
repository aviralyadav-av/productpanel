"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "cn";

/**
 * A list of short strings as removable chips. Enter or comma adds, Backspace
 * on an empty field removes the last chip, and the optional `suggestions`
 * list offers completions as a plain datalist-style dropdown so the keyboard
 * flow never leaves the input.
 *
 * Values are de-duplicated case-insensitively and trimmed; the parent decides
 * casing rules beyond that. Submit with a hidden input per tag under `name`
 * (formData.getAll(name)), or drive it controlled.
 *
 * @example
 *   <TagInput value={tags} onChange={setTags} suggestions={existingTags} placeholder="Add a tag" />
 */
export function TagInput({
  value,
  onChange,
  suggestions = [],
  placeholder = "Add and press Enter",
  name,
  id,
  disabled,
  maxTags,
  normalize = (tag) => tag.trim(),
  className,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  name?: string;
  id?: string;
  disabled?: boolean;
  maxTags?: number;
  /** Applied to every tag before it is added (e.g. lowercase). */
  normalize?: (tag: string) => string;
  className?: string;
}) {
  const [draft, setDraft] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listId = React.useId();

  const lower = new Set(value.map((tag) => tag.toLowerCase()));
  const matches = draft.trim()
    ? suggestions
        .filter(
          (item) =>
            !lower.has(item.toLowerCase()) &&
            item.toLowerCase().includes(draft.trim().toLowerCase()),
        )
        .slice(0, 8)
    : [];
  const atLimit = maxTags !== undefined && value.length >= maxTags;

  function add(raw: string) {
    const tag = normalize(raw);
    if (!tag || lower.has(tag.toLowerCase()) || atLimit) {
      setDraft("");
      return;
    }
    onChange([...value, tag]);
    setDraft("");
    setActiveIndex(0);
  }

  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      if (open && matches[activeIndex]) add(matches[activeIndex]);
      else add(draft);
    } else if (event.key === "Backspace" && draft === "" && value.length > 0) {
      remove(value.length - 1);
    } else if (event.key === "ArrowDown" && matches.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => (current + 1) % matches.length);
    } else if (event.key === "ArrowUp" && matches.length > 0) {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + matches.length) % matches.length);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className={cn("relative", className)}>
      <div
        className={cn(
          "border-input focus-within:border-ring focus-within:ring-ring/50 flex min-h-8 flex-wrap items-center gap-1 rounded-lg border bg-transparent px-1.5 py-1 transition-colors focus-within:ring-3 dark:bg-input/30",
          disabled && "opacity-50",
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag, index) => (
          <span
            key={tag}
            className="bg-muted text-foreground inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-xs"
          >
            {tag}
            {name ? <input type="hidden" name={name} value={tag} /> : null}
            <button
              type="button"
              disabled={disabled}
              aria-label={`Remove ${tag}`}
              className="text-muted-foreground hover:text-foreground -mr-0.5 rounded-sm"
              onClick={(event) => {
                event.stopPropagation();
                remove(index);
              }}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          value={draft}
          disabled={disabled || atLimit}
          placeholder={value.length === 0 ? placeholder : atLimit ? "" : ""}
          role="combobox"
          aria-expanded={open && matches.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          className="placeholder:text-muted-foreground min-w-24 flex-1 bg-transparent px-1 text-xs outline-none"
          onChange={(event) => {
            setDraft(event.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Commit a half-typed tag on blur; nobody means to lose it.
            setTimeout(() => setOpen(false), 100);
            if (draft.trim()) add(draft);
          }}
        />
      </div>

      {open && matches.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className="bg-popover text-popover-foreground ring-foreground/10 absolute z-30 mt-1 max-h-48 w-full overflow-auto rounded-lg p-1 shadow-md ring-1"
        >
          {matches.map((item, index) => (
            <li
              key={item}
              role="option"
              aria-selected={index === activeIndex}
              className={cn(
                "cursor-default rounded-md px-2 py-1 text-xs",
                index === activeIndex && "bg-accent",
              )}
              onMouseDown={(event) => {
                event.preventDefault();
                add(item);
              }}
              onMouseEnter={() => setActiveIndex(index)}
            >
              {item}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
