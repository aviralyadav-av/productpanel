import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import {
  isSelectType,
  resolveCategoryAttributes,
  resolveForProduct,
  type EffectiveAttribute,
} from "./attribute-resolution";

/**
 * Publish gate and category-change report (blueprint §11.5, §14.A6).
 *
 * A DRAFT may be as incomplete as the operator likes; PUBLISHED is a promise to
 * the storefront that the product can be shown, priced, filtered and bought.
 * Every rule below guards one of those verbs. The result lists ALL problems at
 * once so the editor can show them together instead of one per save attempt.
 */

type Db = Prisma.TransactionClient;

export type PublishProblemCode =
  | "NOT_FOUND"
  | "NO_IMAGE"
  | "PRICE_NOT_POSITIVE"
  | "SALE_PRICE_NOT_BELOW_PRICE"
  | "SALE_WINDOW_INVALID"
  | "NO_CATEGORY"
  | "CATEGORY_INACTIVE"
  | "MISSING_REQUIRED_ATTRIBUTE"
  | "SELLER_NOT_ACTIVE"
  | "NO_ACTIVE_VARIANT"
  | "VARIANT_WITHOUT_INVENTORY"
  | "NO_TITLE"
  | "NO_SLUG";

export type PublishProblem = {
  code: PublishProblemCode;
  message: string;
  /** Set for attribute problems so the editor can focus the field. */
  attributeId?: string;
  attributeCode?: string;
};

export type PublishValidation = { ok: boolean; problems: PublishProblem[] };

type ValueRow = {
  attributeId: string;
  valueId: string | null;
  textValue: string | null;
  numberValue: number | null;
  boolValue: boolean | null;
};

/** Does the product hold a usable value for this attribute (own or via variants)? */
function hasValue(entry: EffectiveAttribute, values: readonly ValueRow[]): boolean {
  const mine = values.filter((row) => row.attributeId === entry.attribute.id);
  if (mine.length === 0) return false;
  if (isSelectType(entry.attribute.inputType)) return mine.some((row) => row.valueId !== null);
  switch (entry.attribute.inputType) {
    case "NUMBER":
      return mine.some((row) => row.numberValue !== null);
    case "BOOLEAN":
      return mine.some((row) => row.boolValue !== null);
    default:
      return mine.some((row) => (row.textValue ?? "").trim().length > 0);
  }
}

export async function validateProductForPublish(
  tx: Db | undefined,
  productId: string,
): Promise<PublishValidation> {
  const client = tx ?? db;
  const product = await client.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      title: true,
      slug: true,
      pricePaise: true,
      salePricePaise: true,
      saleStartsAt: true,
      saleEndsAt: true,
      categoryId: true,
      category: { select: { isActive: true, name: true } },
      seller: { select: { status: true, displayName: true, deletedAt: true } },
      images: { select: { id: true }, take: 1 },
      attributeValues: {
        select: { attributeId: true, valueId: true, textValue: true, numberValue: true, boolValue: true },
      },
      variants: {
        where: { isActive: true, deletedAt: null },
        select: { id: true, name: true, inventory: { select: { id: true } } },
      },
    },
  });

  if (!product) {
    return { ok: false, problems: [{ code: "NOT_FOUND", message: "This product no longer exists." }] };
  }

  const problems: PublishProblem[] = [];

  if (!product.title.trim()) problems.push({ code: "NO_TITLE", message: "Give the product a title." });
  if (!product.slug.trim()) problems.push({ code: "NO_SLUG", message: "The product needs a URL slug." });
  if (product.images.length === 0) problems.push({ code: "NO_IMAGE", message: "Add at least one image." });

  if (product.pricePaise <= 0) {
    problems.push({ code: "PRICE_NOT_POSITIVE", message: "The price must be greater than zero." });
  }
  if (product.salePricePaise !== null && product.salePricePaise >= product.pricePaise) {
    problems.push({ code: "SALE_PRICE_NOT_BELOW_PRICE", message: "The sale price must be lower than the price." });
  }
  if (product.saleStartsAt && product.saleEndsAt && product.saleEndsAt < product.saleStartsAt) {
    problems.push({ code: "SALE_WINDOW_INVALID", message: "The sale must end after it starts." });
  }

  if (!product.categoryId) {
    problems.push({ code: "NO_CATEGORY", message: "Choose a category." });
  } else if (product.category && !product.category.isActive) {
    problems.push({ code: "CATEGORY_INACTIVE", message: `${product.category.name} is inactive; pick another category.` });
  }

  if (product.seller && (product.seller.status !== "ACTIVE" || product.seller.deletedAt)) {
    problems.push({
      code: "SELLER_NOT_ACTIVE",
      message: `${product.seller.displayName} is ${product.seller.deletedAt ? "deleted" : product.seller.status.toLowerCase().replace("_", " ")}; only active sellers' products can be published.`,
    });
  }

  if (product.variants.length === 0) {
    problems.push({ code: "NO_ACTIVE_VARIANT", message: "The product needs at least one active variant." });
  }
  for (const variant of product.variants) {
    if (!variant.inventory) {
      problems.push({
        code: "VARIANT_WITHOUT_INVENTORY",
        message: `Variant "${variant.name}" has no inventory record. Open it in Inventory once to create one.`,
      });
    }
  }

  const effective = await resolveForProduct(productId, tx);
  for (const entry of effective) {
    if (entry.isRequired && !hasValue(entry, product.attributeValues)) {
      problems.push({
        code: "MISSING_REQUIRED_ATTRIBUTE",
        message: `${entry.attribute.name} is required for this category.`,
        attributeId: entry.attribute.id,
        attributeCode: entry.attribute.code,
      });
    }
  }

  return { ok: problems.length === 0, problems };
}

