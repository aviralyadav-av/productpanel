import { Filter } from "lucide-react";

import { formatPaise } from "@/lib/money";
import { EmptyState } from "@/components/shared/empty-state";
import type { Facet, FacetsPayload } from "@/features/catalog/facets";

/**
 * "Storefront filter preview" (blueprint A2): a static render of the exact
 * payload `GET /api/v1/products?category=…&include=facets` returns, built by
 * the same `buildFacets`. Checkbox lists, swatches and ranges are drawn the
 * way a shop sidebar would draw them so an operator can judge whether the
 * attribute set is right without opening the website.
 */
export function FacetPreview({ payload }: { payload: FacetsPayload }) {
  if (payload.total === 0) {
    return (
      <EmptyState
        compact
        icon={Filter}
        title="No published products yet"
        description="Facets are counted over live products in this category and its sub-categories. Publish a product with attribute values and the filters appear here."
      />
    );
  }

  return (
    <div className="space-y-4 p-4 text-xs">
      <p className="text-muted-foreground" data-numeric>
        {payload.total} product{payload.total === 1 ? "" : "s"} · {payload.facets.length} attribute filter{payload.facets.length === 1 ? "" : "s"}
      </p>

      {payload.priceRangePaise ? (
        <FacetBlock title="Price">
          <RangeBar min={formatPaise(payload.priceRangePaise.min)} max={formatPaise(payload.priceRangePaise.max)} />
        </FacetBlock>
      ) : null}

      {payload.facets.length === 0 ? (
        <p className="text-muted-foreground rounded-md border border-dashed p-3">
          No attribute facets: none of the effective attributes is filterable, or no product carries a value for them yet.
        </p>
      ) : (
        payload.facets.map((facet) => <FacetView key={facet.code} facet={facet} />)
      )}

      <FacetBlock title="Availability">
        <CheckRow label="In stock" count={payload.builtinFacets.availability.inStock} />
        {payload.builtinFacets.customizable.count > 0 ? (
          <CheckRow label="Customisable" count={payload.builtinFacets.customizable.count} />
        ) : null}
      </FacetBlock>

      {payload.builtinFacets.sellers.length > 0 ? (
        <FacetBlock title="Sellers">
          {payload.builtinFacets.sellers.slice(0, 8).map((seller) => (
            <CheckRow key={seller.id} label={seller.name} count={seller.count} />
          ))}
        </FacetBlock>
      ) : null}

      {payload.builtinFacets.rating.length > 0 ? (
        <FacetBlock title="Rating">
          {payload.builtinFacets.rating.map((bucket) => (
            <CheckRow key={bucket.min} label={`${"★".repeat(bucket.min)}${"☆".repeat(5 - bucket.min)} & up`} count={bucket.count} />
          ))}
        </FacetBlock>
      ) : null}
    </div>
  );
}

function FacetView({ facet }: { facet: Facet }) {
  const suffix = facet.unit ? ` (${facet.unit})` : "";
  if (facet.range) {
    return (
      <FacetBlock title={`${facet.name}${suffix}`} kind={facet.filterType}>
        <RangeBar min={String(facet.range.min)} max={String(facet.range.max)} />
      </FacetBlock>
    );
  }
  const values = facet.values ?? [];
  if (facet.filterType === "COLOR_SWATCH") {
    return (
      <FacetBlock title={facet.name} kind={facet.filterType}>
        <div className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <span key={value.value} className="inline-flex items-center gap-1 rounded-full border py-0.5 pr-2 pl-0.5" title={`${value.label} (${value.count})`}>
              <span className="size-4 rounded-full border" style={{ backgroundColor: value.colorHex ?? "#ddd" }} aria-hidden />
              <span>{value.label}</span>
              <span className="text-muted-foreground" data-numeric>
                {value.count}
              </span>
            </span>
          ))}
        </div>
      </FacetBlock>
    );
  }
  if (facet.filterType === "TOGGLE") {
    return (
      <FacetBlock title={facet.name} kind={facet.filterType}>
        {values.map((value) => (
          <div key={value.value} className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span className="bg-input relative inline-block h-3.5 w-6 rounded-full">
                <span className="bg-background absolute top-0.5 left-0.5 size-2.5 rounded-full shadow" />
              </span>
              {value.label}
            </span>
            <span className="text-muted-foreground" data-numeric>
              {value.count}
            </span>
          </div>
        ))}
      </FacetBlock>
    );
  }
  return (
    <FacetBlock title={`${facet.name}${suffix}`} kind={facet.filterType}>
      {values.map((value) => (
        <CheckRow key={value.value} label={value.label} count={value.count} radio={facet.filterType === "RADIO"} />
      ))}
    </FacetBlock>
  );
}

function FacetBlock({ title, kind, children }: { title: string; kind?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <header className="flex items-center justify-between">
        <h4 className="font-semibold">{title}</h4>
        {kind ? <span className="text-muted-foreground font-mono text-[10px] uppercase">{kind.toLowerCase().replace("_", " ")}</span> : null}
      </header>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function CheckRow({ label, count, radio = false }: { label: string; count: number; radio?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-2">
        <span className={radio ? "border-input size-3 shrink-0 rounded-full border" : "border-input size-3 shrink-0 rounded-[3px] border"} aria-hidden />
        <span className="truncate">{label}</span>
      </span>
      <span className="text-muted-foreground shrink-0" data-numeric>
        {count}
      </span>
    </div>
  );
}

function RangeBar({ min, max }: { min: string; max: string }) {
  return (
    <div className="space-y-1">
      <div className="bg-muted relative h-1.5 rounded-full">
        <div className="bg-brand absolute inset-y-0 left-[8%] right-[12%] rounded-full" />
        <span className="bg-background border-brand absolute top-1/2 left-[8%] size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2" />
        <span className="bg-background border-brand absolute top-1/2 right-[12%] size-3 translate-x-1/2 -translate-y-1/2 rounded-full border-2" />
      </div>
      <div className="text-muted-foreground flex justify-between" data-numeric>
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
