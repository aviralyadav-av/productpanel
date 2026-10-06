"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronRight, X } from "lucide-react";
import { cn } from "cn";

import {
  activeNavItem,
  findNavItem,
  splitHref,
  visibleNavGroups,
  type NavBadge,
  type NavBadgeCounts,
  type NavGroup,
  type NavItem,
} from "@/config/nav";
import { CountBadge } from "@/components/shared/count-badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The permission-aware sidebar (blueprint §2).
 *
 * The registry is filtered on the CLIENT from the actor's permission list
 * rather than passed down pre-filtered, because nav items carry icon
 * components which cannot cross the server/client boundary as props. The
 * list of codes is small and already public to the operator (it decides what
 * they see), so nothing is leaked by sending it.
 *
 * Forty destinations in twelve groups do not fit a laptop screen when every
 * group is open (the list measured 1600px against a 665px viewport), so the
 * sidebar keeps its height in check three ways:
 *
 *  1. Groups behave as an accordion - one open at a time, and the group that
 *     owns the current page is always the open one. Standalone entries
 *     (Dashboard, Customers, Reports ...) never collapse.
 *  2. Query-string variants of a page ("Pending" is /admin/orders?status=…)
 *     nest under their plain sibling as sub-items, expanded only while that
 *     branch is active. The registry is untouched; the nesting is derived
 *     here from `splitHref`, so breadcrumbs and ⌘K keep working as before.
 *  3. In icon-collapsed mode each group becomes ONE rail icon with a flyout
 *     menu, instead of forty stacked icons with the bottom half unreachable.
 *
 * What still overflows scrolls, with edge shadows and a hover-revealed
 * scrollbar (see `.sidebar-scroll` in globals.css) so "more below" is visible
 * rather than silently cut off.
 */

const BADGE_TONE: Record<NavBadge, "warning" | "info" | "danger" | "brand" | "neutral"> = {
  pendingOrders: "info",
  pendingSellers: "warning",
  pendingReviews: "warning",
  newInquiries: "info",
  unreadNotifications: "brand",
  lowStock: "warning",
  openReturns: "warning",
};

/** A plain item plus the query-string variants that hang off its path. */
type NavNode = { item: NavItem; children: NavItem[] };

/**
 * Group items whose href only differs by query string under the plain item
 * that shares their path. Order is preserved: parents in registry order,
 * children in registry order. A variant with no plain sibling in the same
 * group (System › "Email outbox") stays a top-level entry.
 */
function nestByPath(items: readonly NavItem[]): NavNode[] {
  const nodes: NavNode[] = [];
  const plainByPath = new Map<string, NavNode>();
  for (const item of items) {
    const { path, query } = splitHref(item.href);
    if (query.size > 0) continue;
    const node = { item, children: [] };
    plainByPath.set(path, node);
    nodes.push(node);
  }
  for (const item of items) {
    const { path, query } = splitHref(item.href);
    if (query.size === 0) continue;
    const parent = plainByPath.get(path);
    if (parent) parent.children.push(item);
    else nodes.push({ item, children: [] });
  }
  return nodes;
}

function badgeCount(item: NavItem, counts: NavBadgeCounts): number {
  return item.badge ? counts[item.badge] ?? 0 : 0;
}

function groupBadgeTotal(group: NavGroup, counts: NavBadgeCounts): number {
  return group.items.reduce((sum, item) => sum + badgeCount(item, counts), 0);
}

/**
 * Rendered by the shell while the client sidebar is suspended, so the content
 * column keeps its offset instead of jumping to full width and back.
 */
export function AppSidebarFallback() {
  return <div aria-hidden className="bg-sidebar hidden w-(--sidebar-width) shrink-0 border-r md:block" />;
}

