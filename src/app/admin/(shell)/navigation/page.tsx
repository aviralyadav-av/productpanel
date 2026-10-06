import type { Metadata } from "next";
import { ListTree } from "lucide-react";

import { can, requirePermission } from "@/lib/auth/guards";
import { one, type SearchParams } from "@/lib/list-params";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";

import { MenuPreview } from "@/features/navigation/components/menu-preview";
import { NavigationScreen } from "@/features/navigation/components/navigation-screen";
import {
  getMenuPreview,
  getMenuTree,
  listCategoryRoots,
  listMenus,
  resolveActiveMenu,
} from "@/features/navigation/queries";

export const metadata: Metadata = { title: "Navigation" };

/**
 * /admin/navigation (blueprint §1 Navigation, §4.8, §11.25, §14.G5).
 *
 * URL state is the menu slug (`?menu=footer-1`), so the Homepage footer tab
 * and any bookmark can deep-link straight to the column being edited. One menu
 * is loaded whole - the tree screen needs every row for nesting, drag
 * projection and the availability warning - alongside the exact public payload
 * for that menu so the operator can compare intent with contract side by side.
 */
export default async function NavigationPage({ searchParams }: PageProps<"/admin/navigation">) {
  const actor = await requirePermission("navigation.view");

  const params = (await searchParams) as SearchParams;
  const menus = await listMenus();
  const activeMenu = resolveActiveMenu(menus, one(params, "menu"));

  if (!activeMenu) {
    return (
      <div className="space-y-4">
        <PageHeader title="Navigation" description="Storefront menus and the links inside them." />
        <div className="surface">
          <EmptyState
            icon={ListTree}
            title="No menus exist"
            description="The seed creates main, footer-1..3 and mobile. Re-run the seed, or create a custom menu once one of them is needed."
          />
        </div>
      </div>
    );
  }

  const [rows, preview, categories] = await Promise.all([
    getMenuTree(activeMenu.id),
    getMenuPreview(activeMenu.slug),
    listCategoryRoots(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Navigation"
        description="Menus the storefront reads by slug: main, the three footer columns, mobile, plus any custom menu. Drag to reorder or nest; every change reaches the website on the next cache refresh."
      />
      <NavigationScreen
        menus={menus}
        activeMenu={activeMenu}
        rows={rows}
        categories={categories}
        canManage={can(actor, "navigation.manage")}
        preview={<MenuPreview menu={preview} slug={activeMenu.slug} />}
      />
    </div>
  );
}
