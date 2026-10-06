import type { Metadata } from "next";

import { can, requirePermission } from "@/lib/auth/guards";

import { CategoriesScreen } from "@/features/categories/components/categories-screen";
import { categoryKpis, listCategoryTree } from "@/features/categories/queries";

export const metadata: Metadata = { title: "Categories" };

/**
 * /admin/categories (blueprint §1 Categories, §14.A2, A9, G5).
 *
 * The tree ships whole: product counts are rolled up in memory from one
 * groupBy, so the page costs the same four queries whether there are ten
 * categories or five hundred. Search, expand/collapse and drag-reorder are
 * client-side on top of that payload.
 */
export default async function CategoriesPage() {
  const actor = await requirePermission("categories.view");

  const [rows, kpis] = await Promise.all([listCategoryTree(), categoryKpis()]);

  return <CategoriesScreen rows={rows} kpis={kpis} canManage={can(actor, "categories.manage")} />;
}
