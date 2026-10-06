import "dotenv/config";

import { db } from "@/lib/db";
import { SYSTEM_ACTOR } from "@/lib/audit";
import { resolveCategoryAttributes } from "@/features/catalog/attribute-resolution";

import { addProductImages } from "@/features/products/images-service";
import { createCustomizationOption } from "@/features/products/customization-service";
import { bulkProducts } from "@/features/products/bulk-service";
import {
  createProduct,
  duplicateProduct,
  publishValidation,
  setProductStatus,
  softDeleteProduct,
  updateProduct,
} from "@/features/products/service";
import { generateProductVariants, updateVariant } from "@/features/products/variants-service";
import { productFormSchema } from "@/features/products/schemas";

/**
 * End-to-end check against the REAL database (no Next runtime):
 *
 *   npx tsx src/features/products/__checks__/product-check.ts
 *
 * Creates a "check_" product in a leaf category that has two variant axes,
 * fills its attribute values, generates variants, attaches an existing demo
 * image, adds a customisation option, walks the publish gate (problems first,
 * then a pass), duplicates, soft-deletes and cleans everything up. Every
 * assertion names what it checks so a failure reads as a sentence. Audit rows
 * are left in place: AuditLog is append-only (blueprint D13).
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
}

const STAMP = Date.now();
const created: string[] = [];

async function cleanup(): Promise<void> {
  const ids = await db.product.findMany({ where: { OR: [{ id: { in: created } }, { title: { startsWith: "check_" } }] }, select: { id: true } });
  for (const { id } of ids) {
    const variantIds = (await db.productVariant.findMany({ where: { productId: id }, select: { id: true } })).map((row) => row.id);
    await db.stockMovement.deleteMany({ where: { variantId: { in: variantIds } } });
    await db.inventoryItem.deleteMany({ where: { variantId: { in: variantIds } } });
    await db.product.delete({ where: { id } });
  }
}

async function main(): Promise<void> {
  const actor = { id: SYSTEM_ACTOR.id, email: SYSTEM_ACTOR.email };

  // A leaf category with at least two variant axes in its effective set.
  const categories = await db.category.findMany({
    where: { isActive: true, children: { none: {} } },
    select: { id: true, name: true },
    orderBy: { path: "asc" },
  });
  let target: { id: string; name: string } | null = null;
  let effective: Awaited<ReturnType<typeof resolveCategoryAttributes>> = [];
  for (const category of categories) {
    const resolved = await resolveCategoryAttributes(category.id);
    const axes = resolved.filter((entry) => entry.isVariant && ["SELECT", "COLOR"].includes(entry.attribute.inputType) && entry.values.length >= 2);
    if (axes.length >= 2) {
      target = category;
      effective = resolved;
      break;
    }
  }
  assert(target, "a leaf category with two variant axes exists in the seed");
  console.log(`category: ${target.name} (${effective.length} effective attributes)`);

  const axes = effective.filter((entry) => entry.isVariant && ["SELECT", "COLOR"].includes(entry.attribute.inputType) && entry.values.length >= 2).slice(0, 2);
  const required = effective.filter((entry) => entry.isRequired && !entry.isVariant);
  const attributeValues = required.map((entry) => {
    const { attribute } = entry;
    if (["SELECT", "MULTI_SELECT", "COLOR"].includes(attribute.inputType)) return { attributeId: attribute.id, valueIds: [entry.values[0]?.id].filter(Boolean) as string[] };
    if (attribute.inputType === "NUMBER") return { attributeId: attribute.id, numberValue: 42 };
    if (attribute.inputType === "BOOLEAN") return { attributeId: attribute.id, boolValue: true };
    return { attributeId: attribute.id, textValue: "check value" };
  });

  const seller = await db.seller.findFirst({ where: { status: "ACTIVE", deletedAt: null }, select: { id: true } });

  // 1. Create (missing category on purpose so the publish gate has something to say).
  const form = productFormSchema.parse({
    title: `check_product_${STAMP}`,
    slug: `check-product-${STAMP}`,
    description: "<p>Check product</p><script>alert(1)</script>",
    pricePaise: 0,
    categoryId: "",
    sellerId: seller?.id ?? "",
    tags: ["check", "Check"],
    attributeValues,
  });
  const product = await createProduct(form, actor);
  created.push(product.id);
  const stored = await db.product.findUnique({ where: { id: product.id }, include: { tags: true, variants: true, attributeValues: true } });
  assert(stored, "product row created");
  assert(!stored.description.includes("<script"), "description is sanitised");
  assert(stored.tags.length === 1, `tags de-duplicate by slug (got ${stored.tags.length})`);
  assert(stored.variants.length === 1 && stored.variants[0].isDefault, "a default variant exists");
  assert(stored.attributeValues.length === attributeValues.length, "required attribute values written");
  console.log(`created ${product.id} (${stored.variants.length} variant, ${stored.attributeValues.length} values)`);

  // 2. Publish gate: fails first.
  const first = await publishValidation(product.id);
  assert(!first.ok, "publish validation fails for an incomplete product");
  const codes = first.problems.map((problem) => problem.code);
  assert(codes.includes("NO_IMAGE") && codes.includes("PRICE_NOT_POSITIVE") && codes.includes("NO_CATEGORY"), `problems name image, price and category (${codes.join(",")})`);
  const blocked = await setProductStatus(product.id, "PUBLISHED", actor);
  assert(!blocked.ok, "setProductStatus refuses to publish while problems remain");

  // 3. Fix it: category, price, image, variants.
  await updateProduct(product.id, { categoryId: target.id, pricePaise: 49900, salePricePaise: 39900 }, actor);
  const media = await db.mediaAsset.findFirst({ where: { kind: "image", visibility: "PUBLIC", productImages: { some: {} } }, select: { id: true } });
  assert(media, "a demo image asset exists");
  const added = await addProductImages(product.id, [media.id], actor);
  assert(added.added === 1, "image attached");

  const generated = await generateProductVariants(
    product.id,
    { axes: axes.map((entry) => ({ attributeId: entry.attribute.id, valueIds: entry.values.slice(0, 2).map((value) => value.id) })) },
    actor,
  );
  assert(generated.created === 4, `2x2 axes create four variants (got ${generated.created})`);
  assert(generated.deactivated === 1, "the placeholder Default variant is deactivated");
  const afterGenerate = await db.product.findUnique({
    where: { id: product.id },
    select: { facetValueIds: true, effectivePricePaise: true, attributeValues: { where: { fromVariants: true } }, variants: { where: { isActive: true }, include: { inventory: true } } },
  });
  assert(afterGenerate, "product reloaded");
  assert(afterGenerate.variants.every((variant) => variant.inventory), "every generated variant has an inventory row");
  assert(afterGenerate.attributeValues.length === 4, `A8 variant-derived rows written (got ${afterGenerate.attributeValues.length})`);
  assert(afterGenerate.effectivePricePaise === 39900, `effective price is the sale price (got ${afterGenerate.effectivePricePaise})`);
  console.log(`variants: ${generated.created} created, ${generated.deactivated} deactivated; facets ${afterGenerate.facetValueIds.length}`);

  // Facets include variant values only when in stock: give one variant stock via a bulk SET_STOCK.
  const bulk = await bulkProducts({ ids: [product.id], op: "SET_STOCK", onHand: 5, reason: "check" }, actor);
  assert(bulk.affected === 1, "bulk SET_STOCK affects the product");
  const stocked = await db.product.findUnique({ where: { id: product.id }, select: { facetValueIds: true } });
  assert((stocked?.facetValueIds.length ?? 0) >= 2, `facetValueIds populated once a variant is in stock (got ${stocked?.facetValueIds.length})`);

  const variant = afterGenerate.variants[0];
  const updated = await updateVariant(product.id, variant.id, { sku: `CHK-${STAMP}`, pricePaise: 59900 }, actor);
  assert(updated.sku === `CHK-${STAMP}`, "variant SKU saved");

  // 4. Customisation option → isCustomizable derived.
  const option = await createCustomizationOption(
    product.id,
    { type: "NAME", label: "Name on it", helpText: null, placeholder: null, isRequired: true, minLength: 2, maxLength: 12, maxFiles: null, allowedMimeTypes: [], choices: [], priceDeltaPaise: 5000, isActive: true },
    actor,
  );
  const customizable = await db.product.findUnique({ where: { id: product.id }, select: { isCustomizable: true } });
  assert(customizable?.isCustomizable === true, "isCustomizable derived from the active option");
  console.log(`customisation option ${option.id} added`);

  // 5. Publish passes now.
  const second = await publishValidation(product.id);
  assert(second.ok, `publish validation passes (${second.problems.map((problem) => problem.message).join(" | ")})`);
  const published = await setProductStatus(product.id, "PUBLISHED", actor);
  assert(published.ok && published.product.status === "PUBLISHED" && published.product.publishedAt, "product published with publishedAt");

  // 6. Duplicate.
  const copy = await duplicateProduct(product.id, actor);
  created.push(copy.id);
  const copied = await db.product.findUnique({ where: { id: copy.id }, include: { variants: { include: { inventory: true } }, images: true, customizationOptions: true, attributeValues: true } });
  assert(copied?.status === "DRAFT", "copy is a draft");
  assert(copied.variants.length === afterGenerate.variants.length + 1, "copy has every variant (incl. the inactive placeholder)");
  assert(copied.variants.every((row) => row.inventory && row.sku === null), "copied variants have fresh inventory and no SKU");
  assert(copied.images.length === 1 && copied.customizationOptions.length === 1, "copy keeps images and options");
  console.log(`duplicated as ${copy.id} (${copy.slug})`);

  // 7. Soft delete frees the slug and keeps the row.
  const deleted = await softDeleteProduct(product.id, actor, { reason: "check" });
  assert(deleted.slug.startsWith(`check-product-${STAMP}-deleted-`), "slug suffixed on delete");
  const gone = await db.product.findUnique({ where: { id: product.id }, select: { deletedAt: true, status: true, variants: { where: { isActive: true } } } });
  assert(gone?.deletedAt && gone.status === "ARCHIVED" && gone.variants.length === 0, "row kept, archived, variants deactivated");

  const audits = await db.auditLog.count({ where: { entityType: "product", entityId: { in: created } } });
  assert(audits >= 8, `audit rows written (${audits})`);
  console.log(`audit rows: ${audits}`);
  console.log("PRODUCT CHECK PASSED");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((error) => console.error("cleanup failed", error));
    await db.$disconnect();
  });
