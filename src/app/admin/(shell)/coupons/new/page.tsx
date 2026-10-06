import type { Metadata } from "next";

import { requirePermission } from "@/lib/auth/guards";
import { PageHeader } from "@/components/shared/page-header";

import { CouponForm } from "@/features/coupons/components/coupon-form";

export const metadata: Metadata = { title: "New coupon" };

/** /admin/coupons/new - the create form; the saved coupon redirects to its edit page. */
export default async function NewCouponPage() {
  await requirePermission("coupons.manage");

  return (
    <div className="space-y-4">
      <PageHeader title="New coupon" description="Set the code, the discount, what it covers and who may use it. Nothing goes live until the coupon is active and inside its window." />
      <CouponForm mode="create" canManage />
    </div>
  );
}
