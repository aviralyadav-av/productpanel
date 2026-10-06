import type { Metadata } from "next";

import { requirePermission } from "@/lib/auth/guards";
import { PageHeader } from "@/components/shared/page-header";

import { PromotionForm } from "@/features/promotions/components/promotion-form";

export const metadata: Metadata = { title: "New promotion" };

/** /admin/promotions/new - the create form; saving redirects to the promotion's edit page. */
export default async function NewPromotionPage() {
  await requirePermission("promotions.manage");

  return (
    <div className="space-y-4">
      <PageHeader title="New promotion" description="Pick the discount, the scope and the window. Products are re-priced the moment you save if the window is already open." />
      <PromotionForm mode="create" canManage />
    </div>
  );
}
