import { cookies } from "next/headers";

import { requireAdmin } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { AppSidebar, type NavCounts } from "@/components/layout/app-sidebar";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { CommandMenu } from "@/components/layout/command-menu";
import {
  NotificationBell,
  type NotificationRow,
} from "@/components/layout/notification-bell";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

async function getShellData() {
  const [pendingOrders, lowStock, notifications, unreadCount, storeName] =
    await Promise.all([
      db.order.count({ where: { status: { in: ["PLACED", "CONFIRMED"] } } }),
      db.inventoryItem.count({ where: { onHand: { lte: 3 } } }),
      db.notification.findMany({ orderBy: { createdAt: "desc" }, take: 12 }),
      db.notification.count({ where: { readAt: null } }),
      db.setting.findUnique({ where: { key: "store.name" } }),
    ]);

  const counts: NavCounts = { pendingOrders, lowStock };

  return {
    counts,
    notifications: notifications as NotificationRow[],
    unreadCount,
    storeName: storeName?.value ?? "Niya Bags",
  };
}

export default async function DashboardLayout({
  children,
}: LayoutProps<"/">) {
  // The real authorization boundary. proxy.ts only keeps signed-out visitors
  // from seeing the shell flash; this re-reads the user row on every request.
  const actor = await requireAdmin();

  const [shell, cookieStore] = await Promise.all([getShellData(), cookies()]);

  // Persisted so the sidebar does not flick open on every navigation.
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar counts={shell.counts} storeName={shell.storeName} />

      <SidebarInset className="min-w-0">
        <header className="bg-background/80 sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b px-3 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 h-4" />

          <div className="min-w-0 flex-1">
            <Breadcrumbs />
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <div className="hidden sm:block">
              <CommandMenu />
            </div>
            <NotificationBell
              notifications={shell.notifications}
              unreadCount={shell.unreadCount}
            />
            <ThemeToggle />
            <UserMenu name={actor.name} email={actor.email} />
          </div>
        </header>

        <div className="min-w-0 flex-1 p-4 lg:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
