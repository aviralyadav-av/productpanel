import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { requireAdmin } from "@/lib/auth/guards";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import {
  getCategoryOptions,
  getMediaOptions,
} from "@/features/products/queries";
import { ProductForm } from "@/features/products/components/product-form";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage() {
  await requireAdmin();

  const [categories, media] = await Promise.all([
    getCategoryOptions(),
    getMediaOptions(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="New product"
        description="Draft first: nothing is visible to shoppers until the status is set to Published. Images and extra colourways are added once the draft exists."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/products">
              <ArrowLeft />
              All products
            </Link>
          </Button>
        }
      />

      <ProductForm
        mode="create"
        product={null}
        categories={categories}
        media={media}
      />
    </div>
  );
}
