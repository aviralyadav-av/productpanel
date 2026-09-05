"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { requireAdminOrThrow } from "@/lib/auth/guards";
import { writeAudit, diffOf } from "@/lib/audit";
import {
  ok,
  fail,
  zodFail,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import { PRODUCT_STATUS_META, type ProductStatus } from "@/lib/enums";
import { formatPaise, rupeesToPaise } from "@/lib/money";
import { filenameFromUrl, isVideoUrl } from "@/lib/media";
import {
  addImageSchema,
  bulkSaleSchema,
  bulkStatusSchema,
  categoryInputSchema,
  productIdsSchema,
  readFirstVariant,
  readProductForm,
  slugify,
  updateImageSchema,
  variantInputSchema,
  type AddImageInput,
  type BulkSaleInput,
  type BulkStatusInput,
  type CategoryInput,
  type UpdateImageInput,
  type VariantInput,
} from "@/features/products/schemas";

/**
 * Every mutation the catalogue has. The shape is identical throughout:
 * authorize, validate, work, audit, revalidate, return a human sentence.
 *
 * Nothing here reaches the live storefront. It still reads static JS files in
 * the Vite app, so these writes only change this database until src/api/*.js
 * over there is repointed at this admin's API.
 */

export type ProductFormState = ActionResult<{ id: string }> | null;

const PRODUCTS_PATH = "/products";

function revalidateProduct(id?: string) {
  revalidatePath(PRODUCTS_PATH);
  if (id) revalidatePath(`/products/${id}`);
}

/**
 * Product ids are not cuids: the legacy catalogue keeps values like
 * "handbag-001" so shoppers' saved localStorage carts survive cutover. New
 * products follow the same readable convention, derived from the slug.
 */
async function mintProductId(slug: string): Promise<string> {
  const base = slugify(slug) || "product";
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const clash = await db.product.findUnique({
      where: { id: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  return `${base}-${Date.now()}`;
}

async function mintVariantId(
  productId: string,
  name: string,
): Promise<string> {
  const base = `${productId}-${slugify(name) || "variant"}`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const clash = await db.productVariant.findUnique({
      where: { id: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  return `${base}-${Date.now()}`;
}

async function slugIsTaken(slug: string, exceptId?: string): Promise<boolean> {
  const existing = await db.product.findUnique({
    where: { slug },
    select: { id: true },
  });
  return Boolean(existing) && existing?.id !== exceptId;
}

/**
 * A variant with no inventory row cannot be sold, counted or restocked, so the
 * row and its opening ledger entry are created in the same transaction as the
 * variant itself. The opening movement is a zero-delta SEED rather than an
 * invented starting quantity - the operator sets the real number on /inventory.
 */
async function createVariantWithInventory(
  tx: Prisma.TransactionClient,
  input: {
    id: string;
    productId: string;
    name: string;
    sku: string | null;
    position: number;
    isActive: boolean;
    actorId: string;
  },
) {
  const variant = await tx.productVariant.create({
    data: {
      id: input.id,
      productId: input.productId,
      name: input.name,
      sku: input.sku,
      position: input.position,
      isActive: input.isActive,
    },
  });

  await tx.inventoryItem.create({
    data: { variantId: variant.id, onHand: 0, reserved: 0 },
  });

  await tx.stockMovement.create({
    data: {
      variantId: variant.id,
      delta: 0,
      type: "SEED",
      reason: "Variant created",
      note: "Opening balance. Set the real quantity on the inventory page.",
      balance: 0,
      actorId: input.actorId,
    },
  });

  return variant;
}

// ---------------------------------------------------------------------------
// Product create / update
// ---------------------------------------------------------------------------

export async function createProduct(
  _prev: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const actor = await requireAdminOrThrow();

  const parsed = readProductForm(formData);
  if (!parsed.success) return zodFail(parsed.error);

  const variantParsed = readFirstVariant(formData);
  if (!variantParsed.success) return zodFail(variantParsed.error);

  const input = parsed.data;

  return runAction(async () => {
    if (await slugIsTaken(input.slug)) {
      return fail("That slug is already in use.", {
        slug: "Another product already uses this slug.",
      });
    }

    const id = await mintProductId(input.slug);
    const { firstVariantName, firstVariantSku } = variantParsed.data;

    await db.$transaction(async (tx) => {
      await tx.product.create({
        data: {
          id,
          slug: input.slug,
          title: input.title,
          description: input.description,
          gender: input.gender,
          categoryId: input.categoryId,
          status: input.status,
          publishedAt: input.status === "PUBLISHED" ? new Date() : null,
          pricePaise: input.pricePaise,
          salePricePaise: input.salePricePaise,
          saleStartsAt: input.saleStartsAt,
          saleEndsAt: input.saleEndsAt,
          isFeatured: input.isFeatured,
          position: input.position,
          metaTitle: input.metaTitle,
          metaDescription: input.metaDescription,
        },
      });

      if (firstVariantName) {
        await createVariantWithInventory(tx, {
          id: `${id}-${slugify(firstVariantName) || "variant"}`,
          productId: id,
          name: firstVariantName,
          sku: firstVariantSku ? firstVariantSku.toUpperCase() : null,
          position: 0,
          isActive: true,
          actorId: actor.id,
        });
      }
    });

    await writeAudit({
      actor,
      action: "product.create",
      entityType: "Product",
      entityId: id,
      summary: `Created product "${input.title}" as ${
        PRODUCT_STATUS_META[input.status].label
      }`,
      diff: diffOf(null, { ...input, id }),
    });

    revalidateProduct(id);

    return ok(
      { id },
      firstVariantName
        ? `"${input.title}" created with one colourway. Set its stock on the inventory page.`
        : `"${input.title}" created. Add a colourway before it can be sold.`,
    );
  });
}

export async function updateProduct(
  _prev: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const actor = await requireAdminOrThrow();

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return fail("The product this form belongs to is missing.");

  const parsed = readProductForm(formData);
  if (!parsed.success) return zodFail(parsed.error);

  const input = parsed.data;

  return runAction(async () => {
    const before = await db.product.findUnique({ where: { id } });
    if (!before) return fail("That product no longer exists.");

    if (await slugIsTaken(input.slug, id)) {
      return fail("That slug is already in use.", {
        slug: "Another product already uses this slug.",
      });
    }

    const after = await db.product.update({
      where: { id },
      data: {
        slug: input.slug,
        title: input.title,
        description: input.description,
        gender: input.gender,
        categoryId: input.categoryId,
        status: input.status,
        // First publish stamps publishedAt; later edits leave it alone so the
        // original go-live date is not rewritten by an unrelated save.
        publishedAt:
          input.status === "PUBLISHED" && !before.publishedAt
            ? new Date()
            : before.publishedAt,
        pricePaise: input.pricePaise,
        salePricePaise: input.salePricePaise,
        saleStartsAt: input.saleStartsAt,
        saleEndsAt: input.saleEndsAt,
        isFeatured: input.isFeatured,
        position: input.position,
        metaTitle: input.metaTitle,
        metaDescription: input.metaDescription,
      },
    });

    await writeAudit({
      actor,
      action: "product.update",
      entityType: "Product",
      entityId: id,
      summary: `Updated product "${after.title}"`,
      diff: diffOf(before, after),
    });

    revalidateProduct(id);

    return ok({ id }, `Saved "${after.title}".`);
  });
}

// ---------------------------------------------------------------------------
// Status, featured, delete
// ---------------------------------------------------------------------------

export async function setProductStatus(
  id: string,
  status: ProductStatus,
): Promise<ActionResult<{ id: string; status: ProductStatus }>> {
  const actor = await requireAdminOrThrow();

  return runAction(async () => {
    const before = await db.product.findUnique({
      where: { id },
      select: { id: true, title: true, status: true, publishedAt: true },
    });
    if (!before) return fail("That product no longer exists.");

    await db.product.update({
      where: { id },
      data: {
        status,
        publishedAt:
          status === "PUBLISHED" && !before.publishedAt
            ? new Date()
            : before.publishedAt,
      },
    });

    await writeAudit({
      actor,
      action: "product.status_change",
      entityType: "Product",
      entityId: id,
      summary: `Set "${before.title}" to ${PRODUCT_STATUS_META[status].label}`,
      diff: diffOf({ status: before.status }, { status }),
    });

    revalidateProduct(id);

    return ok(
      { id, status },
      `"${before.title}" is now ${PRODUCT_STATUS_META[status].label.toLowerCase()}.`,
    );
  });
}

export async function toggleFeatured(
  id: string,
  isFeatured: boolean,
): Promise<ActionResult<{ id: string; isFeatured: boolean }>> {
  const actor = await requireAdminOrThrow();

  return runAction(async () => {
    const before = await db.product.findUnique({
      where: { id },
      select: { title: true, isFeatured: true },
    });
    if (!before) return fail("That product no longer exists.");

    await db.product.update({ where: { id }, data: { isFeatured } });

    await writeAudit({
      actor,
      action: "product.feature",
      entityType: "Product",
      entityId: id,
      summary: `${isFeatured ? "Featured" : "Unfeatured"} "${before.title}"`,
      diff: diffOf(
        { isFeatured: before.isFeatured },
        { isFeatured },
      ),
    });

    revalidateProduct(id);

    return ok(
      { id, isFeatured },
      isFeatured
        ? `"${before.title}" is now featured.`
        : `"${before.title}" is no longer featured.`,
    );
  });
}

/**
 * A hard delete, kept separate from archiving on purpose.
 *
 * Archiving hides a product and keeps every row that points at it. Deleting
 * removes the product, its variants, their inventory and their entire stock
 * ledger. Order items survive because OrderItem.productId is onDelete: SetNull
 * and every line carries its own title, SKU and price snapshot - but the link
 * from an old order back to the catalogue is gone for good.
 */
export async function deleteProduct(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireAdminOrThrow();

  return runAction(async () => {
    const product = await db.product.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        status: true,
        _count: { select: { orderItems: true, variants: true, images: true } },
      },
    });
    if (!product) return fail("That product no longer exists.");

    await db.product.delete({ where: { id } });

    await writeAudit({
      actor,
      action: "product.delete",
      entityType: "Product",
      entityId: id,
      summary: `Deleted product "${product.title}" (${product._count.variants} variants, ${product._count.orderItems} order lines unlinked)`,
      diff: diffOf(product, null),
    });

    revalidatePath(PRODUCTS_PATH);

    return ok({ id }, `Deleted "${product.title}".`);
  });
}

// ---------------------------------------------------------------------------
// Bulk operations
// ---------------------------------------------------------------------------

export async function bulkSetStatus(
  input: BulkStatusInput,
): Promise<ActionResult<{ updated: number }>> {
  const actor = await requireAdminOrThrow();

  const parsed = bulkStatusSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  const { productIds, status } = parsed.data;

  return runAction(async () => {
    const result = await db.product.updateMany({
      where: { id: { in: productIds } },
      data: { status },
    });

    // publishedAt is only stamped on rows that have never been published, so
    // it cannot be done in the same updateMany.
    if (status === "PUBLISHED") {
      await db.product.updateMany({
        where: { id: { in: productIds }, publishedAt: null },
        data: { publishedAt: new Date() },
      });
    }

    await writeAudit({
      actor,
      action: "product.bulk_status",
      entityType: "Product",
      summary: `Set ${result.count} products to ${PRODUCT_STATUS_META[status].label}`,
      diff: diffOf(null, { productIds, status }),
    });

    revalidatePath(PRODUCTS_PATH);

    return ok(
      { updated: result.count },
      `${result.count} product${result.count === 1 ? "" : "s"} set to ${PRODUCT_STATUS_META[status].label.toLowerCase()}.`,
    );
  });
}

/**
 * Percent mode computes each product's sale price from its own list price, so
 * a single "20% off" applies correctly across a catalogue with mixed pricing.
 * Fixed mode sets the same rupee price on every selected product, which is
 * only ever what an operator wants for a group priced the same - the result
 * message reports how many ended up at or above their list price.
 */
export async function bulkSetSale(
  input: BulkSaleInput,
): Promise<ActionResult<{ updated: number; invalid: number }>> {
  const actor = await requireAdminOrThrow();

  const parsed = bulkSaleSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  const { productIds, mode, value, startsAt, endsAt } = parsed.data;

  return runAction(async () => {
    const products = await db.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, title: true, pricePaise: true },
    });

    if (products.length === 0) {
      return fail("None of those products exist any more.");
    }

    const fixedPaise = rupeesToPaise(value);
    let invalid = 0;

    await db.$transaction(
      products.map((product) => {
        const salePricePaise =
          mode === "PERCENT"
            ? Math.round(product.pricePaise * (1 - value / 100))
            : fixedPaise;

        if (salePricePaise >= product.pricePaise) invalid += 1;

        return db.product.update({
          where: { id: product.id },
          data: { salePricePaise, saleStartsAt: startsAt, saleEndsAt: endsAt },
        });
      }),
    );

    await writeAudit({
      actor,
      action: "product.bulk_sale",
      entityType: "Product",
      summary:
        mode === "PERCENT"
          ? `Put ${products.length} products on sale at ${value}% off`
          : `Set the sale price of ${products.length} products to ${formatPaise(fixedPaise)}`,
      diff: diffOf(null, {
        productIds: products.map((product) => product.id),
        mode,
        value,
        startsAt,
        endsAt,
      }),
    });

    revalidatePath(PRODUCTS_PATH);

    const base = `${products.length} product${products.length === 1 ? "" : "s"} put on sale.`;

    return ok(
      { updated: products.length, invalid },
      invalid > 0
        ? `${base} ${invalid} ended up at or above list price and will show no real discount.`
        : base,
    );
  });
}

export async function clearSale(
  productIds: string[],
): Promise<ActionResult<{ updated: number }>> {
  const actor = await requireAdminOrThrow();

  const parsed = productIdsSchema.safeParse({ productIds });
  if (!parsed.success) return zodFail(parsed.error);

  return runAction(async () => {
    const result = await db.product.updateMany({
      where: { id: { in: parsed.data.productIds } },
      data: { salePricePaise: null, saleStartsAt: null, saleEndsAt: null },
    });

    await writeAudit({
      actor,
      action: "product.clear_sale",
      entityType: "Product",
      summary: `Cleared the sale price on ${result.count} products`,
      diff: diffOf(null, { productIds: parsed.data.productIds }),
    });

    revalidatePath(PRODUCTS_PATH);

    return ok(
      { updated: result.count },
      `Sale cleared on ${result.count} product${result.count === 1 ? "" : "s"}.`,
    );
  });
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function upsertCategory(
  input: CategoryInput,
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireAdminOrThrow();

  const parsed = categoryInputSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  const data = parsed.data;

  return runAction(async () => {
    const clash = await db.category.findUnique({
      where: { slug: data.slug },
      select: { id: true },
    });
    if (clash && clash.id !== data.id) {
      return fail("That slug is already in use.", {
        slug: "Another category already uses this slug.",
      });
    }

    // The tree is exactly two levels deep. Letting a child become a parent's
    // parent would make navigation unrenderable, and a category cannot be its
    // own parent.
    if (data.parentId) {
      if (data.parentId === data.id) {
        return fail("A category cannot be its own parent.", {
          parentId: "Choose a different parent.",
        });
      }
      const parent = await db.category.findUnique({
        where: { id: data.parentId },
        select: { parentId: true },
      });
      if (!parent) return fail("That parent category no longer exists.");
      if (parent.parentId) {
        return fail(
          "Categories go two levels deep. Pick a top-level category as the parent.",
          { parentId: "This category is already a child." },
        );
      }
    }

    if (data.id) {
      const hasChildren = await db.category.count({
        where: { parentId: data.id },
      });
      if (hasChildren > 0 && data.parentId) {
        return fail(
          "This category has children, so it has to stay at the top level.",
          { parentId: "Remove its children first." },
        );
      }
    }

    const before = data.id
      ? await db.category.findUnique({ where: { id: data.id } })
      : null;

    const after = data.id
      ? await db.category.update({
          where: { id: data.id },
          data: {
            name: data.name,
            slug: data.slug,
            description: data.description,
            parentId: data.parentId,
            position: data.position,
            isActive: data.isActive,
            isFeatured: data.isFeatured,
          },
        })
      : await db.category.create({
          data: {
            name: data.name,
            slug: data.slug,
            description: data.description,
            parentId: data.parentId,
            position: data.position,
            isActive: data.isActive,
            isFeatured: data.isFeatured,
          },
        });

    await writeAudit({
      actor,
      action: before ? "category.update" : "category.create",
      entityType: "Category",
      entityId: after.id,
      summary: `${before ? "Updated" : "Created"} category "${after.name}"`,
      diff: diffOf(before, after),
    });

    revalidatePath(PRODUCTS_PATH);

    return ok(
      { id: after.id },
      before ? `Saved "${after.name}".` : `Created "${after.name}".`,
    );
  });
}

/**
 * Category.products is onDelete: SetNull, so deleting one does not delete its
 * products - it strands them as uncategorised. Children are detached the same
 * way and become top-level categories. Both facts are reported back so the
 * confirmation the operator saw matches what actually happened.
 */
export async function deleteCategory(
  id: string,
): Promise<ActionResult<{ id: string; orphanedProducts: number }>> {
  const actor = await requireAdminOrThrow();

  return runAction(async () => {
    const category = await db.category.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        _count: { select: { products: true, children: true } },
      },
    });
    if (!category) return fail("That category no longer exists.");

    await db.category.delete({ where: { id } });

    await writeAudit({
      actor,
      action: "category.delete",
      entityType: "Category",
      entityId: id,
      summary: `Deleted category "${category.name}" (${category._count.products} products now uncategorised, ${category._count.children} children promoted)`,
      diff: diffOf(category, null),
    });

    revalidatePath(PRODUCTS_PATH);

    const notes: string[] = [];
    if (category._count.products > 0) {
      notes.push(
        `${category._count.products} product${category._count.products === 1 ? " is" : "s are"} now uncategorised`,
      );
    }
    if (category._count.children > 0) {
      notes.push(
        `${category._count.children} child categor${category._count.children === 1 ? "y is" : "ies are"} now top level`,
      );
    }

    return ok(
      { id, orphanedProducts: category._count.products },
      notes.length > 0
        ? `Deleted "${category.name}". ${notes.join(" and ")}.`
        : `Deleted "${category.name}".`,
    );
  });
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

