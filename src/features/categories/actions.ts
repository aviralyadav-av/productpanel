"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, runAction, zodFail, type ActionResult } from "@/lib/action-result";
import { requirePermissionOrThrow } from "@/lib/auth/guards";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";
import { db } from "@/lib/db";

import {
  categoryAttributeRefSchema,
  categoryFlagSchema,
  categoryIdSchema,
  categoryInputSchema,
  categoryPatchSchema,
  commissionOverrideSchema,
  deleteCategorySchema,
  reorderOwnAttributesSchema,
  reorderSchema,
  setAttributeFlagSchema,
  type CategoryInput,
  type CategoryPatch,
  type CommissionOverrideInput,
  type DeleteCategoryInput,
  type ReorderInput,
  type ReorderOwnAttributesInput,
  type SetAttributeFlagInput,
} from "./schemas";
import {
  addCategoryAttribute,
  createCategory,
  deleteCategory,
  excludeCategoryAttribute,
  includeCategoryAttribute,
  removeCategoryCommission,
  removeOwnCategoryAttribute,
  reorderCategories,
  reorderOwnCategoryAttributes,
  saveCategoryCommission,
  setCategoryAttributeFlag,
  setCategoryFlag,
  updateCategory,
  type CategoryCommissionRule,
  type CategoryRecord,
  type DeleteCategoryResult,
  type RemoveOwnAttributeResult,
  type ReorderResult,
} from "./service";

/**
 * Server Actions for /admin/categories. Each one is the same five steps in
 * the same order (blueprint §7): permission → zod → service inside ONE
 * transaction (which writes the audit row) → public cache invalidation →
 * revalidatePath. The service never learns about Next, so the REST routes
 * and the check script reuse it unchanged.
 */

const LIST_PATH = "/admin/categories";
const MANAGE = "categories.manage";

/** A category edit changes listings, menus and homepage sections that point at it. */
async function afterCategoryChange(...ids: Array<string | null | undefined>): Promise<void> {
  await invalidatePublic(listTagsFor("category"));
  revalidatePath(LIST_PATH);
  for (const id of ids) if (id) revalidatePath(`${LIST_PATH}/${id}`);
}

/** Attribute-set changes only touch the catalog (facets, specs, variants). */
async function afterAttributeChange(categoryId: string): Promise<void> {
  await invalidatePublic(["catalog"]);
  revalidatePath(`${LIST_PATH}/${categoryId}`);
}

// ---------------------------------------------------------------------------
// Category CRUD
// ---------------------------------------------------------------------------

export async function createCategoryAction(input: CategoryInput): Promise<ActionResult<CategoryRecord>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsed = categoryInputSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const category = await db.$transaction((tx) => createCategory(tx, parsed.data, actor));
    await afterCategoryChange(category.id, category.parentId);
    return ok(category, `Created "${category.name}".`);
  });
}

export async function updateCategoryAction(id: string, patch: CategoryPatch): Promise<ActionResult<CategoryRecord>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsedId = categoryIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid category id.");
    const parsed = categoryPatchSchema.safeParse(patch);
    if (!parsed.success) return zodFail(parsed.error);

    const result = await db.$transaction((tx) => updateCategory(tx, parsedId.data, parsed.data, actor));
    await afterCategoryChange(result.category.id);
    return ok(
      result.category,
      result.structural
        ? `Saved "${result.category.name}"; paths of its sub-categories were updated.`
        : `Saved "${result.category.name}".`,
    );
  });
}

export async function setCategoryFlagAction(
  input: { id: string; value: boolean },
  flag: "isActive" | "isFeatured",
): Promise<ActionResult<CategoryRecord>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsed = categoryFlagSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const category = await db.$transaction((tx) => setCategoryFlag(tx, parsed.data.id, flag, parsed.data.value, actor));
    await afterCategoryChange(category.id);
    const verb = flag === "isActive" ? (parsed.data.value ? "enabled" : "disabled") : parsed.data.value ? "featured" : "no longer featured";
    return ok(category, `"${category.name}" is ${verb}.`);
  });
}

export async function deleteCategoryAction(input: DeleteCategoryInput): Promise<ActionResult<DeleteCategoryResult>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsed = deleteCategorySchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const result = await db.$transaction((tx) => deleteCategory(tx, parsed.data, actor));
    await afterCategoryChange(result.reassignedTo?.id);
    return ok(
      result,
      result.reassignedTo
        ? `Deleted "${result.name}"; ${result.movedProducts} product(s) and ${result.movedChildren} sub-categor${result.movedChildren === 1 ? "y" : "ies"} moved to "${result.reassignedTo.name}".`
        : `Deleted "${result.name}".`,
    );
  });
}

