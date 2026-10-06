import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { can, requirePermission } from "@/lib/auth/guards";
import { BANNER_PLACEMENT_META } from "@/lib/enums";
import { PageHeader } from "@/components/shared/page-header";
import { StatusPill } from "@/components/shared/status-badge";

import { BannerForm } from "@/features/banners/components/banner-form";
import { getBannerEditor } from "@/features/banners/queries";
import { BANNER_STATUS_META } from "@/features/banners/schemas";

export const metadata: Metadata = { title: "Banner" };

/** /admin/banners/[id] - the edit form with live preview and counters. */
export default async function BannerPage({ params }: PageProps<"/admin/banners/[id]">) {
  const actor = await requirePermission("banners.view");
  const { id } = await params;

  const banner = await getBannerEditor(id);
  if (!banner) notFound();

  const status = BANNER_STATUS_META[banner.status];
  const placement = BANNER_PLACEMENT_META[banner.placement];

  return (
    <div className="space-y-4">
      <PageHeader
        title={banner.title}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusPill label={status.label} tone={status.tone} />
            <StatusPill label={placement.label} tone={placement.tone} dot={false} />
            <span className="text-muted-foreground">Position {banner.position}</span>
          </span>
        }
      />
      <BannerForm mode="edit" banner={banner} canManage={can(actor, "banners.manage")} />
    </div>
  );
}
