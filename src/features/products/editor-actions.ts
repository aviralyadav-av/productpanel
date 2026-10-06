"use server";

import { revalidatePath } from "next/cache";

import { ok, runAction, zodFail, type ActionResult } from "@/lib/action-result";
import { requirePermissionOrThrow } from "@/lib/auth/guards";
import type { GenerateVariantsResult } from "@/features/catalog/variants";

import { applyAttributeImport, previewAttributeImport, type ImportReport } from "./attribute-csv";
import {
  createCustomizationOption,
  deleteCustomizationOption,
  reorderCustomizationOptions,
  updateCustomizationOption,
  type CustomizationOptionRecord,
} from "./customization-service";
import { addProductImages, removeProductImage, reorderProductImages, updateProductImage } from "./images-service";
import {
  addImagesSchema,
  attributeImportSchema,
  createVariantSchema,
  customizationOptionPatchSchema,
  customizationOptionSchema,
  looseIdSchema,
  reorderSchema,
  updateImageSchema,
  updateVariantSchema,
  variantAxesSchema,
  variantImagesSchema,
  type AttributeImportInput,
  type CreateVariantInput,
  type CustomizationOptionInput,
  type UpdateImageInput,
  type UpdateVariantInput,
  type VariantAxesInput,
} from "./schemas";
import { removeProductAttribute } from "./service";
import {
  createVariant,
  deleteVariant,
  generateProductVariants,
  setDefaultVariant,
  setVariantImages,
  updateVariant,
  type VariantRecord,
} from "./variants-service";

/**
 * Server Actions for the editor sections that save independently of the main
 * form: variants, gallery, customisation options, orphan attribute removal and
 * the attribute CSV import. Same shape as ./actions.ts.
 */

