"use client";

import * as React from "react";
import { AlertCircle, ChevronsUpDown, Loader2, X } from "lucide-react";
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
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ProductThumb } from "./product-thumb";

export type EntityKind =
  | "product"
  | "category"
  | "seller"
  | "customer"
  | "page"
  | "blog"
  | "coupon";

/**
 * One hit from the global search endpoint.
 *
 * CONTRACT with the search owner (blueprint §5.2, `GET /api/admin/search`):
 *
 *   GET /api/admin/search?q=<text>&scopes=<kind>[,<kind>]&limit=<n>
 *   200 { data: { results: SearchHit[] } }
 *
 *   SearchHit = { scope: string; id: string; title: string;
 *                 subtitle?: string; imageUrl?: string | null; href: string }
 *
 * `scope` echoes the kind ("product", "category", ...). `subtitle` is the
 * one-line disambiguator (SKU, email, parent category). Results the actor
 * lacks `<scope>.view` for are filtered server-side (D14); this component
 * shows whatever comes back. Errors use the standard `{ error: { message } }`
 * envelope and are surfaced inline, not thrown.
 */
export type SearchHit = {
  scope: string;
  id: string;
  title: string;
  subtitle?: string;
  imageUrl?: string | null;
  href: string;
};

/** What the picker holds for a selected item; enough to render a chip. */
export type EntityRef = Pick<SearchHit, "id" | "title" | "subtitle" | "imageUrl">;

const KIND_LABEL: Record<EntityKind, string> = {
  product: "product",
  category: "category",
  seller: "seller",
  customer: "customer",
  page: "page",
  blog: "blog post",
  coupon: "coupon",
};

type Props =
  | {
      kind: EntityKind;
      multiple?: false;
      value: EntityRef | null;
      onChange: (value: EntityRef | null) => void;
      placeholder?: string;
      disabled?: boolean;
      /** Ids to hide from results (e.g. the record being edited). */
      excludeIds?: string[];
      limit?: number;
      className?: string;
      id?: string;
      invalid?: boolean;
    }
  | {
      kind: EntityKind;
      multiple: true;
      value: EntityRef[];
      onChange: (value: EntityRef[]) => void;
      placeholder?: string;
      disabled?: boolean;
      excludeIds?: string[];
      limit?: number;
      className?: string;
      id?: string;
      invalid?: boolean;
    };

/**
 * An async combobox over the admin search endpoint. Used wherever a form
 * references another record: related products, a coupon's categories, a
 * banner's target page, a manual order's customer.
 *
 * The value is an EntityRef (id + display fields), not a bare id, so the
 * form can render the chip on first paint without a second fetch. Persist
 * only the id.
 *
 * @example
 *   <EntityPicker kind="product" multiple value={related} onChange={setRelated} placeholder="Add related products" />
 */
