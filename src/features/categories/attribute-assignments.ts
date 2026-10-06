import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { conflict, notFound, validationError } from "@/lib/api/errors";
import { diffOf, writeAudit, type AuditActor } from "@/lib/audit";
import { VARIANT_AXIS_INPUT_TYPES } from "@/lib/enums";
import { resolveCategoryAttributes, type EffectiveAttribute } from "@/features/catalog/attribute-resolution";

import type { CategoryAttributeRef, CategoryAttributeRowInput, SetAttributeFlagInput } from "./schemas";
import { queueSubtreeRecompute, requireCategory, subtreeProductWhere, type ClientMeta, type Db } from "./shared";

/**
 * Per-category attribute assignments (blueprint §14.A1-A2, §11.3): the rows
 * behind the Attributes tab. Same contract as service.ts - caller-owned
 * transaction, audit row inside it, no Next imports. Every change queues the
 * subtree facet recompute because the effective set of every descendant may
 * have moved.
 */


type OwnRow = Prisma.CategoryAttributeGetPayload<{ select: typeof OWN_ROW_SELECT }>;

const OWN_ROW_SELECT = {
  id: true,
  categoryId: true,
  attributeId: true,
  isRequired: true,
  isFilterable: true,
  isVariant: true,
  showInSpecs: true,
  inheritToChildren: true,
  isExcluded: true,
  position: true,
} satisfies Prisma.CategoryAttributeSelect;

async function ownRow(tx: Db, ref: CategoryAttributeRef): Promise<OwnRow | null> {
  return tx.categoryAttribute.findUnique({
    where: { categoryId_attributeId: { categoryId: ref.categoryId, attributeId: ref.attributeId } },
    select: OWN_ROW_SELECT,
  });
}

async function requireAttribute(tx: Db, attributeId: string) {
  const attribute = await tx.attribute.findUnique({
    where: { id: attributeId },
    select: {
      id: true,
      code: true,
      name: true,
      inputType: true,
      isActive: true,
      isGlobal: true,
      isFilterableDefault: true,
      isVariantDefining: true,
    },
  });
  if (!attribute) throw notFound("Attribute");
  return attribute;
}

