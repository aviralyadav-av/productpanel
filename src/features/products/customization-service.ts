import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { notFound } from "@/lib/api/errors";
import { diffOf, writeAudit } from "@/lib/audit";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";

import { PRODUCT_ENTITY, loadProduct, syncCustomizableFlag, type Db } from "./internal";
import type { CustomizationOptionPatch, CustomizationOptionValues } from "./schemas";
import type { ProductActor } from "./service";

/**
 * Customisation option builder (blueprint §4 customised products, §11.9).
 *
 * Options describe what the storefront asks the shopper; answers are validated
 * at checkout by ./customization.ts (pure) and frozen into
 * OrderItem.customization. `Product.isCustomizable` is derived here - it is
 * true exactly when the product has an active option - so the public
 * `customizable` facet can never drift from the builder.
 */

export const CUSTOMIZATION_OPTION_SELECT = {
  id: true,
  productId: true,
  type: true,
  label: true,
  helpText: true,
  placeholder: true,
  isRequired: true,
  minLength: true,
  maxLength: true,
  maxFiles: true,
  allowedMimeTypes: true,
  choices: true,
  priceDeltaPaise: true,
  position: true,
  isActive: true,
} satisfies Prisma.CustomizationOptionSelect;

export type CustomizationOptionRecord = Prisma.CustomizationOptionGetPayload<{ select: typeof CUSTOMIZATION_OPTION_SELECT }>;

async function loadOption(tx: Db, productId: string, optionId: string): Promise<CustomizationOptionRecord> {
  const option = await tx.customizationOption.findUnique({ where: { id: optionId }, select: CUSTOMIZATION_OPTION_SELECT });
  if (!option || option.productId !== productId) throw notFound("Customisation option");
  return option;
}

function optionData(input: Partial<CustomizationOptionValues>): Prisma.CustomizationOptionUncheckedUpdateInput {
  const data: Prisma.CustomizationOptionUncheckedUpdateInput = {};
  for (const key of ["type", "label", "helpText", "placeholder", "isRequired", "minLength", "maxLength", "maxFiles", "allowedMimeTypes", "priceDeltaPaise", "isActive"] as const) {
    if (input[key] !== undefined) (data as Record<string, unknown>)[key] = input[key];
  }
  if (input.choices !== undefined) data.choices = input.choices as unknown as Prisma.InputJsonValue;
  return data;
}

export async function listCustomizationOptions(productId: string, tx?: Db): Promise<CustomizationOptionRecord[]> {
  return (tx ?? db).customizationOption.findMany({
    where: { productId },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: CUSTOMIZATION_OPTION_SELECT,
  });
}

export async function createCustomizationOption(
  productId: string,
  input: CustomizationOptionValues,
  actor: ProductActor,
  meta: { ip?: string | null } = {},
): Promise<CustomizationOptionRecord> {
  const result = await db.$transaction(async (tx) => {
    const product = await loadProduct(tx, productId);
    const position = await tx.customizationOption.count({ where: { productId } });
    const option = await tx.customizationOption.create({
      data: { ...(optionData(input) as Prisma.CustomizationOptionUncheckedCreateInput), productId, type: input.type, label: input.label, position },
      select: CUSTOMIZATION_OPTION_SELECT,
    });
    await syncCustomizableFlag(tx, productId);
    await writeAudit(tx, {
      actor,
      action: "product.customization_create",
      entityType: PRODUCT_ENTITY,
      entityId: productId,
      entityLabel: product.title,
      summary: `Added customisation option "${option.label}" (${option.type}) to "${product.title}".`,
      diff: diffOf(null, { optionId: option.id, type: option.type, label: option.label, isRequired: option.isRequired }),
      ip: meta.ip,
    });
    return option;
  });
  await invalidatePublic(listTagsFor(PRODUCT_ENTITY));
  return result;
}

export async function updateCustomizationOption(
  productId: string,
  optionId: string,
  patch: CustomizationOptionPatch,
  actor: ProductActor,
  meta: { ip?: string | null } = {},
): Promise<CustomizationOptionRecord> {
  const result = await db.$transaction(async (tx) => {
    const product = await loadProduct(tx, productId);
    const before = await loadOption(tx, productId, optionId);
    const after = await tx.customizationOption.update({
      where: { id: optionId },
      data: optionData(patch),
      select: CUSTOMIZATION_OPTION_SELECT,
    });
    await syncCustomizableFlag(tx, productId);
    await writeAudit(tx, {
      actor,
      action: "product.customization_update",
      entityType: PRODUCT_ENTITY,
      entityId: productId,
      entityLabel: product.title,
      summary: `Updated customisation option "${after.label}" on "${product.title}".`,
      diff: diffOf(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>),
      ip: meta.ip,
    });
    return after;
  });
  await invalidatePublic(listTagsFor(PRODUCT_ENTITY));
  return result;
}

/**
 * Options are hard-deleted: order lines carry their own frozen snapshot, so
 * nothing references the row once it is gone.
 */
export async function deleteCustomizationOption(productId: string, optionId: string, actor: ProductActor, meta: { ip?: string | null } = {}) {
  const result = await db.$transaction(async (tx) => {
    const product = await loadProduct(tx, productId);
    const option = await loadOption(tx, productId, optionId);
    await tx.customizationOption.delete({ where: { id: optionId } });
    const rest = await tx.customizationOption.findMany({ where: { productId }, orderBy: [{ position: "asc" }], select: { id: true } });
    for (const [index, row] of rest.entries()) {
      await tx.customizationOption.update({ where: { id: row.id }, data: { position: index } });
    }
    await syncCustomizableFlag(tx, productId);
    await writeAudit(tx, {
      actor,
      action: "product.customization_delete",
      entityType: PRODUCT_ENTITY,
      entityId: productId,
      entityLabel: product.title,
      summary: `Removed customisation option "${option.label}" from "${product.title}".`,
      diff: diffOf({ optionId, type: option.type, label: option.label }, null),
      ip: meta.ip,
    });
    return { id: optionId };
  });
  await invalidatePublic(listTagsFor(PRODUCT_ENTITY));
  return result;
}

export async function reorderCustomizationOptions(productId: string, orderedIds: readonly string[], actor: ProductActor, meta: { ip?: string | null } = {}) {
  const result = await db.$transaction(async (tx) => {
    const product = await loadProduct(tx, productId);
    const rows = await tx.customizationOption.findMany({ where: { productId }, orderBy: [{ position: "asc" }], select: { id: true } });
    const known = new Set(rows.map((row) => row.id));
    const ordered = [...new Set(orderedIds)].filter((id) => known.has(id));
    const final = [...ordered, ...rows.map((row) => row.id).filter((id) => !ordered.includes(id))];
    for (const [index, id] of final.entries()) {
      await tx.customizationOption.update({ where: { id }, data: { position: index } });
    }
    await writeAudit(tx, {
      actor,
      action: "product.customization_reorder",
      entityType: PRODUCT_ENTITY,
      entityId: productId,
      entityLabel: product.title,
      summary: `Reordered customisation options on "${product.title}".`,
      ip: meta.ip,
    });
    return { count: final.length };
  });
  await invalidatePublic(listTagsFor(PRODUCT_ENTITY));
  return result;
}