/**
 * There is no upload storage provider wired up, so an image reaches a product
 * either by URL or by picking an existing MediaAsset. Both paths land here:
 * MediaAsset is deduped on url, so pasting the URL of an asset already in the
 * library reuses that row instead of creating a duplicate.
 */
export async function addProductImageByUrl(
  input: AddImageInput,
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireAdminOrThrow();

  const parsed = addImageSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  const { productId, url, alt, variantId } = parsed.data;

  return runAction(async () => {
    const product = await db.product.findUnique({
      where: { id: productId },
      select: { id: true, title: true },
    });
    if (!product) return fail("That product no longer exists.");

    const media =
      (await db.mediaAsset.findUnique({ where: { url } })) ??
      (await db.mediaAsset.create({
        data: {
          url,
          filename: filenameFromUrl(url),
          kind: isVideoUrl(url) ? "video" : "image",
          alt: alt,
          folder: "products",
          // Anything off-site is referenced, never fetched; anything else is a
          // path the storefront already serves.
          source: /^https?:\/\//i.test(url) ? "external" : "legacy",
        },
      }));

    const last = await db.productImage.findFirst({
      where: { productId },
      orderBy: { position: "desc" },
      select: { position: true },
    });

    const duplicate = await db.productImage.findFirst({
      where: { productId, mediaId: media.id, variantId },
      select: { id: true },
    });
    if (duplicate) {
      return fail("That image is already attached to this product.");
    }

    const image = await db.productImage.create({
      data: {
        productId,
        variantId,
        mediaId: media.id,
        alt,
        position: (last?.position ?? -1) + 1,
      },
    });

    await writeAudit({
      actor,
      action: "product.image_add",
      entityType: "Product",
      entityId: productId,
      summary: `Added an image to "${product.title}"`,
      diff: diffOf(null, { url, alt, variantId }),
    });

    revalidateProduct(productId);

    return ok({ id: image.id }, "Image added.");
  });
}