async function nextOwnPosition(tx: Db, categoryId: string): Promise<number> {
  const last = await tx.categoryAttribute.findFirst({
    where: { categoryId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return last ? last.position + 1 : 0;
}

function canBeVariantAxis(inputType: string): boolean {
  return (VARIANT_AXIS_INPUT_TYPES as readonly string[]).includes(inputType);
}

/** Flags for a fresh own row: copy the effective entry when there is one, else the attribute's defaults. */
function defaultsFor(
  attribute: { inputType: string; isFilterableDefault: boolean; isVariantDefining: boolean },
  effective: EffectiveAttribute | undefined,
  position: number,
) {
  return {
    isRequired: effective?.isRequired ?? false,
    isFilterable: effective?.isFilterable ?? attribute.isFilterableDefault,
    isVariant: (effective?.isVariant ?? attribute.isVariantDefining) && canBeVariantAxis(attribute.inputType),
    showInSpecs: effective?.showInSpecs ?? true,
    inheritToChildren: true,
    isExcluded: false,
    position: effective && effective.source !== "global" ? effective.position : position,
  };
}

async function auditAttributeChange(
  tx: Db,
  actor: AuditActor,
  meta: ClientMeta,
  action: string,
  categoryId: string,
  summary: string,
  diff?: Prisma.InputJsonValue,
): Promise<void> {
  const category = await tx.category.findUnique({ where: { id: categoryId }, select: { name: true } });
  await writeAudit(tx, {
    actor,
    action,
    entityType: "Category",
    entityId: categoryId,
    entityLabel: category?.name ?? null,
    summary,
    diff,
    ...meta,
  });
}

/**
 * Flip one flag. An inherited or global entry has no row on this category, so
 * the first change creates an override row that copies every current flag and
 * then applies the one that changed (A2). From then on the row is "own".
 */
export async function setCategoryAttributeFlag(
  tx: Db,
  input: SetAttributeFlagInput,
  actor: AuditActor,
  meta: ClientMeta = {},
): Promise<OwnRow> {
  await requireCategory(tx, input.categoryId);
  const attribute = await requireAttribute(tx, input.attributeId);
  if (input.flag === "isVariant" && input.value && !canBeVariantAxis(attribute.inputType)) {
    throw validationError(
      { isVariant: "Only single-select and colour attributes can define variants." },
      `"${attribute.name}" cannot define variants: only single-select and colour attributes can (A5).`,
    );
  }

  let row = await ownRow(tx, input);
  let created = false;
  if (!row) {
    const effective = (await resolveCategoryAttributes(input.categoryId, tx)).find(
      (entry) => entry.attribute.id === input.attributeId,
    );
    if (!effective) {
      throw conflict(`"${attribute.name}" is not part of this category's attribute set. Add it first.`);
    }
    row = await tx.categoryAttribute.create({
      data: {
        categoryId: input.categoryId,
        attributeId: input.attributeId,
        ...defaultsFor(attribute, effective, await nextOwnPosition(tx, input.categoryId)),
      },
      select: OWN_ROW_SELECT,
    });
    created = true;
  }

  const before = row[input.flag];
  const after = await tx.categoryAttribute.update({
    where: { id: row.id },
    data: { [input.flag]: input.value },
    select: OWN_ROW_SELECT,
  });

  await queueSubtreeRecompute(tx, input.categoryId);
  await auditAttributeChange(
    tx,
    actor,
    meta,
    "category.attribute_flag",
    input.categoryId,
    `${created ? "Overrode" : "Changed"} "${attribute.name}": ${input.flag} ${before ? "on" : "off"} → ${input.value ? "on" : "off"}`,
    diffOf({ [input.flag]: before, override: !created }, { [input.flag]: input.value, override: true }),
  );
  return after;
}

/** Remove the attribute from this category and everything below it (A1 `isExcluded`). */
export async function excludeCategoryAttribute(
  tx: Db,
  ref: CategoryAttributeRef,
  actor: AuditActor,
  meta: ClientMeta = {},
): Promise<OwnRow> {
  await requireCategory(tx, ref.categoryId);
  const attribute = await requireAttribute(tx, ref.attributeId);
  const existing = await ownRow(tx, ref);

  let row: OwnRow;
  if (existing) {
    if (existing.isExcluded) return existing;
    row = await tx.categoryAttribute.update({
      where: { id: existing.id },
      data: { isExcluded: true },
      select: OWN_ROW_SELECT,
    });
  } else {
    const effective = (await resolveCategoryAttributes(ref.categoryId, tx)).find(
      (entry) => entry.attribute.id === ref.attributeId,
    );
    row = await tx.categoryAttribute.create({
      data: {
        categoryId: ref.categoryId,
        attributeId: ref.attributeId,
        ...defaultsFor(attribute, effective, await nextOwnPosition(tx, ref.categoryId)),
        isExcluded: true,
      },
      select: OWN_ROW_SELECT,
    });
  }

  await queueSubtreeRecompute(tx, ref.categoryId);
  await auditAttributeChange(
    tx,
    actor,
    meta,
    "category.attribute_exclude",
    ref.categoryId,
    `Excluded "${attribute.name}" from this category and its sub-categories`,
  );
  return row;
}

/**
 * Undo an exclusion. If an ancestor (or the global set) still provides the
 * attribute the own row is deleted so inheritance resumes; otherwise the row
 * stays as an own assignment with its flags. When the exclusion came from an
 * ancestor, a fresh own row re-adds the attribute at this level (A1: a deeper
 * row beats a shallower exclusion).
 */
export async function includeCategoryAttribute(
  tx: Db,
  ref: CategoryAttributeRef,
  actor: AuditActor,
  meta: ClientMeta = {},
): Promise<{ mode: "restored_inheritance" | "own" }> {
  const category = await requireCategory(tx, ref.categoryId);
  const attribute = await requireAttribute(tx, ref.attributeId);
  const existing = await ownRow(tx, ref);

  let mode: "restored_inheritance" | "own";
  if (existing) {
    if (!existing.isExcluded) return { mode: "own" };
    const fromAbove = (await resolveCategoryAttributes(category.parentId, tx)).some(
      (entry) => entry.attribute.id === ref.attributeId,
    );
    if (fromAbove) {
      await tx.categoryAttribute.delete({ where: { id: existing.id } });
      mode = "restored_inheritance";
    } else {
      await tx.categoryAttribute.update({ where: { id: existing.id }, data: { isExcluded: false } });
      mode = "own";
    }
  } else {
    const alreadyEffective = (await resolveCategoryAttributes(ref.categoryId, tx)).some(
      (entry) => entry.attribute.id === ref.attributeId,
    );
    if (alreadyEffective) throw conflict(`"${attribute.name}" is already part of this category's attribute set.`);
    await tx.categoryAttribute.create({
      data: {
        categoryId: ref.categoryId,
        attributeId: ref.attributeId,
        ...defaultsFor(attribute, undefined, await nextOwnPosition(tx, ref.categoryId)),
      },
    });
    mode = "own";
  }

  await queueSubtreeRecompute(tx, ref.categoryId);
  await auditAttributeChange(
    tx,
    actor,
    meta,
    "category.attribute_include",
    ref.categoryId,
    `Included "${attribute.name}" again${mode === "restored_inheritance" ? " (inherits from above)" : ""}`,
  );
  return { mode };
}

/** Assign an attribute directly to this category with the attribute's defaults. */
export async function addCategoryAttribute(
  tx: Db,
  ref: CategoryAttributeRef,
  actor: AuditActor,
  meta: ClientMeta = {},
): Promise<OwnRow> {
  await requireCategory(tx, ref.categoryId);
  const attribute = await requireAttribute(tx, ref.attributeId);
  if (!attribute.isActive) {
    throw validationError({ attributeId: `"${attribute.name}" is inactive. Activate it before assigning it.` });
  }

  const existing = await ownRow(tx, ref);
  let row: OwnRow;
  if (existing) {
    if (!existing.isExcluded) throw conflict(`"${attribute.name}" is already assigned to this category.`);
    row = await tx.categoryAttribute.update({
      where: { id: existing.id },
      data: { isExcluded: false },
      select: OWN_ROW_SELECT,
    });
  } else {
    const effective = (await resolveCategoryAttributes(ref.categoryId, tx)).find(
      (entry) => entry.attribute.id === ref.attributeId,
    );
    row = await tx.categoryAttribute.create({
      data: {
        categoryId: ref.categoryId,
        attributeId: ref.attributeId,
        ...defaultsFor(attribute, effective, await nextOwnPosition(tx, ref.categoryId)),
      },
      select: OWN_ROW_SELECT,
    });
  }

  await queueSubtreeRecompute(tx, ref.categoryId);
  await auditAttributeChange(
    tx,
    actor,
    meta,
    "category.attribute_add",
    ref.categoryId,
    `Assigned attribute "${attribute.name}" (${attribute.code})`,
    diffOf(null, { ...row }),
  );
  return row;
}

/** Product values recorded for an attribute anywhere under a category (kept on removal, §11.3). */
export async function countProductValuesInSubtree(
  tx: Db | undefined,
  categoryId: string,
  attributeId: string,
): Promise<{ products: number; variants: number }> {
  const client = tx ?? db;
  const category = await client.category.findUnique({ where: { id: categoryId }, select: { path: true } });
  if (!category) return { products: 0, variants: 0 };
  const productWhere = { deletedAt: null, ...subtreeProductWhere(category.path) };
  const [products, variants] = await Promise.all([
    client.product.count({ where: { ...productWhere, attributeValues: { some: { attributeId, fromVariants: false } } } }),
    client.productVariant.count({
      where: { deletedAt: null, product: productWhere, attributeValues: { some: { attributeId } } },
    }),
  ]);
  return { products, variants };
}

export type RemoveOwnAttributeResult = {
  attributeName: string;
  /** Values on products stay; this is what the warning quoted. */
  productValues: { products: number; variants: number };
  /** True when an ancestor or the global set still supplies the attribute. */
  stillEffective: boolean;
};

export async function removeOwnCategoryAttribute(
  tx: Db,
  ref: CategoryAttributeRef,
  actor: AuditActor,
  meta: ClientMeta = {},
): Promise<RemoveOwnAttributeResult> {
  const category = await requireCategory(tx, ref.categoryId);
  const attribute = await requireAttribute(tx, ref.attributeId);
  const existing = await ownRow(tx, ref);
  if (!existing) throw conflict(`"${attribute.name}" has no assignment on this category to remove.`);

  const productValues = await countProductValuesInSubtree(tx, ref.categoryId, ref.attributeId);
  await tx.categoryAttribute.delete({ where: { id: existing.id } });

  const stillEffective = (await resolveCategoryAttributes(category.parentId, tx)).some(
    (entry) => entry.attribute.id === ref.attributeId,
  );

  await queueSubtreeRecompute(tx, ref.categoryId);
  await auditAttributeChange(
    tx,
    actor,
    meta,
    "category.attribute_remove",
    ref.categoryId,
    `Removed own assignment of "${attribute.name}" (${productValues.products} product value(s) kept)`,
    diffOf({ ...existing }, null),
  );
  return { attributeName: attribute.name, productValues, stillEffective };
}

export async function reorderOwnCategoryAttributes(
  tx: Db,
  categoryId: string,
  attributeIds: readonly string[],
  actor: AuditActor,
  meta: ClientMeta = {},
): Promise<{ updated: number }> {
  await requireCategory(tx, categoryId);
  const rows = await tx.categoryAttribute.findMany({
    where: { categoryId },
    orderBy: { position: "asc" },
    select: { id: true, attributeId: true, position: true },
  });
  const known = new Set(rows.map((row) => row.attributeId));
  const ordered = attributeIds.filter((id) => known.has(id));
  const remainder = rows.map((row) => row.attributeId).filter((id) => !ordered.includes(id));
  const finalOrder = [...new Set([...ordered, ...remainder])];

  let updated = 0;
  for (const [index, attributeId] of finalOrder.entries()) {
    const row = rows.find((entry) => entry.attributeId === attributeId);
    if (!row || row.position === index) continue;
    await tx.categoryAttribute.update({ where: { id: row.id }, data: { position: index } });
    updated += 1;
  }

  if (updated > 0) {
    await auditAttributeChange(
      tx,
      actor,
      meta,
      "category.attribute_reorder",
      categoryId,
      `Reordered ${finalOrder.length} attribute assignment(s)`,
    );
  }
  return { updated };
}

/** `PUT /categories/:id/attributes`: the given rows become the category's own rows, nothing else survives. */
export async function replaceOwnCategoryAttributes(
  tx: Db,
  categoryId: string,
  rows: readonly CategoryAttributeRowInput[],
  actor: AuditActor,
  meta: ClientMeta = {},
): Promise<{ rows: OwnRow[] }> {
  await requireCategory(tx, categoryId);

  const ids = [...new Set(rows.map((row) => row.attributeId))];
  if (ids.length !== rows.length) throw validationError({ rows: "Each attribute may appear only once." });
  const attributes = await tx.attribute.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, inputType: true },
  });
  const byId = new Map(attributes.map((attribute) => [attribute.id, attribute]));
  for (const row of rows) {
    const attribute = byId.get(row.attributeId);
    if (!attribute) throw validationError({ rows: `Unknown attribute ${row.attributeId}.` });
    if (row.isVariant && !canBeVariantAxis(attribute.inputType)) {
      throw validationError({ rows: `"${attribute.name}" cannot define variants (only single-select and colour attributes can).` });
    }
  }

  const before = await tx.categoryAttribute.findMany({ where: { categoryId }, select: OWN_ROW_SELECT });
  await tx.categoryAttribute.deleteMany({ where: { categoryId, attributeId: { notIn: ids } } });
  const result: OwnRow[] = [];
  for (const row of rows) {
    const { attributeId, ...flags } = row;
    result.push(
      await tx.categoryAttribute.upsert({
        where: { categoryId_attributeId: { categoryId, attributeId } },
        update: flags,
        create: { categoryId, attributeId, ...flags },
        select: OWN_ROW_SELECT,
      }),
    );
  }

  await queueSubtreeRecompute(tx, categoryId);
  await auditAttributeChange(
    tx,
    actor,
    meta,
    "category.attribute_replace",
    categoryId,
    `Replaced attribute assignments (${before.length} → ${rows.length} rows)`,
    diffOf({ rows: before }, { rows: result }),
  );
  return { rows: result };
}