export type CategoryChangeReport = {
  /** Attributes with values on the product that the new category does not use. */
  orphanAttributes: Array<{ attributeId: string; code: string; name: string; valueCount: number; fromVariants: boolean }>;
  /** Required in the new category but unfilled on the product. */
  missingRequired: Array<{ attributeId: string; code: string; name: string }>;
  /** Variant axes the new category does not treat as variant attributes (§11.4). */
  variantAxesLost: Array<{ attributeId: string; code: string; name: string }>;
};

/**
 * What would change if the product moved to `newCategoryId`. Nothing is
 * modified: the editor shows this before the operator confirms, and the
 * product service keeps every value on save (A6) so nothing is lost silently.
 */
export async function categoryChangeReport(
  tx: Db | undefined,
  input: { productId: string; newCategoryId: string | null },
): Promise<CategoryChangeReport> {
  const client = tx ?? db;
  const [product, next] = await Promise.all([
    client.product.findUnique({
      where: { id: input.productId },
      select: {
        attributeValues: {
          select: {
            attributeId: true,
            valueId: true,
            textValue: true,
            numberValue: true,
            boolValue: true,
            fromVariants: true,
            attribute: { select: { code: true, name: true } },
          },
        },
        variants: {
          where: { deletedAt: null },
          select: { attributeValues: { select: { attributeId: true, attribute: { select: { code: true, name: true } } } } },
        },
      },
    }),
    resolveCategoryAttributes(input.newCategoryId, tx),
  ]);
  if (!product) return { orphanAttributes: [], missingRequired: [], variantAxesLost: [] };

  const nextById = new Map(next.map((entry) => [entry.attribute.id, entry]));

  const orphanMap = new Map<string, CategoryChangeReport["orphanAttributes"][number]>();
  for (const row of product.attributeValues) {
    if (nextById.has(row.attributeId)) continue;
    const current = orphanMap.get(row.attributeId) ?? {
      attributeId: row.attributeId,
      code: row.attribute.code,
      name: row.attribute.name,
      valueCount: 0,
      fromVariants: false,
    };
    current.valueCount += 1;
    current.fromVariants = current.fromVariants || row.fromVariants;
    orphanMap.set(row.attributeId, current);
  }

  const missingRequired = next
    .filter((entry) => entry.isRequired && !hasValue(entry, product.attributeValues))
    .map((entry) => ({ attributeId: entry.attribute.id, code: entry.attribute.code, name: entry.attribute.name }));

  const axesLost = new Map<string, CategoryChangeReport["variantAxesLost"][number]>();
  for (const variant of product.variants) {
    for (const value of variant.attributeValues) {
      const entry = nextById.get(value.attributeId);
      if (entry?.isVariant) continue;
      axesLost.set(value.attributeId, {
        attributeId: value.attributeId,
        code: value.attribute.code,
        name: value.attribute.name,
      });
    }
  }

  return {
    orphanAttributes: [...orphanMap.values()],
    missingRequired,
    variantAxesLost: [...axesLost.values()],
  };
}
