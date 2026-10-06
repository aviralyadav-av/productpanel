import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { Plus } from "lucide-react";

import { can, requirePermission } from "@/lib/auth/guards";
import { parseListParams, type SearchParams } from "@/lib/list-params";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";

import { AttributesTable } from "@/features/attributes/components/attributes-table";
import { AttributeExportButton, AttributesToolbar } from "@/features/attributes/components/attributes-toolbar";
import { listAttributes } from "@/features/attributes/queries";
import { parseAttributeListFilters, resolveAttributeSort } from "@/features/attributes/schemas";

export const metadata: Metadata = { title: "Attributes" };

/**
 * /admin/attributes?q=&type=&global=&active=&sort=&order=&page=
 *
 * The list is about usage: an attribute's value to the catalogue is how many
 * categories, products and variants lean on it, and whether it can be
 * retired. Everything is URL state.
 */
export default async function AttributesPage({ searchParams }: PageProps<"/admin/attributes">) {
  const actor = await requirePermission("attributes.view");
  const params = (await searchParams) as SearchParams;
  const listParams = parseListParams(params, { defaultSort: "position", defaultOrder: "asc" });
  const filters = parseAttributeListFilters(params);
  const sort = resolveAttributeSort(listParams.sort);
  const result = await listAttributes({ ...listParams, sort }, filters);
  const canManage = can(actor, "attributes.manage");
  const hasFilters = Boolean(listParams.q || filters.inputType || filters.global !== undefined || filters.active !== undefined);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Attributes"
        description="Attribute definitions (size, colour, material) and their values. Assign them to categories to give products filters, specs and variant axes; global attributes apply everywhere."
        actions={
          <>
            <AttributeExportButton />
            {canManage ? (
              <Button asChild size="sm">
                <Link href={"/admin/attributes/new" as Route}>
                  <Plus /> New attribute
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <div className="surface">
        <AttributesToolbar counts={result.counts} />
        <AttributesTable rows={result.rows} meta={result.meta} sort={sort} order={listParams.order} canManage={canManage} hasFilters={hasFilters} />
      </div>
    </div>
  );
}
