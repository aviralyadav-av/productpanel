import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { Plus } from "lucide-react";

import { can, requirePermission } from "@/lib/auth/guards";
import type { SearchParams } from "@/lib/list-params";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";

import { BannerBoard } from "@/features/banners/components/banner-board";
import { BannersToolbar } from "@/features/banners/components/banners-toolbar";
import { listBannerGroups } from "@/features/banners/queries";
import { parseBannerListFilters } from "@/features/banners/schemas";

export const metadata: Metadata = { title: "Banners" };

/**
 * /admin/banners (blueprint §1 Banners, §14.E1): one sortable list per
 * placement. URL state: placement, status, q. Dragging is only offered on the
 * unfiltered board because positions are relative to the whole placement.
 */
export default async function BannersPage({ searchParams }: PageProps<"/admin/banners">) {
  const actor = await requirePermission("banners.view");

  const params = (await searchParams) as SearchParams;
  const filters = parseBannerListFilters(params);
  const canManage = can(actor, "banners.manage");
  const filtered = Boolean(filters.status || filters.q);

  const board = await listBannerGroups(filters);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Banners"
        description="Creative by placement, with scheduling and typed links. The homepage hero slider and promo tiles read the HOME_HERO and HOME_PROMO placements in this order."
        actions={
          canManage ? (
            <Button asChild size="sm">
              <Link href={"/admin/banners/new" as Route}>
                <Plus /> New banner
              </Link>
            </Button>
          ) : undefined
        }
      />

      <BannersToolbar statusCounts={board.statusCounts} />

      <BannerBoard groups={board.groups} canManage={canManage} filtered={filtered} />
    </div>
  );
}