export function AppSidebar({
  permissions,
  isSuperAdmin,
  counts,
  storeName,
  roleName,
}: {
  permissions: readonly string[];
  isSuperAdmin: boolean;
  counts: NavBadgeCounts;
  storeName: string;
  roleName: string | null;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { state, isMobile, setOpenMobile } = useSidebar();
  // The mobile sheet always shows the full layout, whatever the desktop
  // cookie says.
  const iconMode = !isMobile && state === "collapsed";

  const groups = React.useMemo(
    () => visibleNavGroups(permissions, isSuperAdmin),
    [permissions, isSuperAdmin],
  );
  const visibleItems = React.useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const active = activeNavItem(pathname, searchParams, visibleItems);
  const owningItem = findNavItem(pathname);
  const activeGroupTitle =
    groups.find((group) => group.items.some((item) => item === active || item === owningItem))
      ?.title ?? null;

  // Accordion: exactly one collapsible group is open. Navigating re-opens the
  // group that owns the new page; clicking a header opens that one instead
  // (or closes it when it is already open). Both sides of the comparison are
  // normalised to null so the render-phase adjustment settles.
  const [openTitle, setOpenTitle] = React.useState<string | null>(activeGroupTitle);
  const [seenActiveTitle, setSeenActiveTitle] = React.useState<string | null>(activeGroupTitle);
  if (activeGroupTitle !== seenActiveTitle) {
    setSeenActiveTitle(activeGroupTitle);
    setOpenTitle(activeGroupTitle);
  }

  // Tapping a destination on a phone should show the destination, not leave
  // the sheet covering it.
  const closeIfMobile = React.useCallback(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);

  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarHeader className="border-b">
        <div className="flex items-center gap-1">
          <Link
            href="/admin/dashboard"
            onClick={closeIfMobile}
            className="focus-visible:ring-ring flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1.5 outline-none focus-visible:ring-2"
          >
            <div className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold">
              {storeName.trim().charAt(0).toUpperCase() || "D"}
            </div>
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <p className="truncate text-sm leading-tight font-semibold">{storeName}</p>
              <p className="text-muted-foreground truncate text-[11px] leading-tight">
                {roleName ?? "Admin panel"}
              </p>
            </div>
          </Link>
          {isMobile ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Close menu"
              onClick={() => setOpenMobile(false)}
            >
              <X />
            </Button>
          ) : null}
        </div>
      </SidebarHeader>

      <SidebarContent className={cn("sidebar-scroll", iconMode && "items-center")}>
        {groups.map((group, index) => {
          const isActiveGroup = group.title === activeGroupTitle;
          if (iconMode) {
            return (
              <React.Fragment key={group.title}>
                {index > 0 && !group.standalone ? <SidebarSeparator className="my-1" /> : null}
                <RailGroup group={group} active={active} counts={counts} isActiveGroup={isActiveGroup} />
              </React.Fragment>
            );
          }
          return (
            <NavGroupSection
              key={group.title}
              group={group}
              active={active}
              counts={counts}
              open={group.standalone || group.title === openTitle}
              onOpenChange={(open) => setOpenTitle(open ? group.title : null)}
              onNavigate={closeIfMobile}
            />
          );
        })}
      </SidebarContent>

      {!isMobile ? (
        <SidebarFooter className="border-t">
          <p className="text-muted-foreground px-2 py-1 text-[11px] leading-relaxed group-data-[collapsible=icon]:hidden">
            <kbd className="bg-muted rounded border px-1 font-mono text-[10px]">⌘K</kbd> search ·{" "}
            <kbd className="bg-muted rounded border px-1 font-mono text-[10px]">⌘B</kbd> menu
          </p>
        </SidebarFooter>
      ) : null}

      <SidebarRail />
    </Sidebar>
  );
}

// ---------------------------------------------------------------------------
// Expanded layout
// ---------------------------------------------------------------------------

