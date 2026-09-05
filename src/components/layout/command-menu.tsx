"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

import { ALL_NAV_ITEMS, NAV_GROUPS } from "@/config/nav";
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
 * Phase one of global search: instant, client-side navigation over the known
 * routes. It ships now because it is useful now, and because a one-operator
 * panel benefits more from fast navigation than from fuzzy entity search.
 *
 * Phase two adds a debounced server lookup against
 * GET /api/admin/search?q= for products, orders and customers, rendered as
 * additional groups below these. The shell is deliberately shaped for that.
 */
export function CommandMenu() {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();

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

  const go = React.useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href as never);
    },
    [router],
  );

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-muted-foreground w-full justify-start gap-2 px-2 font-normal sm:w-56 lg:w-72"
      >
        <Search className="size-3.5" />
        <span className="truncate">Search or jump to…</span>
        <kbd className="bg-muted text-muted-foreground pointer-events-none ml-auto hidden h-5 items-center gap-0.5 rounded border px-1.5 font-mono text-[10px] font-medium sm:inline-flex">
          <span className="text-xs">⌘</span>K
        </kbd>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Command menu"
        description="Search pages and run quick actions"
      >
        <CommandInput placeholder="Search pages and actions…" />
        <CommandList>
          <CommandEmpty>Nothing matched that.</CommandEmpty>

          <CommandGroup heading="Quick actions">
            <CommandItem
              value="new product create add"
              onSelect={() => go("/products/new")}
            >
              Create a product
            </CommandItem>
            <CommandItem
              value="orders pending awaiting"
              onSelect={() => go("/orders?status=PLACED")}
            >
              Review orders awaiting confirmation
            </CommandItem>
            <CommandItem
              value="low stock inventory reorder"
              onSelect={() => go("/inventory?stock=LOW_STOCK")}
            >
              See what is low on stock
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />

          {NAV_GROUPS.map((group) => (
            <CommandGroup key={group.title} heading={group.title}>
              {group.items.map((item) => (
                <CommandItem
                  key={item.href}
                  value={`${item.title} ${item.description} ${(item.keywords ?? []).join(" ")}`}
                  onSelect={() => go(item.href)}
                >
                  <item.icon className="size-4" />
                  <span>{item.title}</span>
                  <span className="text-muted-foreground ml-auto truncate text-xs">
                    {item.status === "planned" ? "soon" : ""}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}

export const COMMAND_ROUTE_COUNT = ALL_NAV_ITEMS.length;
