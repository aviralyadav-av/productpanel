import Link from "next/link";
import type { Route } from "next";
import { Layers } from "lucide-react";

import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { PaginationBar } from "@/components/shared/list-controls";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { SortableTh } from "@/components/shared/sortable-th";
import { StatusPill } from "@/components/shared/status-badge";
import { formatIstDate } from "@/lib/dates";
import {
  ATTRIBUTE_FILTER_TYPE_META,
  ATTRIBUTE_INPUT_TYPE_META,
  type AttributeFilterType,
  type AttributeInputType,
} from "@/lib/enums";
import type { PageMeta } from "@/lib/list-params";

import type { AttributeListRow } from "../queries";
import { AttributeRowActions } from "./attribute-row-actions";

/** Server-rendered list; sorting and paging are URL state. */
export function AttributesTable({
  rows,
  meta,
  sort,
  order,
  canManage,
  hasFilters,
}: {
  rows: AttributeListRow[];
  meta: PageMeta;
  sort: string;
  order: "asc" | "desc";
  canManage: boolean;
  hasFilters: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="surface">
        <EmptyState
          icon={Layers}
          title={hasFilters ? "No attributes match" : "No attributes yet"}
          description={
            hasFilters
              ? "Clear the search or filters to see every attribute."
              : "Attributes (size, colour, material…) are assigned to categories and give products their filters and variants."
          }
        />
      </div>
    );
  }

  return (
    <div className="surface">
      <ResponsiveTable
        table={
          <DataTable>
            <DataTableHead>
              <SortableTh column="name" label="Attribute" currentSort={sort} currentOrder={order} defaultOrder="asc" />
              <SortableTh column="inputType" label="Type" currentSort={sort} currentOrder={order} defaultOrder="asc" />
              <Th>Filter</Th>
              <Th>Unit</Th>
              <Th align="right">Values</Th>
              <Th align="right">Categories</Th>
              <Th align="right">Products</Th>
              <Th align="right">Variants</Th>
              <Th>Flags</Th>
              <SortableTh column="updatedAt" label="Updated" currentSort={sort} currentOrder={order} align="right" />
              <Th align="right" width="1%" />
            </DataTableHead>
            <DataTableBody>
              {rows.map((row) => {
                const inputMeta = ATTRIBUTE_INPUT_TYPE_META[row.inputType as AttributeInputType];
                const filterMeta = ATTRIBUTE_FILTER_TYPE_META[row.filterType as AttributeFilterType];
                const usageTotal = row.categoriesCount + row.productsCount + row.variantsCount;
                return (
                  <Tr key={row.id} className={row.isActive ? undefined : "opacity-60"}>
                    <Td>
                      <Link href={`/admin/attributes/${row.id}` as Route} className="flex flex-col hover:underline">
                        <span className="font-medium">{row.name}</span>
                        <span className="text-muted-foreground font-mono text-[11px]">{row.code}</span>
                      </Link>
                    </Td>
                    <Td>
                      <StatusPill label={inputMeta?.label ?? row.inputType} tone={inputMeta?.tone ?? "neutral"} dot={false} />
                    </Td>
                    <Td className="text-muted-foreground">{filterMeta?.label ?? row.filterType}</Td>
                    <Td className="text-muted-foreground">{row.unit ?? "—"}</Td>
                    <Td align="right" numeric>
                      {row.valuesCount}
                    </Td>
                    <Td align="right" numeric>
                      {row.categoriesCount}
                    </Td>
                    <Td align="right" numeric>
                      {row.productsCount}
                    </Td>
                    <Td align="right" numeric>
                      {row.variantsCount}
                    </Td>
                    <Td>
                      <span className="flex flex-wrap gap-1">
                        {row.isGlobal ? <StatusPill label="Global" tone="brand" dot={false} /> : null}
                        {row.isVariantDefining ? <StatusPill label="Variant" tone="info" dot={false} /> : null}
                        {!row.isActive ? <StatusPill label="Inactive" tone="warning" dot={false} /> : null}
                      </span>
                    </Td>
                    <Td align="right" numeric>
                      {formatIstDate(row.updatedAt)}
                    </Td>
                    <Td align="right">
                      <AttributeRowActions attribute={row} usageTotal={usageTotal} canManage={canManage} />
                    </Td>
                  </Tr>
                );
              })}
            </DataTableBody>
          </DataTable>
        }
        cards={rows.map((row) => (
          <MobileCard
            key={row.id}
            title={row.name}
            subtitle={row.code}
            href={`/admin/attributes/${row.id}`}
            meta={<StatusPill label={ATTRIBUTE_INPUT_TYPE_META[row.inputType as AttributeInputType]?.label ?? row.inputType} dot={false} />}
          >
            <MobileCardField label="Values" numeric>
              {row.valuesCount}
            </MobileCardField>
            <MobileCardField label="Used by" numeric>
              {row.categoriesCount} cat · {row.productsCount} prod
            </MobileCardField>
          </MobileCard>
        ))}
      />
      <PaginationBar meta={meta} itemLabel="attributes" />
    </div>
  );
}
