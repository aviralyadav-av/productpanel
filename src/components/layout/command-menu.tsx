"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CornerDownLeft, Loader2, Search } from "lucide-react";

import { searchNavItems, visibleNavGroups, type NavItem } from "@/config/nav";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  SEARCH_SCOPES,
  SEARCH_SCOPE_LABELS,
  type SearchHit,
  type SearchScope,
} from "@/features/search/scopes";
import { ProductThumb } from "@/components/shared/product-thumb";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

/**
 * ⌘K: one box that both navigates and searches.
 *
 * Typing filters the "Jump to" list instantly (client-side, from the
 * registry, already permission-filtered) and, after a 250 ms pause, asks
 * GET /api/admin/search for records. Results are grouped by scope in the
 * server's order; the server has already dropped scopes the actor may not
 * search (D14), so whatever arrives is safe to show.
 *
 * Enter on the first line runs the full search page, so a long result list
 * is one keystroke away. Arrow keys / Enter / Escape come from cmdk.
 */

type SearchState =
  | { status: "idle"; hits: SearchHit[] }
  | { status: "loading"; hits: SearchHit[] }
  | { status: "done"; hits: SearchHit[] }
  | { status: "error"; hits: SearchHit[]; message: string };

export function CommandMenu({
  permissions,
  isSuperAdmin,
}: {
  permissions: readonly string[];
  isSuperAdmin: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const debounced = useDebouncedValue(query.trim(), 250);
  const [search, setSearch] = React.useState<SearchState>({ status: "idle", hits: [] });
  const router = useRouter();

  const navItems = React.useMemo(
    () => visibleNavGroups(permissions, isSuperAdmin).flatMap((group) => group.items),
    [permissions, isSuperAdmin],
  );
  const jumpTo = React.useMemo(() => searchNavItems(query, navItems).slice(0, 8), [query, navItems]);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  React.useEffect(() => {
    if (!open || debounced.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting derived request state when the query clears is the standard fetch-on-change pattern
      setSearch({ status: "idle", hits: [] });
      return;
    }

    const controller = new AbortController();
    setSearch((current) => ({ status: "loading", hits: current.hits }));

    fetch(`/api/admin/search?q=${encodeURIComponent(debounced)}&limit=5`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as
          | { data?: { results?: SearchHit[] }; error?: { message?: string } }
          | null;
        if (!response.ok) {
          throw new Error(body?.error?.message ?? `Search failed (${response.status}).`);
        }
        setSearch({ status: "done", hits: body?.data?.results ?? [] });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSearch({
          status: "error",
          hits: [],
          message: error instanceof Error ? error.message : "Search failed.",
        });
      });

    return () => controller.abort();
  }, [open, debounced]);

  const go = React.useCallback(
    (href: string) => {
      setOpen(false);
      setQuery("");
      router.push(href as never);
    },
    [router],
  );

  const grouped = SEARCH_SCOPES.map((scope) => ({
    scope,
    hits: search.hits.filter((hit) => hit.scope === scope),
  })).filter((group) => group.hits.length > 0);

  const trimmed = query.trim();
  const showEmpty =
    trimmed.length > 0 &&
    jumpTo.length === 0 &&
    grouped.length === 0 &&
    search.status !== "loading";

  return (
    <>
      {/* One trigger for every width: an icon button on a phone, a search
          field from `sm` up, the shortcut hint once there is room for it. */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-muted-foreground justify-start gap-2 px-2 font-normal max-sm:size-7 max-sm:justify-center max-sm:px-0 sm:w-40 md:w-56 lg:w-72"
        aria-label="Open search"
      >
        <Search className="size-3.5 shrink-0" />
        <span className="hidden truncate sm:inline">Search or jump to…</span>
        <kbd className="bg-muted text-muted-foreground pointer-events-none ml-auto hidden h-5 items-center gap-0.5 rounded border px-1.5 font-mono text-[10px] font-medium lg:inline-flex">
          <span className="text-xs">⌘</span>K
        </kbd>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
        title="Search"
        description="Search records or jump to a page"
      >
        <CommandInput
          placeholder="Search orders, products, customers… or a page"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          {showEmpty ? (
            <CommandEmpty>
              {search.status === "error" ? search.message : `Nothing matched “${trimmed}”.`}
            </CommandEmpty>
          ) : null}

          {trimmed.length > 0 ? (
            <CommandGroup heading="Search">
              <CommandItem
                value={`search-all ${trimmed}`}
                onSelect={() => go(`/admin/search?q=${encodeURIComponent(trimmed)}`)}
              >
                {search.status === "loading" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Search className="size-4" />
                )}
                <span className="truncate">
                  Search everything for <span className="font-medium">“{trimmed}”</span>
                </span>
                <CornerDownLeft className="text-muted-foreground ml-auto size-3.5" />
              </CommandItem>
            </CommandGroup>
          ) : null}

          {grouped.map((group) => (
            <CommandGroup key={group.scope} heading={SEARCH_SCOPE_LABELS[group.scope].plural}>
              {group.hits.map((hit) => (
                <CommandItem
                  key={`${hit.scope}-${hit.id}`}
                  value={`${hit.scope} ${hit.id} ${hit.title} ${hit.subtitle ?? ""}`}
                  onSelect={() => go(hit.href)}
                >
                  <HitIcon hit={hit} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{hit.title}</p>
                    {hit.subtitle ? (
                      <p className="text-muted-foreground truncate text-[11px]">{hit.subtitle}</p>
                    ) : null}
                  </div>
                  <ArrowRight className="text-muted-foreground size-3.5" />
                </CommandItem>
              ))}
            </CommandGroup>
          ))}

          {grouped.length > 0 && jumpTo.length > 0 ? <CommandSeparator /> : null}

          {jumpTo.length > 0 ? (
            <CommandGroup heading="Jump to">
              {jumpTo.map((item) => (
                <JumpToItem key={item.href} item={item} onSelect={() => go(item.href)} />
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </CommandDialog>
    </>
  );
}

function JumpToItem({ item, onSelect }: { item: NavItem; onSelect: () => void }) {
  return (
    <CommandItem
      value={`jump ${item.title} ${(item.keywords ?? []).join(" ")}`}
      onSelect={onSelect}
    >
      <item.icon className="size-4" />
      <span className="truncate">{item.title}</span>
      <span className="text-muted-foreground ml-auto truncate font-mono text-[10px]">
        {item.href}
      </span>
    </CommandItem>
  );
}

const SCOPE_INITIAL: Record<SearchScope, string> = {
  product: "P",
  order: "#",
  customer: "C",
  seller: "S",
  category: "K",
  coupon: "%",
  page: "Pg",
  blog: "B",
};

function HitIcon({ hit }: { hit: SearchHit }) {
  if (hit.imageUrl) return <ProductThumb src={hit.imageUrl} alt="" size={24} />;
  return (
    <span className="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded border font-mono text-[10px] font-semibold">
      {SCOPE_INITIAL[hit.scope as SearchScope] ?? "?"}
    </span>
  );
}
