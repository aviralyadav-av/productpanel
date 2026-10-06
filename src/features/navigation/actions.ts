"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, runAction, zodFail, type ActionResult } from "@/lib/action-result";
import { requirePermissionOrThrow } from "@/lib/auth/guards";
import { invalidatePublic } from "@/lib/cache-tags";

import {
  importCategoryTreeSchema,
  itemActiveSchema,
  itemInputSchema,
  menuCreateSchema,
  menuUpdateSchema,
  navIdSchema,
  reorderItemsSchema,
  type ImportCategoryTreeInput,
  type ItemInput,
  type MenuCreateInput,
  type MenuUpdateInput,
  type ReorderItemsInput,
} from "./schemas";
import {
  createItem,
  createMenu,
  deleteItem,
  deleteMenu,
  importCategoryTree,
  reorderItems,
  setItemActive,
  updateItem,
  updateMenu,
} from "./service";

/**
 * Server Actions for /admin/navigation.
 *
 * Menus are part of the public payload (`GET /api/v1/navigation/:slug`, and the
 * footer columns inside `/api/v1/footer`), so every commit invalidates the
 * `nav` cache tag before the page revalidates - otherwise the admin would show
 * the new order while the website still served the old one for a minute.
 */

const PATH = "/admin/navigation";
const PERMISSION = "navigation.manage";

async function afterChange(): Promise<void> {
  await invalidatePublic(["nav"]);
  revalidatePath(PATH);
  // The footer tab on /admin/homepage prints per-menu link counts.
  revalidatePath("/admin/homepage");
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

type SavedMenu = { id: string; slug: string; name: string };

export async function createMenuAction(input: MenuCreateInput): Promise<ActionResult<SavedMenu>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(PERMISSION);
    const parsed = menuCreateSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const row = await createMenu(parsed.data, actor);
    await afterChange();
    return ok({ id: row.id, slug: row.slug, name: row.name }, `Menu "${row.name}" created.`);
  });
}

export async function updateMenuAction(id: string, input: MenuUpdateInput): Promise<ActionResult<SavedMenu>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(PERMISSION);
    const parsedId = navIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid menu id.");
    const parsed = menuUpdateSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const row = await updateMenu(parsedId.data, parsed.data, actor);
    await afterChange();
    return ok({ id: row.id, slug: row.slug, name: row.name }, "Menu saved.");
  });
}

export async function deleteMenuAction(id: string): Promise<ActionResult<{ id: string; name: string; items: number }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(PERMISSION);
    const parsedId = navIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid menu id.");
    const result = await deleteMenu(parsedId.data, actor);
    await afterChange();
    return ok(result, `Menu "${result.name}" deleted.`);
  });
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

type SavedItem = { id: string; label: string; menuId: string };

export async function createItemAction(input: ItemInput): Promise<ActionResult<SavedItem>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(PERMISSION);
    const parsed = itemInputSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const row = await createItem(parsed.data, actor);
    await afterChange();
    return ok({ id: row.id, label: row.label, menuId: row.menuId }, `"${row.label}" added.`);
  });
}

export async function updateItemAction(id: string, input: ItemInput): Promise<ActionResult<SavedItem>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(PERMISSION);
    const parsedId = navIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid item id.");
    const parsed = itemInputSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const row = await updateItem(parsedId.data, parsed.data, actor);
    await afterChange();
    return ok({ id: row.id, label: row.label, menuId: row.menuId }, `"${row.label}" saved.`);
  });
}

export async function setItemActiveAction(input: { id: string; isActive: boolean }): Promise<ActionResult<SavedItem & { isActive: boolean }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(PERMISSION);
    const parsed = itemActiveSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const row = await setItemActive(parsed.data.id, parsed.data.isActive, actor);
    await afterChange();
    return ok(
      { id: row.id, label: row.label, menuId: row.menuId, isActive: row.isActive },
      `"${row.label}" ${row.isActive ? "shown" : "hidden"}.`,
    );
  });
}

export async function deleteItemAction(id: string): Promise<ActionResult<{ id: string; label: string; descendants: number }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(PERMISSION);
    const parsedId = navIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid item id.");
    const result = await deleteItem(parsedId.data, actor);
    await afterChange();
    return ok(result, `"${result.label}" removed.`);
  });
}

export async function reorderItemsAction(input: ReorderItemsInput): Promise<ActionResult<{ moved: number; menuId: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(PERMISSION);
    const parsed = reorderItemsSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const result = await reorderItems(parsed.data.moves, actor);
    await afterChange();
    return ok(result, result.moved > 0 ? "Order saved." : undefined);
  });
}

export async function importCategoryTreeAction(input: ImportCategoryTreeInput): Promise<ActionResult<{ created: number; skipped: number; menuId: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(PERMISSION);
    const parsed = importCategoryTreeSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const result = await importCategoryTree(parsed.data, actor);
    await afterChange();
    return ok(
      result,
      result.created === 0
        ? "Every one of those categories is already in this menu."
        : `Added ${result.created} link${result.created === 1 ? "" : "s"}${result.skipped > 0 ? `; ${result.skipped} already present.` : "."}`,
    );
  });
}
