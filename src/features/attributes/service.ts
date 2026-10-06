import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { conflict, notFound, validationError } from "@/lib/api/errors";
import { diffOf, writeAudit, type AuditActor } from "@/lib/audit";
import { enqueue } from "@/lib/queue";

import { hasValueList, isAttributeInputType } from "./compat";
import {
  valueTokenFromLabel,
  type AttributePatch,
  type AttributeValuePatch,
  type AttributeValueValues,
  type AttributeValues,
} from "./schemas";

/**
 * Attribute definitions and their values (blueprint §1 Attributes, §11.3-4,
 * A1, A2, A5). Same shape as the categories service: the caller owns the
 * transaction, audit rows are written inside it (D13), nothing here imports
 * `server-only` or `next/*`.
 *
 * The rules that matter:
 *   - `code` is immutable: it is the public filter key (`attr[color]=`).
 *   - `inputType` cannot change once values exist on products or variants -
 *     a NUMBER cannot become a SELECT without losing what was typed.
 *   - `isVariantDefining` cannot be switched off while variants use the
 *     attribute (§11.4); those variants would lose their axis.
 *   - delete is refused while ANY usage exists; the usage list is returned
 *     so the operator knows what to detach first (A2).
 */

type Db = Prisma.TransactionClient;

export type ClientMeta = { ip?: string | null; userAgent?: string | null };

const ATTRIBUTE_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  inputType: true,
  filterType: true,
  unit: true,
  isVariantDefining: true,
  isFilterableDefault: true,
  isGlobal: true,
  position: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AttributeSelect;

export type AttributeRecord = Prisma.AttributeGetPayload<{ select: typeof ATTRIBUTE_SELECT }>;

const VALUE_SELECT = {
  id: true,
  attributeId: true,
  value: true,
  label: true,
  colorHex: true,
  position: true,
  isActive: true,
} satisfies Prisma.AttributeValueSelect;

export type AttributeValueRecord = Prisma.AttributeValueGetPayload<{ select: typeof VALUE_SELECT }>;

export async function getAttributeRecord(tx: Db | undefined, id: string): Promise<AttributeRecord | null> {
  return (tx ?? db).attribute.findUnique({ where: { id }, select: ATTRIBUTE_SELECT });
}

