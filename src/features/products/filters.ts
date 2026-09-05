import type { ProductStatus } from "@/lib/enums";

/**
 * The catalogue's read-side URL vocabulary: which sorts and flags a product
 * list URL may carry, what each flag means to an operator, and how a raw query
 * string becomes one of them.
 *
 * This lives outside queries.ts because the toolbar that renders these labels
 * is a Client Component, and queries.ts is `server-only` - importing a value
 * from there into the browser bundle is a build error. Nothing here touches
 * the database, so both sides can share it.
 */

export const PRODUCT_SORTS = ["title", "price", "stock", "updatedAt"] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

export const PRODUCT_FLAGS = ["no-image", "bad-sale-price", "on-sale"] as const;
export type ProductFlag = (typeof PRODUCT_FLAGS)[number];

/** The dashboard links straight into these, so each needs a human sentence. */
export const PRODUCT_FLAG_META: Record<
  ProductFlag,
  { label: string; description: string }
> = {
  "no-image": {
    label: "Missing an image",
    description: "These render as blank cards on the storefront.",
  },
  "bad-sale-price": {
    label: "Sale price at or above list price",
    description:
      "A discount badge would show with no actual discount behind it.",
  },
  "on-sale": {
    label: "On sale right now",
    description: "Sale price is below list price and inside its date window.",
  },
};

export type ProductListFilters = {
  status?: ProductStatus;
  categoryId?: string;
  gender?: string;
  flag?: ProductFlag;
};

export function resolveProductSort(raw: string | undefined): ProductSort {
  return (PRODUCT_SORTS as readonly string[]).includes(raw ?? "")
    ? (raw as ProductSort)
    : "updatedAt";
}

export function resolveProductFlag(
  raw: string | undefined,
): ProductFlag | undefined {
  return (PRODUCT_FLAGS as readonly string[]).includes(raw ?? "")
    ? (raw as ProductFlag)
    : undefined;
}
