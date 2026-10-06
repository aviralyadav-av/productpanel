import Link from "next/link";
import type { Route } from "next";

import { Button } from "@/components/ui/button";
import { KeyValueList } from "@/components/shared/key-value-list";
import { StatusPill } from "@/components/shared/status-badge";

import type { AttributeUsage } from "../service";

/**
 * Where an attribute is used (blueprint A2): every category assigning it
 * (with the exclusion rows called out), products carrying values and
 * variants built on it. Delete stays blocked while any of these is non-zero,
 * so this panel is the operator's to-do list before retiring an attribute.
 */
export function AttributeUsagePanel({ code, usage }: { code: string; usage: AttributeUsage }) {
  const productsHref = `/admin/products?attr=${encodeURIComponent(code)}` as Route;

  return (
    <div className="space-y-4 p-4 text-xs">
      <KeyValueList
        dense
        items={[
          { label: "Categories", value: String(usage.categories.length), numeric: true },
          { label: "Products with values", value: String(usage.products), numeric: true },
          { label: "Variants using it", value: String(usage.variants), numeric: true },
        ]}
      />

      <div>
        <h4 className="text-muted-foreground mb-1.5 font-semibold uppercase tracking-wide">Assigned in categories</h4>
        {usage.categories.length === 0 ? (
          <p className="text-muted-foreground">No category assigns it directly{usage.products > 0 ? " (it reaches products as a global attribute)" : ""}.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {usage.categories.map((category) => (
              <li key={category.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                <Link href={`/admin/categories/${category.id}?tab=attributes` as Route} className="flex min-w-0 flex-col hover:underline">
                  <span className="truncate font-medium">{category.name}</span>
                  <span className="text-muted-foreground truncate font-mono text-[11px]">{category.path}</span>
                </Link>
                {category.isExcluded ? <StatusPill label="Excluded" tone="warning" dot={false} /> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {usage.products > 0 ? (
        <Button asChild variant="outline" size="sm" className="w-full">
          <Link href={productsHref}>View {usage.products} product{usage.products === 1 ? "" : "s"} with values</Link>
        </Button>
      ) : null}

      {usage.total === 0 ? (
        <p className="text-muted-foreground rounded-md border border-dashed p-2">Nothing uses this attribute; it can be deleted.</p>
      ) : (
        <p className="text-muted-foreground">Deleting is blocked until every use above is removed. Deactivating hides it everywhere while keeping the data.</p>
      )}
    </div>
  );
}
