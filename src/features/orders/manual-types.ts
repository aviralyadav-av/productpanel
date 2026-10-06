/**
 * Shapes the manual order form needs on the client.
 *
 * They live here rather than in `queries.ts` because that file is
 * `server-only`: a client component may import a type from here without
 * dragging Prisma into the browser bundle.
 */

export type ManualVariantOption = {
  id: string;
  name: string;
  sku: string | null;
  /** Sale price when a sale window is live, else the list price. */
  pricePaise: number;
  listPricePaise: number;
  available: number;
  allowBackorder: boolean;
  isDefault: boolean;
  optionsLabel: string | null;
};

export type ManualCustomizationChoice = { value: string; label: string; priceDeltaPaise: number };

export type ManualCustomizationOption = {
  id: string;
  type: string;
  label: string;
  helpText: string | null;
  placeholder: string | null;
  isRequired: boolean;
  minLength: number | null;
  maxLength: number | null;
  maxFiles: number | null;
  priceDeltaPaise: number;
  choices: ManualCustomizationChoice[];
  /** Precomputed so the form does not need the products module's helpers. */
  kind: "text" | "choice" | "file" | "boolean";
  multiple: boolean;
};

export type ManualProductInfo = {
  id: string;
  title: string;
  imageUrl: string | null;
  sellerId: string | null;
  sellerName: string | null;
  minOrderQty: number;
  maxOrderQty: number | null;
  taxRateBps: number | null;
  variants: ManualVariantOption[];
  customizationOptions: ManualCustomizationOption[];
  /** Why the product cannot be ordered, when it cannot. */
  problem: string | null;
};
