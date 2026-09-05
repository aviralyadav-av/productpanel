import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Boxes } from "lucide-react";

import { requireAdmin } from "@/lib/auth/guards";
import { PageHeader } from "@/components/shared/page-header";
import { ProductStatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  getCategoryOptions,
  getMediaOptions,
  getProductForEditor,
} from "@/features/products/queries";
import { ProductForm } from "@/features/products/components/product-form";

export const metadata: Metadata = { title: "Edit product" };

export default async function ProductEditorPage({
  params,
}: PageProps<"/products/[id]">) {
  await requireAdmin();

  const { id } = await params;

  const [product, categories, media] = await Promise.all([
    getProductForEditor(id),
    getCategoryOptions(),
    getMediaOptions(),
  ]);

  if (!product) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={product.title}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <ProductStatusBadge status={product.status} />
            <span className="font-mono text-[11px]">{product.id}</span>
            <span>
              {product.variants.length} colourway
              {product.variants.length === 1 ? "" : "s"} ·{" "}
              {product.images.length} image
              {product.images.length === 1 ? "" : "s"}
            </span>
            <span className="text-muted-foreground">
              Edits save to this database only — the storefront is not connected
              yet.
            </span>
          </span>
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/inventory">
                <Boxes />
                Stock
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/products">
                <ArrowLeft />
                All products
              </Link>
            </Button>
          </>
        }
      />

      <ProductForm
        mode="edit"
        product={product}
        categories={categories}
        media={media}
      />
    </div>
  );
}
