import type { Metadata } from "next";

import { requirePermission } from "@/lib/auth/guards";
import { PageHeader } from "@/components/shared/page-header";

import { SellerForm } from "@/features/sellers/components/seller-form";

export const metadata: Metadata = { title: "New seller" };

/** /admin/sellers/new - admin-side registration (blueprint §1 Sellers, C5). */
export default async function SellersNewPage() {
  await requirePermission("sellers.create");

  return (
    <div className="space-y-4">
      <PageHeader
        title="New seller"
        description="Register a seller from the admin. Start them as Pending to run the normal KYC review, or Active when you already vouch for them."
      />
      <SellerForm />
    </div>
  );
}