export async function reorderCategoriesAction(input: ReorderInput): Promise<ActionResult<ReorderResult>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsed = reorderSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const result = await db.$transaction((tx) => reorderCategories(tx, parsed.data.moves, actor));
    await afterCategoryChange(...parsed.data.moves.map((move) => move.id));
    return ok(
      result,
      result.categories > 0
        ? `Moved; ${result.categories} path(s) rewritten${result.products > 0 ? `, ${result.products} product(s) queued for recompute` : ""}.`
        : "Order saved.",
    );
  });
}

// ---------------------------------------------------------------------------
// Attributes tab (A2)
// ---------------------------------------------------------------------------

export async function setCategoryAttributeFlagAction(input: SetAttributeFlagInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsed = setAttributeFlagSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    await db.$transaction((tx) => setCategoryAttributeFlag(tx, parsed.data, actor));
    await afterAttributeChange(parsed.data.categoryId);
    return ok(undefined, "Attribute updated.");
  });
}

export async function excludeCategoryAttributeAction(input: { categoryId: string; attributeId: string }): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsed = categoryAttributeRefSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    await db.$transaction((tx) => excludeCategoryAttribute(tx, parsed.data, actor));
    await afterAttributeChange(parsed.data.categoryId);
    return ok(undefined, "Attribute excluded from this category and its sub-categories.");
  });
}

export async function includeCategoryAttributeAction(input: { categoryId: string; attributeId: string }): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsed = categoryAttributeRefSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const result = await db.$transaction((tx) => includeCategoryAttribute(tx, parsed.data, actor));
    await afterAttributeChange(parsed.data.categoryId);
    return ok(undefined, result.mode === "restored_inheritance" ? "Attribute included again (inherits from above)." : "Attribute included.");
  });
}

export async function addCategoryAttributeAction(input: { categoryId: string; attributeId: string }): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsed = categoryAttributeRefSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    await db.$transaction((tx) => addCategoryAttribute(tx, parsed.data, actor));
    await afterAttributeChange(parsed.data.categoryId);
    return ok(undefined, "Attribute assigned.");
  });
}

export async function removeOwnCategoryAttributeAction(input: {
  categoryId: string;
  attributeId: string;
}): Promise<ActionResult<RemoveOwnAttributeResult>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsed = categoryAttributeRefSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const result = await db.$transaction((tx) => removeOwnCategoryAttribute(tx, parsed.data, actor));
    await afterAttributeChange(parsed.data.categoryId);
    return ok(
      result,
      result.stillEffective
        ? `Own assignment of "${result.attributeName}" removed; it still applies from above.`
        : `"${result.attributeName}" removed. ${result.productValues.products} product value(s) were kept.`,
    );
  });
}

export async function reorderOwnCategoryAttributesAction(input: ReorderOwnAttributesInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsed = reorderOwnAttributesSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    await db.$transaction((tx) => reorderOwnCategoryAttributes(tx, parsed.data.categoryId, parsed.data.attributeIds, actor));
    await afterAttributeChange(parsed.data.categoryId);
    return ok(undefined, "Order saved.");
  });
}

// ---------------------------------------------------------------------------
// Commission override (B3)
// ---------------------------------------------------------------------------

export async function saveCategoryCommissionAction(input: CommissionOverrideInput): Promise<ActionResult<CategoryCommissionRule>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsed = commissionOverrideSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const rule = await db.$transaction((tx) => saveCategoryCommission(tx, parsed.data, actor));
    revalidatePath(`${LIST_PATH}/${parsed.data.categoryId}`);
    return ok(rule, "Commission override saved.");
  });
}

export async function removeCategoryCommissionAction(categoryId: string): Promise<ActionResult<{ removed: boolean }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsedId = categoryIdSchema.safeParse(categoryId);
    if (!parsedId.success) return fail("Invalid category id.");

    const result = await db.$transaction((tx) => removeCategoryCommission(tx, parsedId.data, actor));
    revalidatePath(`${LIST_PATH}/${parsedId.data}`);
    return ok(result, result.removed ? "Commission override removed; the inherited rate applies." : "There was no override to remove.");
  });
}
