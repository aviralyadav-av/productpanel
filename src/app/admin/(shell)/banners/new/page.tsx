import type { Metadata } from "next";

import { requirePermission } from "@/lib/auth/guards";
import { BANNER_PLACEMENTS, type BannerPlacement } from "@/lib/enums";
import { one, type SearchParams } from "@/lib/list-params";
import { PageHeader } from "@/components/shared/page-header";

import { BannerForm } from "@/features/banners/components/banner-form";

export const metadata: Metadata = { title: "New banner" };

/** /admin/banners/new?placement=HOME_HERO - the create form, pre-set to the placement the board was on. */
export default async function NewBannerPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("banners.manage");
  const raw = one(await searchParams, "placement");
  const placement = (BANNER_PLACEMENTS as readonly string[]).includes(raw ?? "") ? (raw as BannerPlacement) : "HOME_HERO";

  return (
    <div className="space-y-4">
      <PageHeader title="New banner" description="Choose the placement, add the creative and the link, then schedule it. The preview on the right updates as you type." />
      <BannerForm mode="create" canManage defaultPlacement={placement} />
    </div>
  );
}
