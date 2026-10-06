import type { Metadata } from "next";

import { can, requirePermission } from "@/lib/auth/guards";
import { getSettingString } from "@/lib/settings";
import { PageHeader } from "@/components/shared/page-header";

import { PageForm } from "@/features/pages/components/page-form";

export const metadata: Metadata = { title: "New page" };

/** /admin/pages/new - the create form. Saving redirects to the editor. */
export default async function NewPagePage() {
  const actor = await requirePermission("pages.manage");
  const storefrontBaseUrl = await getSettingString("storefront.base_url");

  return (
    <div className="space-y-4">
      <PageHeader title="New page" description="Write the content, set the template and SEO, then publish - or leave it as a draft and preview it on the storefront first." />
      <PageForm mode="create" canManage canPublish={can(actor, "pages.publish")} storefrontBaseUrl={storefrontBaseUrl} />
    </div>
  );
}
