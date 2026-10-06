"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, runAction, zodFail, type ActionResult } from "@/lib/action-result";
import { can, requirePermissionOrThrow } from "@/lib/auth/guards";
import { forbiddenError } from "@/lib/api/errors";
import type { ProductStatus } from "@/lib/enums";
import { getSettingBoolean } from "@/lib/settings";
import { categoryChangeReport, type CategoryChangeReport } from "@/features/catalog/publish-validation";
import type { EffectiveAttribute } from "@/features/catalog/attribute-resolution";

import { bulkProducts, type BulkResult } from "./bulk-service";
import { getEffectiveAttributes } from "./queries";
import {
  BULK_OP_PERMISSION,
  bulkRequestSchema,
  flagsSchema,
  looseIdSchema,
  productFormSchema,
  setStatusSchema,
  type FlagsInput,
  type ProductFormInput,
} from "./schemas";
import {
  createProduct,
  createProductPreviewLink,
  duplicateProduct,
  publishValidation,
  setProductFlags,
  setProductStatus,
  softDeleteProduct,
  updateProduct,
  type PublishProblem,
  type UpdateProductResult,
} from "./service";

/**
 * Server Actions for the product list and the editor's main form. Each one is
 * permission → zod → service → revalidate → ActionResult; the service owns the
 * transaction and the audit row. Variant/image/customisation actions live in
 * ./editor-actions.ts so this file stays readable.
 */

const LIST_PATH = "/admin/products";

function revalidate(id?: string): void {
  revalidatePath(LIST_PATH);
  if (id) revalidatePath(`${LIST_PATH}/${id}`);
}

// ---------------------------------------------------------------------------
// Main form
// ---------------------------------------------------------------------------

export type SaveProductData = { id: string; slug: string; categoryChange: CategoryChangeReport | null };

/** One action for both create and update so the form has a single submit path. */
export async function saveProductAction(id: string | null, input: ProductFormInput): Promise<ActionResult<SaveProductData>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(id ? "products.edit" : "products.create");
    const parsed = productFormSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    if (!id) {
      const created = await createProduct(parsed.data, actor);
      revalidate(created.id);
      return ok({ ...created, categoryChange: null }, `Created "${parsed.data.title}" as a draft.`);
    }

    const result: UpdateProductResult = await updateProduct(id, parsed.data, actor);
    revalidate(id);
    return ok(
      { id, slug: result.product.slug, categoryChange: result.categoryChange },
      result.categoryChange && result.categoryChange.orphanAttributes.length > 0
        ? "Saved. Some attribute values are no longer part of this category - review them below."
        : "Product saved.",
    );
  });
}

export type StatusActionData = { status: ProductStatus } | { problems: PublishProblem[] };

export async function setProductStatusAction(id: string, status: ProductStatus, reason?: string): Promise<ActionResult<StatusActionData>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("products.publish");
    const parsed = setStatusSchema.safeParse({ status });
    if (!parsed.success) return zodFail(parsed.error);

    const result = await setProductStatus(id, parsed.data.status, actor, { reason });
    if (!result.ok) return fail("This product is not ready to publish yet.", Object.fromEntries(result.problems.map((p) => [p.code, p.message])));
    revalidate(id);
    const verb = status === "PUBLISHED" ? "Published" : status === "ARCHIVED" ? "Archived" : "Unpublished";
    return ok({ status: result.product.status as ProductStatus }, `${verb} "${result.product.title}".`);
  });
}

export async function publishChecklistAction(id: string): Promise<ActionResult<{ ok: boolean; problems: PublishProblem[] }>> {
  return runAction(async () => {
    await requirePermissionOrThrow("products.view");
    return ok(await publishValidation(id));
  });
}

export async function setProductFlagsAction(id: string, flags: FlagsInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("products.edit");
    const parsed = flagsSchema.safeParse(flags);
    if (!parsed.success) return zodFail(parsed.error);
    await setProductFlags(id, parsed.data, actor);
    revalidate(id);
    return ok({ id }, "Flags updated.");
  });
}

export async function duplicateProductAction(id: string): Promise<ActionResult<{ id: string; slug: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("products.create");
    const copy = await duplicateProduct(id, actor);
    revalidate();
    return ok(copy, "Duplicated as a new draft.");
  });
}

export async function deleteProductAction(id: string, reason?: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("products.delete");
    const result = await softDeleteProduct(id, actor, { reason });
    revalidate(id);
    return ok({ id: result.id }, "Product deleted. Order history is preserved.");
  });
}

export type PreviewLinkData = { url: string; expiresAt: string };

export async function previewLinkAction(id: string): Promise<ActionResult<PreviewLinkData>> {
  return runAction(async () => {
    await requirePermissionOrThrow("products.view");
    if (!(await getSettingBoolean("storefront.preview_enabled"))) {
      return fail("Preview links are disabled in Settings → Storefront.");
    }
    const link = await createProductPreviewLink(id);
    return ok({ url: link.url, expiresAt: link.expiresAt.toISOString() });
  });
}

// ---------------------------------------------------------------------------
// Editor helpers (read-only, but they need the session so they are actions)
// ---------------------------------------------------------------------------

export async function categoryChangeReportAction(productId: string, categoryId: string | null): Promise<ActionResult<CategoryChangeReport>> {
  return runAction(async () => {
    await requirePermissionOrThrow("products.view");
    return ok(await categoryChangeReport(undefined, { productId, newCategoryId: categoryId }));
  });
}

export async function effectiveAttributesAction(categoryId: string | null): Promise<ActionResult<EffectiveAttribute[]>> {
  return runAction(async () => {
    await requirePermissionOrThrow("products.view");
    const parsed = categoryId ? looseIdSchema.safeParse(categoryId) : null;
    if (parsed && !parsed.success) return fail("Invalid category.");
    return ok(await getEffectiveAttributes(categoryId));
  });
}

// ---------------------------------------------------------------------------
// Bulk (A7)
// ---------------------------------------------------------------------------

export async function bulkProductsAction(input: unknown): Promise<ActionResult<BulkResult>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("products.bulk");
    const parsed = bulkRequestSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    if (!can(actor, BULK_OP_PERMISSION[parsed.data.op])) {
      throw forbiddenError(`You need the "${BULK_OP_PERMISSION[parsed.data.op]}" permission for this action.`);
    }
    const result = await bulkProducts(parsed.data, actor);
    revalidate();
    return ok(result, result.summary);
  });
}
