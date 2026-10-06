import type { Metadata } from "next";
import Link from "next/link";
import { SearchX } from "lucide-react";

import { requireAdmin } from "@/lib/auth/guards";
import { one } from "@/lib/list-params";
import {
  SEARCH_MAX_QUERY,
  SEARCH_SCOPE_LABELS,
  groupHits,
  parseScopesParam,
  searchAdmin,
} from "@/features/search/service";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { EmptyState } from "@/components/shared/empty-state";
import { ProductThumb } from "@/components/shared/product-thumb";
import { SearchInput } from "@/components/shared/list-controls";
import { CountBadge } from "@/components/shared/count-badge";

export const metadata: Metadata = { title: "Search" };

/**
 * The full-page form of ⌘K: same service, same permission filtering (D14),
 * more results per scope. State lives in the URL (?q=&scopes=) so a search
 * can be bookmarked or shared with a colleague who holds the same permissions.
 */
export default async function SearchPage({ searchParams }: PageProps<"/admin/search">) {
  const actor = await requireAdmin();
  const params = await searchParams;
  const q = (one(params, "q") ?? "").trim().slice(0, SEARCH_MAX_QUERY);
  const scopes = parseScopesParam(one(params, "scopes"));

  const result = q ? await searchAdmin(actor, { q, scopes, limit: 20 }) : { results: [] };
  const groups = groupHits(result.results);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Search"
        description="Products, orders, customers, sellers, categories, coupons, pages and blog posts - limited to the modules your role can view."
      >
        <SearchInput placeholder="Search by name, number, email, SKU or slug…" className="w-full sm:max-w-md" />
      </PageHeader>

      {!q ? (
        <div className="surface">
          <EmptyState
            title="Type something to search"
            description="Tip: press ⌘K anywhere in the admin for the same search without leaving the page."
          />
        </div>
      ) : groups.length === 0 ? (
        <div className="surface">
          <EmptyState
            icon={SearchX}
            title={`Nothing matched “${q}”`}
            description="Check the spelling, try a shorter fragment, or a different identifier such as an order number or SKU."
          />
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {groups.map((group) => (
            <Panel
              key={group.scope}
              title={SEARCH_SCOPE_LABELS[group.scope].plural}
              action={<CountBadge count={group.hits.length} tone="neutral" />}
              bodyClassName="p-0"
            >
              <ul className="divide-y">
                {group.hits.map((hit) => (
                  <li key={hit.id}>
                    <Link
                      href={hit.href as never}
                      className="hover:bg-accent/60 flex items-center gap-3 px-3 py-2 text-xs"
                    >
                      <ProductThumb src={hit.imageUrl} alt="" size={32} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{hit.title}</p>
                        {hit.subtitle ? (
                          <p className="text-muted-foreground truncate text-[11px]">{hit.subtitle}</p>
                        ) : null}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