async function requireAttribute(tx: Db, id: string): Promise<AttributeRecord> {
  const attribute = await getAttributeRecord(tx, id);
  if (!attribute) throw notFound("Attribute");
  return attribute;
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

export type AttributeUsage = {
  categories: Array<{ id: string; name: string; path: string; isExcluded: boolean }>;
  /** Distinct live products carrying a value (typed or via variants). */
  products: number;
  /** Live variants with a value for this attribute. */
  variants: number;
  total: number;
};

export async function attributeUsage(tx: Db | undefined, attributeId: string): Promise<AttributeUsage> {
  const client = tx ?? db;
  const [rows, productGroups, variants] = await Promise.all([
    client.categoryAttribute.findMany({
      where: { attributeId },
      select: { isExcluded: true, category: { select: { id: true, name: true, path: true } } },
      orderBy: { category: { path: "asc" } },
    }),
    client.productAttributeValue.groupBy({
      by: ["productId"],
      where: { attributeId, product: { deletedAt: null } },
    }),
    client.variantAttributeValue.count({ where: { attributeId, variant: { deletedAt: null } } }),
  ]);
  const categories = rows.map((row) => ({ ...row.category, isExcluded: row.isExcluded }));
  return { categories, products: productGroups.length, variants, total: categories.length + productGroups.length + variants };
}

/** Per-value usage for the Values panel and the delete guard. */
export async function valueUsage(tx: Db | undefined, valueId: string): Promise<{ products: number; variants: number }> {
  const client = tx ?? db;
  const [products, variants] = await Promise.all([
    client.productAttributeValue.count({ where: { valueId, product: { deletedAt: null } } }),
    client.variantAttributeValue.count({ where: { valueId, variant: { deletedAt: null } } }),
  ]);
  return { products, variants };
}

/**
 * Anything that changes what a filter means (type, active state, a value's
 * token or active flag) queues one facet recompute for the products that
 * carry the attribute; deduped so a burst of edits runs once.
 */
async function queueProductRecompute(tx: Db, attributeId: string): Promise<number> {
  const rows = await tx.productAttributeValue.findMany({
    where: { attributeId, product: { deletedAt: null } },
    select: { productId: true },
    distinct: ["productId"],
  });
  if (rows.length === 0) return 0;
  await enqueue(
    "catalog.recompute_subtree",
    { productIds: rows.map((row) => row.productId) },
    { tx, dedupeKey: `catalog.recompute_subtree:attribute:${attributeId}` },
  );
  return rows.length;
}

// ---------------------------------------------------------------------------
// Attribute CRUD
// ---------------------------------------------------------------------------

async function assertCodeFree(tx: Db, code: string): Promise<void> {
  const existing = await tx.attribute.findUnique({ where: { code }, select: { id: true } });
  if (existing) throw validationError({ code: "Another attribute already uses this code." }, "That code is already in use.");
}

export async function createAttribute(tx: Db, input: AttributeValues, actor: AuditActor, meta: ClientMeta = {}): Promise<AttributeRecord> {
  await assertCodeFree(tx, input.code);
  const created = await tx.attribute.create({
    data: {
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      inputType: input.inputType,
      filterType: input.filterType,
      unit: input.unit ?? null,
      isVariantDefining: input.isVariantDefining,
      isFilterableDefault: input.isFilterableDefault,
      isGlobal: input.isGlobal,
      position: input.position,
      isActive: input.isActive,
    },
    select: ATTRIBUTE_SELECT,
  });
  await writeAudit(tx, {
    actor,
    action: "attribute.create",
    entityType: "Attribute",
    entityId: created.id,
    entityLabel: created.name,
    summary: `Created attribute "${created.name}" (${created.code}, ${created.inputType})${created.isGlobal ? " - global" : ""}`,
    diff: diffOf(null, { ...created }),
    ...meta,
  });
  return created;
}

export type UpdateAttributeResult = { attribute: AttributeRecord; recomputeQueued: number };

export async function updateAttribute(
  tx: Db,
  id: string,
  patch: AttributePatch,
  actor: AuditActor,
  meta: ClientMeta = {},
): Promise<UpdateAttributeResult> {
  const before = await requireAttribute(tx, id);

  if (patch.code !== undefined && patch.code !== before.code) {
    throw validationError(
      { code: "The code cannot change after creation; it is the storefront's filter key." },
      "The attribute code is immutable.",
    );
  }

  const inputType = patch.inputType ?? before.inputType;
  const usage = await attributeUsage(tx, id);
  if (inputType !== before.inputType && (usage.products > 0 || usage.variants > 0)) {
    throw conflict(
      `"${before.name}" has values on ${usage.products} product(s) and ${usage.variants} variant(s); its input type cannot change until those are removed.`,
      { inputType: "Remove the recorded values first." },
    );
  }
  if (inputType !== before.inputType && isAttributeInputType(inputType) && !hasValueList(inputType)) {
    const valueCount = await tx.attributeValue.count({ where: { attributeId: id } });
    if (valueCount > 0) {
      throw conflict(`"${before.name}" has ${valueCount} predefined value(s); delete them before switching to ${inputType}.`, {
        inputType: "Delete the value list first.",
      });
    }
  }

  const isVariantDefining = patch.isVariantDefining ?? before.isVariantDefining;
  if (before.isVariantDefining && !isVariantDefining && usage.variants > 0) {
    throw conflict(
      `"${before.name}" defines ${usage.variants} variant(s). Remove or remap those variants before turning variant-defining off (§11.4).`,
      { isVariantDefining: "Variants still use this attribute." },
    );
  }

  const after = await tx.attribute.update({
    where: { id },
    data: {
      name: patch.name ?? before.name,
      description: patch.description !== undefined ? patch.description : before.description,
      inputType,
      filterType: patch.filterType ?? before.filterType,
      unit: patch.unit !== undefined ? patch.unit : before.unit,
      isVariantDefining,
      isFilterableDefault: patch.isFilterableDefault ?? before.isFilterableDefault,
      isGlobal: patch.isGlobal ?? before.isGlobal,
      position: patch.position ?? before.position,
      isActive: patch.isActive ?? before.isActive,
    },
    select: ATTRIBUTE_SELECT,
  });

  // Filters change meaning when the type, filter widget, global flag or
  // active state moves; a rename does not.
  const structural =
    after.inputType !== before.inputType ||
    after.filterType !== before.filterType ||
    after.isGlobal !== before.isGlobal ||
    after.isActive !== before.isActive ||
    after.isFilterableDefault !== before.isFilterableDefault;
  const recomputeQueued = structural ? await queueProductRecompute(tx, id) : 0;

  await writeAudit(tx, {
    actor,
    action: "attribute.update",
    entityType: "Attribute",
    entityId: id,
    entityLabel: after.name,
    summary: `Updated attribute "${after.name}"`,
    diff: diffOf({ ...before }, { ...after }),
    ...meta,
  });
  return { attribute: after, recomputeQueued };
}

export async function setAttributeActive(tx: Db, id: string, value: boolean, actor: AuditActor, meta: ClientMeta = {}): Promise<AttributeRecord> {
  const before = await requireAttribute(tx, id);
  if (before.isActive === value) return before;
  const after = await tx.attribute.update({ where: { id }, data: { isActive: value }, select: ATTRIBUTE_SELECT });
  await queueProductRecompute(tx, id);
  await writeAudit(tx, {
    actor,
    action: "attribute.status_change",
    entityType: "Attribute",
    entityId: id,
    entityLabel: after.name,
    summary: `${value ? "Activated" : "Deactivated"} attribute "${after.name}"`,
    diff: diffOf({ isActive: before.isActive }, { isActive: value }),
    ...meta,
  });
  return after;
}

export type DeleteAttributeResult = { deleted: true; name: string } | { deleted: false; name: string; usage: AttributeUsage };

export async function deleteAttribute(tx: Db, id: string, actor: AuditActor, meta: ClientMeta = {}): Promise<DeleteAttributeResult> {
  const attribute = await requireAttribute(tx, id);
  const usage = await attributeUsage(tx, id);
  if (usage.total > 0) return { deleted: false, name: attribute.name, usage };

  // Values cascade with the attribute (schema onDelete: Cascade); nothing else references it.
  await tx.attribute.delete({ where: { id } });
  await writeAudit(tx, {
    actor,
    action: "attribute.delete",
    entityType: "Attribute",
    entityId: id,
    entityLabel: attribute.name,
    summary: `Deleted unused attribute "${attribute.name}" (${attribute.code})`,
    diff: diffOf({ ...attribute }, null),
    ...meta,
  });
  return { deleted: true, name: attribute.name };
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

async function requireValue(tx: Db, attributeId: string, valueId: string): Promise<AttributeValueRecord> {
  const value = await tx.attributeValue.findUnique({ where: { id: valueId }, select: VALUE_SELECT });
  if (!value || value.attributeId !== attributeId) throw notFound("Attribute value");
  return value;
}

async function assertValueTokenFree(tx: Db, attributeId: string, token: string, exceptId?: string): Promise<void> {
  const existing = await tx.attributeValue.findUnique({
    where: { attributeId_value: { attributeId, value: token } },
    select: { id: true },
  });
  if (existing && existing.id !== exceptId) {
    throw validationError({ value: `"${token}" already exists on this attribute.` }, "That value already exists.");
  }
}

async function auditValueChange(tx: Db, actor: AuditActor, meta: ClientMeta, attribute: AttributeRecord, action: string, summary: string, diff?: Prisma.InputJsonValue) {
  await writeAudit(tx, {
    actor,
    action,
    entityType: "Attribute",
    entityId: attribute.id,
    entityLabel: attribute.name,
    summary,
    diff,
    ...meta,
  });
}

export async function addAttributeValue(
  tx: Db,
  attributeId: string,
  input: AttributeValueValues,
  actor: AuditActor,
  meta: ClientMeta = {},
): Promise<AttributeValueRecord> {
  const attribute = await requireAttribute(tx, attributeId);
  if (!isAttributeInputType(attribute.inputType) || !hasValueList(attribute.inputType)) {
    throw conflict(`"${attribute.name}" is a ${attribute.inputType} attribute; it does not have a predefined value list.`);
  }
  if (attribute.inputType === "COLOR" && !input.colorHex) {
    throw validationError({ colorHex: "Colour values need a swatch colour." });
  }

  const token = input.value ?? valueTokenFromLabel(input.label);
  await assertValueTokenFree(tx, attributeId, token);
  const last = await tx.attributeValue.findFirst({ where: { attributeId }, orderBy: { position: "desc" }, select: { position: true } });

  const created = await tx.attributeValue.create({
    data: {
      attributeId,
      value: token,
      label: input.label,
      colorHex: input.colorHex ?? null,
      position: input.position ?? (last ? last.position + 1 : 0),
      isActive: input.isActive,
    },
    select: VALUE_SELECT,
  });
  await auditValueChange(tx, actor, meta, attribute, "attribute.value_add", `Added value "${created.label}" (${created.value}) to "${attribute.name}"`, diffOf(null, { ...created }));
  return created;
}

export async function updateAttributeValue(
  tx: Db,
  attributeId: string,
  valueId: string,
  patch: AttributeValuePatch,
  actor: AuditActor,
  meta: ClientMeta = {},
): Promise<{ value: AttributeValueRecord; recomputeQueued: number }> {
  const attribute = await requireAttribute(tx, attributeId);
  const before = await requireValue(tx, attributeId, valueId);

  const token = patch.value ?? before.value;
  if (token !== before.value) await assertValueTokenFree(tx, attributeId, token, valueId);
  if (attribute.inputType === "COLOR" && patch.colorHex === null) {
    throw validationError({ colorHex: "Colour values need a swatch colour." });
  }

  const after = await tx.attributeValue.update({
    where: { id: valueId },
    data: {
      value: token,
      label: patch.label ?? before.label,
      colorHex: patch.colorHex !== undefined ? patch.colorHex : before.colorHex,
      position: patch.position ?? before.position,
      isActive: patch.isActive ?? before.isActive,
    },
    select: VALUE_SELECT,
  });

  // Deactivating a value hides it from facets; products keep the row.
  const recomputeQueued = after.isActive !== before.isActive ? await queueProductRecompute(tx, attributeId) : 0;

  await auditValueChange(tx, actor, meta, attribute, "attribute.value_update", `Updated value "${after.label ?? after.value}" on "${attribute.name}"`, diffOf({ ...before }, { ...after }));
  return { value: after, recomputeQueued };
}

export type DeleteValueResult = { deleted: true } | { deleted: false; usage: { products: number; variants: number } };

export async function deleteAttributeValue(tx: Db, attributeId: string, valueId: string, actor: AuditActor, meta: ClientMeta = {}): Promise<DeleteValueResult> {
  const attribute = await requireAttribute(tx, attributeId);
  const value = await requireValue(tx, attributeId, valueId);
  const usage = await valueUsage(tx, valueId);
  if (usage.products > 0 || usage.variants > 0) return { deleted: false, usage };

  await tx.attributeValue.delete({ where: { id: valueId } });
  await auditValueChange(tx, actor, meta, attribute, "attribute.value_delete", `Deleted unused value "${value.label ?? value.value}" from "${attribute.name}"`, diffOf({ ...value }, null));
  return { deleted: true };
}

export async function reorderAttributeValues(
  tx: Db,
  attributeId: string,
  valueIds: readonly string[],
  actor: AuditActor,
  meta: ClientMeta = {},
): Promise<{ updated: number }> {
  const attribute = await requireAttribute(tx, attributeId);
  const rows = await tx.attributeValue.findMany({ where: { attributeId }, orderBy: { position: "asc" }, select: { id: true, position: true } });
  const known = new Set(rows.map((row) => row.id));
  const ordered = valueIds.filter((id) => known.has(id));
  const remainder = rows.map((row) => row.id).filter((id) => !ordered.includes(id));
  const finalOrder = [...new Set([...ordered, ...remainder])];

  let updated = 0;
  for (const [index, id] of finalOrder.entries()) {
    const row = rows.find((entry) => entry.id === id);
    if (!row || row.position === index) continue;
    await tx.attributeValue.update({ where: { id }, data: { position: index } });
    updated += 1;
  }
  if (updated > 0) {
    await auditValueChange(tx, actor, meta, attribute, "attribute.value_reorder", `Reordered ${finalOrder.length} value(s) on "${attribute.name}"`);
  }
  return { updated };
}
