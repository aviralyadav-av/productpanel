"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

import { NAV_GROUPS, type NavBadge } from "@/config/nav";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

export type NavCounts = Partial<Record<NavBadge, number>>;

export function AppSidebar({
  counts,
  storeName,
}: {
  counts: NavCounts;
  storeName: string;
}) {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarHeader className="border-b">
        <div className="flex items-center gap-2 px-1 py-1.5">
          <div className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold">
            N
          </div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-semibold leading-tight">
              {storeName}
            </p>
            <p className="text-muted-foreground truncate text-[11px] leading-tight">
              Admin panel
            </p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="scrollbar-thin">
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.title}>
            <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    pathname.startsWith(`${item.href}/`);
                  const count = item.badge ? counts[item.badge] : undefined;

                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        tooltip={item.title}
                      >
                        <Link href={item.href}>
                          <item.icon />
                          <span className="truncate">{item.title}</span>
                          {item.status === "planned" ? (
                            <span
                              aria-label="Not built yet"
                              title="Not built yet"
                              className="text-muted-foreground/60 ml-auto text-[10px] group-data-[collapsible=icon]:hidden"
                            >
                              soon
                            </span>
                          ) : null}
                        </Link>
                      </SidebarMenuButton>

                      {count && count > 0 ? (
                        <SidebarMenuBadge
                          className={cn(
                            item.badge === "lowStock" && "text-warning",
                            item.badge === "pendingOrders" && "text-info",
                          )}
                        >
                          {count > 99 ? "99+" : count}
                        </SidebarMenuBadge>
                      ) : null}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t">
        <p className="text-muted-foreground px-2 py-1 text-[11px] leading-relaxed group-data-[collapsible=icon]:hidden">
          Not connected to the live storefront yet.{" "}
          <Link href="/settings?tab=cutover" className="text-brand underline-offset-2 hover:underline">
            Why
          </Link>
        </p>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
