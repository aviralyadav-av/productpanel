import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requirePermission } from "@/lib/auth/guards";

import { ProductEditor } from "@/features/products/components/editor/product-editor";
import { getEditorBootstrap, getProductForEditor } from "@/features/products/queries";

export const metadata: Metadata = { title: "Edit product" };

/** /admin/products/[id] - the full editor; the Server Component loads one payload and the client saves per section. */
export default async function ProductEditorPage({ params }: PageProps<"/admin/products/[id]">) {
  const actor = await requirePermission("products.view");
  const { id } = await params;

  const [product, bootstrap] = await Promise.all([getProductForEditor(id), getEditorBootstrap()]);
  if (!product) notFound();

  return <ProductEditor product={product} bootstrap={bootstrap} permissions={actor.isSuperAdmin ? ["*"] : [...actor.permissions]} />;
}
