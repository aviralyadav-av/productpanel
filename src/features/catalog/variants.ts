import type { Prisma } from "@prisma/client";

import { ensureInventoryItem } from "@/features/inventory/service";
import {
  effectiveById,
  resolveForProduct,
  type EffectiveAttribute,
} from "./attribute-resolution";
import { recomputeProductFacets } from "./facets";
import { recomputeProductPricing } from "./pricing";

/**
 * Variant generation (blueprint §14.A5).
 *
 * Variants are the cartesian product of the chosen axes, identified by an
 * `optionKey` that is independent of display order ("attrId:valueId" pairs
 * sorted and joined by "|"). Re-generating with different axes is therefore an
 * UPSERT: combinations that already exist keep their SKU, price, stock and
 * images; combinations that disappear are deactivated rather than deleted,
 * because an order line may still point at them.
 */

type Db = Prisma.TransactionClient;

export class VariantError extends Error {
  constructor(
    public readonly code:
      | "PRODUCT_NOT_FOUND"
      | "NO_AXES"
      | "AXIS_NOT_VARIANT"
      | "AXIS_INPUT_TYPE"
      | "AXIS_VALUES"
      | "TOO_MANY",
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "VariantError";
  }
}

export type VariantAxis = { attributeId: string; valueIds: string[] };

/** The cap keeps a mis-click from creating hundreds of inventory rows. */
export const MAX_GENERATED_VARIANTS = 200;

export function variantOptionKey(pairs: ReadonlyArray<{ attributeId: string; valueId: string }>): string {
  return pairs
    .map((pair) => `${pair.attributeId}:${pair.valueId}`)
    .sort()
    .join("|");
}

/**
 * Axes may only use attributes that are SELECT/COLOR and marked isVariant in
 * the product's effective set, with values that belong to the attribute.
 * Returns the axes in effective-set order with duplicates removed.
 */
export function validateAxes(
  axes: readonly VariantAxis[],
  effective: readonly EffectiveAttribute[],
): Array<{ entry: EffectiveAttribute; valueIds: string[] }> {
  if (axes.length === 0) throw new VariantError("NO_AXES", "Choose at least one attribute to generate variants from.");
  const byId = effectiveById(effective);
  const seen = new Set<string>();
  const validated: Array<{ entry: EffectiveAttribute; valueIds: string[] }> = [];

  for (const axis of axes) {
    if (seen.has(axis.attributeId)) continue;
    seen.add(axis.attributeId);

    const entry = byId.get(axis.attributeId);
    if (!entry || !entry.isVariant) {
      throw new VariantError("AXIS_NOT_VARIANT", "That attribute is not a variant attribute for this category.", {
        attributeId: axis.attributeId,
      });
    }
    if (!["SELECT", "COLOR"].includes(entry.attribute.inputType)) {
      throw new VariantError("AXIS_INPUT_TYPE", `${entry.attribute.name} is not a select or colour attribute.`, {
        attributeId: axis.attributeId,
      });
    }
    const known = new Set(entry.values.map((value) => value.id));
    const valueIds = [...new Set(axis.valueIds)].filter((id) => known.has(id));
    if (valueIds.length === 0 || valueIds.length !== new Set(axis.valueIds).size) {
      throw new VariantError("AXIS_VALUES", `Choose valid values for ${entry.attribute.name}.`, {
        attributeId: axis.attributeId,
      });
    }
    validated.push({ entry, valueIds });
  }

  const combinations = validated.reduce((count, axis) => count * axis.valueIds.length, 1);
  if (combinations > MAX_GENERATED_VARIANTS) {
    throw new VariantError("TOO_MANY", `That would create ${combinations} variants; the limit is ${MAX_GENERATED_VARIANTS}.`, {
      combinations,
    });
  }

  return validated.sort((x, y) => x.entry.position - y.entry.position);
}

function cartesian<T>(lists: readonly (readonly T[])[]): T[][] {
  return lists.reduce<T[][]>((acc, list) => acc.flatMap((prefix) => list.map((item) => [...prefix, item])), [[]]);
}

export type GenerateVariantsResult = {
  created: number;
  kept: number;
  deactivated: number;
  variantIds: string[];
};

