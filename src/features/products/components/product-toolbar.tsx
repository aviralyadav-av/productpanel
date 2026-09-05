"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus, X } from "lucide-react";

import {
  FilterTabs,
  SearchInput,
} from "@/components/shared/list-controls";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { mergeQuery } from "@/lib/list-params";
import { PRODUCT_STATUSES, PRODUCT_STATUS_META } from "@/lib/enums";
import type { ProductStatus } from "@/lib/enums";
import {
  PRODUCT_FLAG_META,
  type ProductFlag,
} from "@/features/products/filters";
import type { CategoryOption } from "@/features/products/queries";
import { GENDER_LABELS, type Gender } from "@/features/products/schemas";

/**
 * Every control writes to the URL. Radix Select cannot hold "" as a value, so
 * "all" is the sentinel for "no filter" and "none" for "uncategorised", which
 * is itself a real state worth filtering on.
 */
const ALL = "all";
const UNCATEGORISED = "none";

export function ProductToolbar({
  statusCounts,
  categories,
  genders,
  uncategorisedCount,
  activeFlag,
}: {
  statusCounts: Record<"all" | ProductStatus, number>;
  categories: CategoryOption[];
  genders: Array<{ value: string; count: number }>;
  uncategorisedCount: number;
  activeFlag?: ProductFlag;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const navigate = React.useCallback(
    (changes: Record<string, string | null>) => {
      const query = mergeQuery(searchParams.toString(), changes);
      router.replace(`${pathname}${query}` as never, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const category = searchParams.get("category") ?? ALL;
  const gender = searchParams.get("gender") ?? ALL;

  const parents = categories.filter((option) => option.parentId === null);
  const children = categories.filter((option) => option.parentId !== null);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          placeholder="Search title, slug or description…"
          className="w-full sm:w-64"
        />

        <FilterTabs
          paramKey="status"
          allLabel="All"
          options={PRODUCT_STATUSES.map((status) => ({
            value: status,
            label: PRODUCT_STATUS_META[status].label,
            count: statusCounts[status],
          }))}
        />

        <Select
          value={category}
          onValueChange={(value) =>
            navigate({ category: value === ALL ? null : value })
          }
        >
          <SelectTrigger size="sm" className="w-44" aria-label="Category">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            <SelectItem value={UNCATEGORISED}>
              Uncategorised ({uncategorisedCount})
            </SelectItem>
            <SelectSeparator />
            {parents.map((parent) => (
              <SelectItem key={parent.id} value={parent.id}>
                {parent.name}
              </SelectItem>
            ))}
            {children.length > 0 ? <SelectSeparator /> : null}
            {children.map((child) => (
              <SelectItem key={child.id} value={child.id}>
                {child.parentName ? `${child.parentName} › ` : ""}
                {child.name} ({child.productCount})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={gender}
          onValueChange={(value) =>
            navigate({ gender: value === ALL ? null : value })
          }
        >
          <SelectTrigger size="sm" className="w-32" aria-label="Gender">
            <SelectValue placeholder="Gender" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All genders</SelectItem>
            {genders.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {GENDER_LABELS[option.value as Gender] ?? option.value} (
                {option.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button asChild size="sm" className="ml-auto">
          <Link href="/products/new">
            <Plus />
            New product
          </Link>
        </Button>
      </div>

      {activeFlag ? (
        <div className="border-warning/30 bg-warning-muted/40 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-1.5 text-xs">
          <span className="font-medium">
            {PRODUCT_FLAG_META[activeFlag].label}
          </span>
          <span className="text-muted-foreground">
            {PRODUCT_FLAG_META[activeFlag].description}
          </span>
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto"
            onClick={() => navigate({ flag: null })}
          >
            <X />
            Clear filter
          </Button>
        </div>
      ) : null}
    </div>
  );
}