function NavGroupSection({
  group,
  active,
  counts,
  open,
  onOpenChange,
  onNavigate,
}: {
  group: NavGroup;
  active: NavItem | undefined;
  counts: NavBadgeCounts;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: () => void;
}) {
  const nodes = React.useMemo(() => nestByPath(group.items), [group.items]);
  const menu = (
    <SidebarMenu>
      {nodes.map((node) => (
        <NavMenuNode key={node.item.href} node={node} active={active} counts={counts} onNavigate={onNavigate} />
      ))}
    </SidebarMenu>
  );

  if (group.standalone) {
    // Consecutive standalone entries read as one flat list, so they get the
    // menu's own spacing rather than a full group's padding each.
    return (
      <SidebarGroup className="py-0.5 first:pt-2 last:pb-2">
        <SidebarGroupContent>{menu}</SidebarGroupContent>
      </SidebarGroup>
    );
  }

  // Sum of the group's badges surfaces on a collapsed header so a closed
  // group never hides a queue that needs attention.
  const hiddenCount = open ? 0 : groupBadgeTotal(group, counts);

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="group/collapsible">
      <SidebarGroup className="py-1">
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger className="hover:bg-sidebar-accent hover:text-sidebar-foreground flex w-full items-center gap-1 pr-1.5">
            <span className="flex-1 text-left">{group.title}</span>
            {hiddenCount > 0 ? <CountBadge count={hiddenCount} tone="neutral" /> : null}
            <ChevronRight className="size-3.5 transition-transform group-data-[state=open]/collapsible:rotate-90" />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarGroupContent>{menu}</SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

function NavMenuNode({
  node,
  active,
  counts,
  onNavigate,
}: {
  node: NavNode;
  active: NavItem | undefined;
  counts: NavBadgeCounts;
  onNavigate: () => void;
}) {
  const { item, children } = node;
  const isActive = item === active;
  const branchActive = isActive || children.some((child) => child === active);

  // Children unfold whenever the branch is active; the chevron lets the
  // operator peek at another branch without leaving the page.
  const [peek, setPeek] = React.useState(false);
  const [seenBranchActive, setSeenBranchActive] = React.useState(branchActive);
  if (branchActive !== seenBranchActive) {
    setSeenBranchActive(branchActive);
    setPeek(false);
  }
  const expanded = branchActive || peek;

  const ownCount = badgeCount(item, counts);
  // A folded branch shows what its children are hiding.
  const foldedCount = expanded ? 0 : children.reduce((sum, child) => sum + badgeCount(child, counts), 0);
  const shown = ownCount || foldedCount;
  const tone = ownCount && item.badge ? BADGE_TONE[item.badge] : "neutral";

  return (
    <SidebarMenuItem>
      {isActive ? <ActiveBar /> : null}
      <SidebarMenuButton
        asChild
        isActive={isActive}
        tooltip={item.title}
        className="data-active:bg-brand-muted data-active:text-foreground"
      >
        <Link href={item.href} aria-current={isActive ? "page" : undefined} onClick={onNavigate}>
          <item.icon />
          <span className="truncate">{item.title}</span>
          {shown > 0 ? (
            <CountBadge
              count={shown}
              tone={tone}
              label={`${shown} ${item.title.toLowerCase()}`}
              className="ml-auto"
            />
          ) : null}
        </Link>
      </SidebarMenuButton>

      {children.length > 0 ? (
        <>
          <SidebarMenuAction
            aria-label={expanded ? `Hide ${item.title} views` : `Show ${item.title} views`}
            aria-expanded={expanded}
            disabled={branchActive}
            onClick={() => setPeek((value) => !value)}
            className={cn("disabled:opacity-100", branchActive && "cursor-default")}
          >
            <ChevronRight className={cn("size-3.5 transition-transform", expanded && "rotate-90")} />
          </SidebarMenuAction>
          {expanded ? (
            <SidebarMenuSub>
              {children.map((child) => {
                const childActive = child === active;
                const count = badgeCount(child, counts);
                return (
                  <SidebarMenuSubItem key={child.href}>
                    <SidebarMenuSubButton
                      asChild
                      isActive={childActive}
                      className="data-active:bg-brand-muted data-active:text-foreground"
                    >
                      <Link href={child.href} aria-current={childActive ? "page" : undefined} onClick={onNavigate}>
                        <span className="truncate">{child.title}</span>
                        {count > 0 && child.badge ? (
                          <CountBadge
                            count={count}
                            tone={BADGE_TONE[child.badge]}
                            label={`${count} ${child.title.toLowerCase()}`}
                            className="ml-auto"
                          />
                        ) : null}
                      </Link>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                );
              })}
            </SidebarMenuSub>
          ) : null}
        </>
      ) : null}
    </SidebarMenuItem>
  );
}

/** The thin brand mark on the left edge of the active entry. */
function ActiveBar() {
  return <span aria-hidden className="bg-brand absolute top-2 bottom-2 -left-2 w-0.5 rounded-full" />;
}

// ---------------------------------------------------------------------------
// Icon-collapsed rail
// ---------------------------------------------------------------------------

function RailGroup({
  group,
  active,
  counts,
  isActiveGroup,
}: {
  group: NavGroup;
  active: NavItem | undefined;
  counts: NavBadgeCounts;
  isActiveGroup: boolean;
}) {
  // Hooks first - the standalone branch returns early below.
  const [open, setOpen] = React.useState(false);

  // A standalone group is a single destination: a plain icon link.
  if (group.standalone) {
    const item = group.items[0]!;
    const count = badgeCount(item, counts);
    const isActive = item === active;
    return (
      <SidebarGroup className="py-0.5 first:pt-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={isActive}
              tooltip={count > 0 ? `${item.title} (${count > 99 ? "99+" : count})` : item.title}
              className="data-active:bg-brand-muted data-active:text-foreground"
            >
              <Link href={item.href} aria-current={isActive ? "page" : undefined}>
                <item.icon />
                <span>{item.title}</span>
              </Link>
            </SidebarMenuButton>
            {count > 0 ? <RailDot /> : null}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
    );
  }

  const total = groupBadgeTotal(group, counts);
  const Icon = group.icon ?? group.items[0]!.icon;

  return (
    <SidebarGroup className="py-0.5">
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu open={open} onOpenChange={setOpen}>
            <Tooltip>
              <DropdownMenuTrigger asChild>
                <TooltipTrigger asChild>
                  <SidebarMenuButton
                    isActive={isActiveGroup}
                    aria-label={total > 0 ? `${group.title} (${total})` : group.title}
                    className="data-active:bg-brand-muted data-active:text-foreground"
                  >
                    <Icon />
                    <span>{group.title}</span>
                  </SidebarMenuButton>
                </TooltipTrigger>
              </DropdownMenuTrigger>
              <TooltipContent side="right" align="center" hidden={open}>
                {group.title}
                {total > 0 ? ` (${total > 99 ? "99+" : total})` : ""}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent side="right" align="start" sideOffset={10} className="min-w-52">
              <DropdownMenuLabel className="text-muted-foreground text-xs font-medium">
                {group.title}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {group.items.map((item) => {
                const count = badgeCount(item, counts);
                const isActive = item === active;
                const { query } = splitHref(item.href);
                return (
                  <DropdownMenuItem key={item.href} asChild className={cn(isActive && "bg-brand-muted", query.size > 0 && "pl-8")}>
                    <Link href={item.href} aria-current={isActive ? "page" : undefined}>
                      {query.size === 0 ? <item.icon /> : null}
                      <span className="truncate">{item.title}</span>
                      {count > 0 && item.badge ? (
                        <CountBadge count={count} tone={BADGE_TONE[item.badge]} className="ml-auto" />
                      ) : null}
                    </Link>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          {total > 0 ? <RailDot /> : null}
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}

/** In the rail there is no room for a pill; a dot still says "something is waiting". */
function RailDot() {
  return <span aria-hidden className="bg-warning ring-sidebar absolute top-1.5 right-1.5 size-1.5 rounded-full ring-2" />;
}