export async function generateVariants(
  tx: Db,
  input: { productId: string; axes: readonly VariantAxis[]; actorId?: string | null },
): Promise<GenerateVariantsResult> {
  const product = await tx.product.findUnique({
    where: { id: input.productId },
    select: {
      id: true,
      variants: {
        where: { deletedAt: null },
        select: { id: true, name: true, optionKey: true, isActive: true, isDefault: true, position: true },
      },
    },
  });
  if (!product) throw new VariantError("PRODUCT_NOT_FOUND", "Product not found.");

  const effective = await resolveForProduct(input.productId, tx);
  const axes = validateAxes(input.axes, effective);

  const labelOf = new Map<string, string>();
  for (const axis of axes) {
    for (const value of axis.entry.values) labelOf.set(value.id, value.label ?? value.value);
  }

  const combos = cartesian(
    axes.map((axis) => axis.valueIds.map((valueId) => ({ attributeId: axis.entry.attribute.id, valueId }))),
  ).map((pairs) => ({
    pairs,
    optionKey: variantOptionKey(pairs),
    name: pairs.map((pair) => labelOf.get(pair.valueId) ?? pair.valueId).join(" / "),
  }));

  const byKey = new Map(product.variants.filter((v) => v.optionKey).map((v) => [v.optionKey as string, v]));
  const byName = new Map(product.variants.map((v) => [v.name, v]));
  const wantedKeys = new Set(combos.map((combo) => combo.optionKey));
  const hasDefault = product.variants.some((variant) => variant.isDefault && wantedKeys.has(variant.optionKey ?? ""));

  let created = 0;
  let kept = 0;
  const variantIds: string[] = [];
  let position = product.variants.reduce((max, variant) => Math.max(max, variant.position), -1) + 1;

  for (const [index, combo] of combos.entries()) {
    const existing = byKey.get(combo.optionKey);
    if (existing) {
      // Present again: keep everything, just make sure it is live.
      if (!existing.isActive) {
        await tx.productVariant.update({ where: { id: existing.id }, data: { isActive: true } });
      }
      kept += 1;
      variantIds.push(existing.id);
      continue;
    }

    // A legacy variant with this exact name and no key adopts the key instead
    // of colliding on @@unique([productId, name]).
    const sameName = byName.get(combo.name);
    if (sameName && !sameName.optionKey) {
      await tx.productVariant.update({
        where: { id: sameName.id },
        data: { optionKey: combo.optionKey, isActive: true },
      });
      await tx.variantAttributeValue.deleteMany({ where: { variantId: sameName.id } });
      await tx.variantAttributeValue.createMany({
        data: combo.pairs.map((pair) => ({ variantId: sameName.id, ...pair })),
      });
      await ensureInventoryItem(tx, sameName.id, { actorId: input.actorId });
      byKey.set(combo.optionKey, { ...sameName, optionKey: combo.optionKey });
      kept += 1;
      variantIds.push(sameName.id);
      continue;
    }

    const name = sameName ? `${combo.name} (${index + 1})` : combo.name;
    const variant = await tx.productVariant.create({
      data: {
        productId: input.productId,
        name,
        optionKey: combo.optionKey,
        position: position++,
        isActive: true,
        isDefault: !hasDefault && created === 0 && kept === 0,
        attributeValues: { create: combo.pairs },
      },
      select: { id: true },
    });
    await ensureInventoryItem(tx, variant.id, { actorId: input.actorId });
    created += 1;
    variantIds.push(variant.id);
  }

  // Everything else the product had is no longer a valid combination.
  const stale = await tx.productVariant.updateMany({
    where: { productId: input.productId, deletedAt: null, isActive: true, id: { notIn: variantIds } },
    data: { isActive: false, isDefault: false },
  });

  // Make sure exactly one live default exists.
  const liveDefault = await tx.productVariant.count({
    where: { productId: input.productId, isActive: true, isDefault: true, deletedAt: null },
  });
  if (liveDefault === 0 && variantIds.length > 0) {
    await tx.productVariant.update({ where: { id: variantIds[0] }, data: { isDefault: true } });
  }

  await recomputeProductFacets(tx, input.productId);
  await recomputeProductPricing(tx, { productIds: [input.productId] });

  return { created, kept, deactivated: stale.count, variantIds };
}

/** Re-derive optionKey/name for a variant whose attribute values were edited by hand. */
export async function syncVariantOptionKey(tx: Db, variantId: string): Promise<string | null> {
  const values = await tx.variantAttributeValue.findMany({
    where: { variantId },
    select: { attributeId: true, valueId: true },
  });
  const optionKey = values.length > 0 ? variantOptionKey(values) : null;
  await tx.productVariant.update({ where: { id: variantId }, data: { optionKey } });
  return optionKey;
}
