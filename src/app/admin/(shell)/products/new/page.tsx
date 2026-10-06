import type { Metadata } from "next";

import { requirePermission } from "@/lib/auth/guards";

import { ProductEditor } from "@/features/products/components/editor/product-editor";
import { getEditorBootstrap } from "@/features/products/queries";

export const metadata: Metadata = { title: "New product" };

/** /admin/products/new - the same editor with no product; saving creates the draft and redirects to /admin/products/[id]. */
export default async function NewProductPage() {
  const actor = await requirePermission("products.create");
  const bootstrap = await getEditorBootstrap();

  return <ProductEditor product={null} bootstrap={bootstrap} permissions={actor.isSuperAdmin ? ["*"] : [...actor.permissions]} />;
}