export async function updateProductImage(
  input: UpdateImageInput,
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireAdminOrThrow();

  const parsed = updateImageSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  const { id, alt, position } = parsed.data;

  return runAction(async () => {
    const before = await db.productImage.findUnique({
      where: { id },
      select: { id: true, productId: true, alt: true, position: true },
    });
    if (!before) return fail("That image is no longer attached.");

    await db.productImage.update({ where: { id }, data: { alt, position } });

    await writeAudit({
      actor,
      action: "product.image_update",
      entityType: "Product",
      entityId: before.productId,
      summary: "Updated a product image",
      diff: diffOf(
        { alt: before.alt, position: before.position },
        { alt, position },
      ),
    });

    revalidateProduct(before.productId);

    return ok({ id }, "Image updated.");
  });
}

export async function deleteProductImage(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireAdminOrThrow();

  return runAction(async () => {
    const image = await db.productImage.findUnique({
      where: { id },
      select: {
        id: true,
        productId: true,
        alt: true,
        media: { select: { url: true } },
      },
    });
    if (!image) return fail("That image is no longer attached.");

    // Only the link is removed. The MediaAsset row stays in the library
    // because other products and content blocks may point at the same file.
    await db.productImage.delete({ where: { id } });

    await writeAudit({
      actor,
      action: "product.image_remove",
      entityType: "Product",
      entityId: image.productId,
      summary: "Removed an image from a product",
      diff: diffOf({ url: image.media.url, alt: image.alt }, null),
    });

    revalidateProduct(image.productId);

    return ok({ id }, "Image removed. The file stays in the media library.");
  });
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

export async function upsertVariant(
  input: VariantInput,
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireAdminOrThrow();

  const parsed = variantInputSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  const data = parsed.data;
  const sku = data.sku ? data.sku.toUpperCase() : null;

  return runAction(async () => {
    const product = await db.product.findUnique({
      where: { id: data.productId },
      select: { id: true, title: true },
    });
    if (!product) return fail("That product no longer exists.");

    const nameClash = await db.productVariant.findFirst({
      where: {
        productId: data.productId,
        name: data.name,
        ...(data.id ? { NOT: { id: data.id } } : {}),
      },
      select: { id: true },
    });
    if (nameClash) {
      return fail("That colourway already exists on this product.", {
        name: "Use a name this product does not already have.",
      });
    }

    if (sku) {
      const skuClash = await db.productVariant.findUnique({
        where: { sku },
        select: { id: true },
      });
      if (skuClash && skuClash.id !== data.id) {
        return fail("That SKU is already used by another variant.", {
          sku: "SKUs are unique across the whole catalogue.",
        });
      }
    }

    if (data.id) {
      const before = await db.productVariant.findUnique({
        where: { id: data.id },
      });
      if (!before) return fail("That variant no longer exists.");

      const after = await db.productVariant.update({
        where: { id: data.id },
        data: {
          name: data.name,
          sku,
          position: data.position,
          isActive: data.isActive,
        },
      });

      await writeAudit({
        actor,
        action: "variant.update",
        entityType: "ProductVariant",
        entityId: after.id,
        summary: `Updated colourway "${after.name}" on "${product.title}"`,
        diff: diffOf(before, after),
      });

      revalidateProduct(data.productId);

      return ok({ id: after.id }, `Saved "${after.name}".`);
    }

    const id = await mintVariantId(data.productId, data.name);

    await db.$transaction(async (tx) => {
      await createVariantWithInventory(tx, {
        id,
        productId: data.productId,
        name: data.name,
        sku,
        position: data.position,
        isActive: data.isActive,
        actorId: actor.id,
      });
    });

    await writeAudit({
      actor,
      action: "variant.create",
      entityType: "ProductVariant",
      entityId: id,
      summary: `Added colourway "${data.name}" to "${product.title}" with an empty inventory row`,
      diff: diffOf(null, { ...data, id, sku }),
    });

    revalidateProduct(data.productId);

    return ok(
      { id },
      `"${data.name}" added. It starts with zero stock - set the real quantity on the inventory page.`,
    );
  });
}

/**
 * Deleting a variant destroys its inventory row and its whole stock ledger, so
 * a variant that has ever been ordered is refused: the order line would keep
 * its snapshot but the history behind it would be gone. Deactivating hides it
 * from the storefront and keeps everything.
 */
export async function deleteVariant(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireAdminOrThrow();

  return runAction(async () => {
    const variant = await db.productVariant.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        productId: true,
        product: { select: { title: true } },
        inventory: { select: { onHand: true } },
        _count: { select: { orderItems: true, movements: true } },
      },
    });
    if (!variant) return fail("That variant no longer exists.");

    if (variant._count.orderItems > 0) {
      return fail(
        `"${variant.name}" appears on ${variant._count.orderItems} order line${variant._count.orderItems === 1 ? "" : "s"}. Deactivate it instead so the order history stays intact.`,
      );
    }

    await db.productVariant.delete({ where: { id } });

    await writeAudit({
      actor,
      action: "variant.delete",
      entityType: "ProductVariant",
      entityId: id,
      summary: `Deleted colourway "${variant.name}" from "${variant.product.title}" (${variant._count.movements} stock movements removed)`,
      diff: diffOf(
        { name: variant.name, onHand: variant.inventory?.onHand ?? 0 },
        null,
      ),
    });

    revalidateProduct(variant.productId);

    return ok({ id }, `Deleted "${variant.name}".`);
  });
}
