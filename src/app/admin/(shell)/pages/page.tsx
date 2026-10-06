import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { Plus } from "lucide-react";

import { can, requirePermission } from "@/lib/auth/guards";
import { parseListParams, type SearchParams } from "@/lib/list-params";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";

import { PagesTable } from "@/features/pages/components/pages-table";
import { PagesToolbar } from "@/features/pages/components/pages-toolbar";
import { listPageAuthors, listPages } from "@/features/pages/queries";
import { parsePageListFilters, resolvePageSort } from "@/features/pages/schemas";

export const metadata: Metadata = { title: "Pages" };

/**
 * /admin/pages (blueprint §1 Pages, E5): every CMS page with status tabs,
 * template / kind / footer / author filters, search, sortable columns and
 * row actions. All list state is in the URL.
 */
export default async function PagesPage({ searchParams }: PageProps<"/admin/pages">) {
  const actor = await requirePermission("pages.view");

  const raw = (await searchParams) as SearchParams;
  const params = parseListParams(raw, { defaultSort: "updatedAt", defaultOrder: "desc" });
  const sort = resolvePageSort(params.sort);
  const filters = parsePageListFilters(raw);
  const canManage = can(actor, "pages.manage");
  const canPublish = can(actor, "pages.publish");

  const [result, authors] = await Promise.all([listPages({ ...params, sort }, filters), listPageAuthors()]);
  const filtered = Boolean(filters.q || filters.status || filters.template || filters.system !== undefined || filters.footer !== undefined || filters.authorId);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pages"
        description="Static storefront pages - About, Contact, policies and anything else - with rich text, SEO and draft/publish. System pages cannot be deleted and keep their address."
        actions={
          canManage ? (
            <Button asChild size="sm">
              <Link href={"/admin/pages/new" as Route}>
                <Plus /> New page
              </Link>
            </Button>
          ) : undefined
        }
      />

      <PagesToolbar statusCounts={result.statusCounts} authors={authors} />

      <div className="surface overflow-hidden">
        <PagesTable rows={result.rows} meta={result.meta} params={{ ...params, sort }} canManage={canManage} canPublish={canPublish} filtered={filtered} />
      </div>
    </div>
  );
}
