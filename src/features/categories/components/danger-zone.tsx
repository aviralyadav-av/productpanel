"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FormSection } from "@/components/shared/form-layout";

import type { CategoryOption } from "../queries";
import type { CategoryUsage } from "../service";
import { DeleteCategoryDialog } from "./delete-category-dialog";

/** The edit page's delete affordance; the dialog owns the frictions (§11.1). */
export function CategoryDangerZone({
  category,
  usage,
  categories,
}: {
  category: { id: string; name: string };
  usage: CategoryUsage;
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const blocked = usage.children > 0 || usage.products > 0;

  return (
    <FormSection title="Danger zone" description="Deleting is permanent. Anything under the category must be moved first.">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">
          {blocked
            ? `Holds ${usage.children} sub-categor${usage.children === 1 ? "y" : "ies"} and ${usage.products} directly attached product${usage.products === 1 ? "" : "s"} (${usage.subtreeProducts} in the whole subtree). You will be asked where to move them.`
            : "This category is empty and can be deleted outright."}
        </p>
        <Button type="button" variant="destructive" size="sm" onClick={() => setOpen(true)}>
          <Trash2 /> Delete category
        </Button>
      </div>
      <DeleteCategoryDialog
        target={open ? { id: category.id, name: category.name, childrenCount: usage.children, productCount: usage.products } : null}
        categories={categories}
        onOpenChange={setOpen}
        onDeleted={() => router.push("/admin/categories")}
      />
    </FormSection>
  );
}