function revalidate(productId: string): void {
  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${productId}`);
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

export async function generateVariantsAction(productId: string, input: VariantAxesInput): Promise<ActionResult<GenerateVariantsResult>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("products.edit");
    const parsed = variantAxesSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const result = await generateProductVariants(productId, parsed.data, actor);
    revalidate(productId);
    return ok(result, `${result.created} created, ${result.kept} kept, ${result.deactivated} deactivated.`);
  });
}

export async function createVariantAction(productId: string, input: CreateVariantInput): Promise<ActionResult<VariantRecord>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("products.edit");
    const parsed = createVariantSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const variant = await createVariant(productId, parsed.data, actor);
    revalidate(productId);
    return ok(variant, `Added variant "${variant.name}".`);
  });
}

export async function updateVariantAction(productId: string, variantId: string, patch: UpdateVariantInput): Promise<ActionResult<VariantRecord>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("products.edit");
    const parsed = updateVariantSchema.safeParse(patch);
    if (!parsed.success) return zodFail(parsed.error);
    const variant = await updateVariant(productId, variantId, parsed.data, actor);
    revalidate(productId);
    return ok(variant, `Saved "${variant.name}".`);
  });
}

export async function deleteVariantAction(productId: string, variantId: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("products.edit");
    const result = await deleteVariant(productId, variantId, actor);
    revalidate(productId);
    return ok(result, "Variant deleted.");
  });
}

export async function setDefaultVariantAction(productId: string, variantId: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("products.edit");
    const result = await setDefaultVariant(productId, variantId, actor);
    revalidate(productId);
    return ok(result, "Default variant updated.");
  });
}

export async function setVariantImagesAction(productId: string, variantId: string, mediaIds: string[]): Promise<ActionResult<{ count: number }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("products.edit");
    const parsed = variantImagesSchema.safeParse({ mediaIds });
    if (!parsed.success) return zodFail(parsed.error);
    const result = await setVariantImages(productId, variantId, parsed.data.mediaIds, actor);
    revalidate(productId);
    return ok(result, "Variant images saved.");
  });
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export async function addImagesAction(productId: string, mediaIds: string[]): Promise<ActionResult<{ added: number; skipped: number }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("products.edit");
    const parsed = addImagesSchema.safeParse({ mediaIds });
    if (!parsed.success) return zodFail(parsed.error);
    const result = await addProductImages(productId, parsed.data.mediaIds, actor);
    revalidate(productId);
    return ok(result, result.skipped > 0 ? `${result.added} added, ${result.skipped} already in the gallery.` : `${result.added} image${result.added === 1 ? "" : "s"} added.`);
  });
}

export async function updateImageAction(productId: string, imageId: string, patch: UpdateImageInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("products.edit");
    const parsed = updateImageSchema.safeParse(patch);
    if (!parsed.success) return zodFail(parsed.error);
    const image = await updateProductImage(productId, imageId, parsed.data, actor);
    revalidate(productId);
    return ok({ id: image.id }, parsed.data.isPrimary ? "Primary image set." : "Image updated.");
  });
}

export async function removeImageAction(productId: string, imageId: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("products.edit");
    const result = await removeProductImage(productId, imageId, actor);
    revalidate(productId);
    return ok(result, "Image removed from the gallery.");
  });
}

export async function reorderImagesAction(productId: string, orderedIds: string[]): Promise<ActionResult<{ count: number }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("products.edit");
    const parsed = reorderSchema.safeParse({ orderedIds });
    if (!parsed.success) return zodFail(parsed.error);
    const result = await reorderProductImages(productId, parsed.data.orderedIds, actor);
    revalidate(productId);
    return ok(result);
  });
}

// ---------------------------------------------------------------------------
// Customisation options
// ---------------------------------------------------------------------------

export async function createCustomizationOptionAction(productId: string, input: CustomizationOptionInput): Promise<ActionResult<CustomizationOptionRecord>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("products.edit");
    const parsed = customizationOptionSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const option = await createCustomizationOption(productId, parsed.data, actor);
    revalidate(productId);
    return ok(option, `Added "${option.label}".`);
  });
}

export async function updateCustomizationOptionAction(productId: string, optionId: string, patch: unknown): Promise<ActionResult<CustomizationOptionRecord>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("products.edit");
    const parsed = customizationOptionPatchSchema.safeParse(patch);
    if (!parsed.success) return zodFail(parsed.error);
    const option = await updateCustomizationOption(productId, optionId, parsed.data, actor);
    revalidate(productId);
    return ok(option, `Saved "${option.label}".`);
  });
}

export async function deleteCustomizationOptionAction(productId: string, optionId: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("products.edit");
    const result = await deleteCustomizationOption(productId, optionId, actor);
    revalidate(productId);
    return ok(result, "Option removed.");
  });
}

export async function reorderCustomizationOptionsAction(productId: string, orderedIds: string[]): Promise<ActionResult<{ count: number }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("products.edit");
    const parsed = reorderSchema.safeParse({ orderedIds });
    if (!parsed.success) return zodFail(parsed.error);
    const result = await reorderCustomizationOptions(productId, parsed.data.orderedIds, actor);
    revalidate(productId);
    return ok(result);
  });
}

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

export async function removeProductAttributeAction(productId: string, attributeId: string): Promise<ActionResult<{ removed: number }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("products.edit");
    const parsed = looseIdSchema.safeParse(attributeId);
    if (!parsed.success) return zodFail(parsed.error);
    const result = await removeProductAttribute(productId, parsed.data, actor);
    revalidate(productId);
    return ok(result, "Attribute removed from this product.");
  });
}

export async function attributeImportAction(input: AttributeImportInput): Promise<ActionResult<ImportReport>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("products.bulk");
    const parsed = attributeImportSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const report = parsed.data.apply ? await applyAttributeImport(parsed.data, actor) : await previewAttributeImport(parsed.data);
    if (report.applied) revalidatePath("/admin/products");
    return ok(
      report,
      report.applied
        ? `Imported ${report.rows.filter((row) => row.errors.length === 0 && row.changes.length > 0).length} product(s).`
        : undefined,
    );
  });
}