export function EntityPicker(props: Props) {
  const {
    kind,
    placeholder,
    disabled,
    excludeIds = [],
    limit = 10,
    className,
    id,
    invalid,
  } = props;
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const debounced = useDebouncedValue(query, 250);
  const search = useEntitySearch(kind, open ? debounced : "", limit);

  const selected: EntityRef[] = props.multiple
    ? props.value
    : props.value
      ? [props.value]
      : [];
  const selectedIds = new Set(selected.map((item) => item.id));
  const hidden = new Set(excludeIds);
  const results = search.results.filter((hit) => !hidden.has(hit.id));

  function pick(hit: SearchHit) {
    const ref: EntityRef = {
      id: hit.id,
      title: hit.title,
      subtitle: hit.subtitle,
      imageUrl: hit.imageUrl,
    };
    if (props.multiple) {
      props.onChange(
        selectedIds.has(hit.id)
          ? props.value.filter((item) => item.id !== hit.id)
          : [...props.value, ref],
      );
    } else {
      props.onChange(ref);
      setOpen(false);
    }
  }

  function remove(itemId: string) {
    if (props.multiple) props.onChange(props.value.filter((item) => item.id !== itemId));
    else props.onChange(null);
  }

  const label = placeholder ?? `Search ${KIND_LABEL[kind]}s`;

  return (
    <div className={cn("space-y-1.5", className)}>
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
              (props.multiple || !props.value) && "text-muted-foreground",
            )}
          >
            <span className="truncate text-xs">
              {!props.multiple && props.value ? props.value.title : label}
            </span>
            <ChevronsUpDown className="text-muted-foreground size-3.5 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-64 p-0">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={label}
              value={query}
              onValueChange={setQuery}
              className="text-xs"
            />
            <CommandList>
              {search.status === "error" ? (
                <div className="text-destructive flex items-center gap-2 px-3 py-4 text-xs">
                  <AlertCircle className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1">{search.error}</span>
                  <Button type="button" size="xs" variant="outline" onClick={search.retry}>
                    Retry
                  </Button>
                </div>
              ) : search.status === "loading" ? (
                <div className="text-muted-foreground flex items-center justify-center gap-2 py-4 text-xs">
                  <Loader2 className="size-3.5 animate-spin" />
                  Searching
                </div>
              ) : debounced.trim().length === 0 ? (
                <p className="text-muted-foreground py-4 text-center text-xs">
                  Type to search {KIND_LABEL[kind]}s
                </p>
              ) : (
                <>
                  <CommandEmpty className="text-muted-foreground py-4 text-xs">
                    No {KIND_LABEL[kind]}s match &ldquo;{debounced}&rdquo;.
                  </CommandEmpty>
                  <CommandGroup>
                    {results.map((hit) => (
                      <CommandItem
                        key={hit.id}
                        value={hit.id}
                        data-checked={selectedIds.has(hit.id)}
                        onSelect={() => pick(hit)}
                        className="text-xs"
                      >
                        {hit.imageUrl !== undefined ? (
                          <ProductThumb src={hit.imageUrl} alt="" size={24} />
                        ) : null}
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate">{hit.title}</span>
                          {hit.subtitle ? (
                            <span className="text-muted-foreground truncate text-[11px]">
                              {hit.subtitle}
                            </span>
                          ) : null}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selected.length > 0 ? (
        <ul className="flex flex-wrap gap-1" aria-label={`Selected ${KIND_LABEL[kind]}s`}>
          {selected.map((item) => (
            <li
              key={item.id}
              className="bg-muted inline-flex h-6 max-w-full items-center gap-1.5 rounded-md pr-1 pl-1.5 text-xs"
            >
              {item.imageUrl !== undefined ? (
                <ProductThumb src={item.imageUrl} alt="" size={16} className="rounded-sm" />
              ) : null}
              <span className="truncate">{item.title}</span>
              {!disabled ? (
                <button
                  type="button"
                  aria-label={`Remove ${item.title}`}
                  className="text-muted-foreground hover:text-foreground rounded-sm"
                  onClick={() => remove(item.id)}
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

type SearchState =
  | { status: "idle"; results: SearchHit[] }
  | { status: "loading"; results: SearchHit[] }
  | { status: "ready"; results: SearchHit[] }
  | { status: "error"; results: SearchHit[]; error: string };

function useEntitySearch(kind: EntityKind, query: string, limit: number) {
  const [state, setState] = React.useState<SearchState>({ status: "idle", results: [] });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing results when the query empties
      setState({ status: "idle", results: [] });
      return;
    }

    const controller = new AbortController();
    setState((current) => ({ status: "loading", results: current.results }));

    const params = new URLSearchParams({ q: trimmed, scopes: kind, limit: String(limit) });
    fetch(`/api/admin/search?${params}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as
          | { data?: { results?: SearchHit[] }; error?: { message?: string } }
          | null;
        if (!response.ok) {
          throw new Error(body?.error?.message ?? `Search failed (${response.status})`);
        }
        setState({ status: "ready", results: body?.data?.results ?? [] });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState((current) => ({
          status: "error",
          results: current.results,
          error: error instanceof Error ? error.message : "Search failed",
        }));
      });

    return () => controller.abort();
  }, [kind, query, limit, attempt]);

  return {
    ...state,
    error: state.status === "error" ? state.error : undefined,
    retry: () => setAttempt((n) => n + 1),
  };
}
