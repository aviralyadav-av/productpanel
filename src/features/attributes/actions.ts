"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, runAction, zodFail, type ActionResult } from "@/lib/action-result";
import { requirePermissionOrThrow } from "@/lib/auth/guards";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";
import { db } from "@/lib/db";

import {
  attributeActiveSchema,
  attributeIdSchema,
  attributeInputSchema,
  attributePatchSchema,
  attributeValueInputSchema,
  attributeValuePatchSchema,
  reorderValuesSchema,
  type AttributeInput,
  type AttributePatch,
  type AttributeValueInput,
  type AttributeValuePatch,
} from "./schemas";
import {
  addAttributeValue,
  createAttribute,
  deleteAttribute,
  deleteAttributeValue,
  reorderAttributeValues,
  setAttributeActive,
  updateAttribute,
  updateAttributeValue,
  type AttributeRecord,
  type AttributeValueRecord,
  type DeleteAttributeResult,
  type DeleteValueResult,
} from "./service";

/**
 * Server Actions for /admin/attributes: permission → zod → service in one
 * transaction (audit inside) → invalidatePublic('attribute') → revalidate.
 */

const LIST_PATH = "/admin/attributes";
const MANAGE = "attributes.manage";

async function after(id?: string | null): Promise<void> {
  await invalidatePublic(listTagsFor("attribute"));
  revalidatePath(LIST_PATH);
  if (id) revalidatePath(`${LIST_PATH}/${id}`);
}

export async function createAttributeAction(input: AttributeInput): Promise<ActionResult<AttributeRecord>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsed = attributeInputSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const attribute = await db.$transaction((tx) => createAttribute(tx, parsed.data, actor));
    await after(attribute.id);
    return ok(attribute, `Created "${attribute.name}".`);
  });
}

export async function updateAttributeAction(id: string, patch: AttributePatch): Promise<ActionResult<AttributeRecord>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsedId = attributeIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid attribute id.");
    const parsed = attributePatchSchema.safeParse(patch);
    if (!parsed.success) return zodFail(parsed.error);
    const result = await db.$transaction((tx) => updateAttribute(tx, parsedId.data, parsed.data, actor));
    await after(result.attribute.id);
    return ok(
      result.attribute,
      result.recomputeQueued > 0
        ? `Saved "${result.attribute.name}"; facets of ${result.recomputeQueued} product(s) are being rebuilt.`
        : `Saved "${result.attribute.name}".`,
    );
  });
}

export async function setAttributeActiveAction(input: { id: string; value: boolean }): Promise<ActionResult<AttributeRecord>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsed = attributeActiveSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const attribute = await db.$transaction((tx) => setAttributeActive(tx, parsed.data.id, parsed.data.value, actor));
    await after(attribute.id);
    return ok(attribute, `"${attribute.name}" is ${parsed.data.value ? "active" : "inactive"}.`);
  });
}

export async function deleteAttributeAction(id: string): Promise<ActionResult<DeleteAttributeResult>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsedId = attributeIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid attribute id.");
    const result = await db.$transaction((tx) => deleteAttribute(tx, parsedId.data, actor));
    if (!result.deleted) {
      const parts = [
        result.usage.categories.length > 0 ? `${result.usage.categories.length} categor${result.usage.categories.length === 1 ? "y" : "ies"}` : null,
        result.usage.products > 0 ? `${result.usage.products} product(s)` : null,
        result.usage.variants > 0 ? `${result.usage.variants} variant(s)` : null,
      ].filter(Boolean);
      return fail(`"${result.name}" is still used by ${parts.join(", ")}. Detach it first.`);
    }
    await after(parsedId.data);
    return ok(result, `Deleted "${result.name}".`);
  });
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export async function addAttributeValueAction(attributeId: string, input: AttributeValueInput): Promise<ActionResult<AttributeValueRecord>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const parsedId = attributeIdSchema.safeParse(attributeId);
    if (!parsedId.success) return fail("Invalid attribute id.");
    const parsed = attributeValueInputSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const value = await db.$transaction((tx) => addAttributeValue(tx, parsedId.data, parsed.data, actor));
    await after(parsedId.data);
    return ok(value, `Added "${value.label ?? value.value}".`);
  });
}

export async function updateAttributeValueAction(
  attributeId: string,
  valueId: string,
  patch: AttributeValuePatch,
): Promise<ActionResult<AttributeValueRecord>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const ids = attributeIdSchema.safeParse(attributeId);
    const valueIdParsed = attributeIdSchema.safeParse(valueId);
    if (!ids.success || !valueIdParsed.success) return fail("Invalid id.");
    const parsed = attributeValuePatchSchema.safeParse(patch);
    if (!parsed.success) return zodFail(parsed.error);
    const result = await db.$transaction((tx) => updateAttributeValue(tx, ids.data, valueIdParsed.data, parsed.data, actor));
    await after(ids.data);
    return ok(result.value, "Value saved.");
  });
}

export async function deleteAttributeValueAction(attributeId: string, valueId: string): Promise<ActionResult<DeleteValueResult>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const ids = attributeIdSchema.safeParse(attributeId);
    const valueIdParsed = attributeIdSchema.safeParse(valueId);
    if (!ids.success || !valueIdParsed.success) return fail("Invalid id.");
    const result = await db.$transaction((tx) => deleteAttributeValue(tx, ids.data, valueIdParsed.data, actor));
    if (!result.deleted) {
      return fail(`This value is used by ${result.usage.products} product(s) and ${result.usage.variants} variant(s). Deactivate it instead, or remove those values first.`);
    }
    await after(ids.data);
    return ok(result, "Value deleted.");
  });
}

export async function reorderAttributeValuesAction(attributeId: string, valueIds: string[]): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(MANAGE);
    const ids = attributeIdSchema.safeParse(attributeId);
    if (!ids.success) return fail("Invalid attribute id.");
    const parsed = reorderValuesSchema.safeParse({ valueIds });
    if (!parsed.success) return zodFail(parsed.error);
    await db.$transaction((tx) => reorderAttributeValues(tx, ids.data, parsed.data.valueIds, actor));
    await after(ids.data);
    return ok(undefined, "Order saved.");
  });
}
