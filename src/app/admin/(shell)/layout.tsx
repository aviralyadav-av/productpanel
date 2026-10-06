import { Suspense } from "react";
import { cookies } from "next/headers";

import { requireAdmin } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { getSettingString } from "@/lib/settings";
import { loadNavBadges } from "@/features/shell/badges";
import { AppSidebar, AppSidebarFallback } from "@/components/layout/app-sidebar";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { CommandMenu } from "@/components/layout/command-menu";
import { NotificationBell, type NotificationRow } from "@/components/layout/notification-bell";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { PermissionProvider } from "@/components/shared/permission-gate";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

/**
 * The admin shell (blueprint §2, §6). One place computes everything the
 * chrome needs - badge counts, the bell, the store name - in a single
 * Promise.all, so a page render costs the page's own queries plus one batch.
 */
async function getShellData(userId: string, actor: Awaited<ReturnType<typeof requireAdmin>>) {
  const [counts, notifications, storeName] = await Promise.all([
    loadNavBadges(actor),
    db.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        type: true,
        severity: true,
        title: true,
        body: true,
        href: true,
        createdAt: true,
        readAt: true,
      },
    }),
    getSettingString("store.name"),
  ]);

  return {
    counts,
    notifications: notifications as NotificationRow[],
    unreadCount: counts.unreadNotifications ?? 0,
    storeName: storeName || "DIY Baazar",
  };
}

export default async function AdminShellLayout({ children }: LayoutProps<"/admin">) {
  // The real authorization boundary. proxy.ts only keeps signed-out visitors
  // from seeing the shell flash; this re-reads the user and session rows on
  // every request. Pages call their own requirePermission() on top (D10).
  const actor = await requireAdmin();

  const [shell, cookieStore] = await Promise.all([getShellData(actor.id, actor), cookies()]);

  // Persisted so the sidebar does not flick open on every navigation.
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";
  const permissions = [...actor.permissions];

  return (
    <PermissionProvider permissions={permissions} isSuperAdmin={actor.isSuperAdmin}>
      <SidebarProvider defaultOpen={defaultOpen}>
        <Suspense fallback={<AppSidebarFallback />}>
          <AppSidebar
            permissions={permissions}
            isSuperAdmin={actor.isSuperAdmin}
            counts={shell.counts}
            storeName={shell.storeName}
            roleName={actor.roleName}
          />
        </Suspense>

        <SidebarInset className="min-w-0">
          <header className="bg-background/80 sticky top-0 z-30 flex h-12 shrink-0 items-center gap-1.5 border-b px-2 backdrop-blur sm:gap-2 sm:px-3">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-0.5 hidden h-4 sm:block sm:mr-1" />

            <div className="min-w-0 flex-1">
              <Suspense fallback={null}>
                <Breadcrumbs />
              </Suspense>
            </div>

            <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
              <CommandMenu permissions={permissions} isSuperAdmin={actor.isSuperAdmin} />
              <NotificationBell
                notifications={shell.notifications}
                unreadCount={shell.unreadCount}
              />
              <ThemeToggle />
              <UserMenu
                name={actor.name}
                email={actor.email}
                roleName={actor.roleName}
                twoFactorEnabled={actor.twoFactorEnabled}
              />
            </div>
          </header>

          <div className="min-w-0 flex-1 p-4 lg:p-6">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </PermissionProvider>
  );
}
