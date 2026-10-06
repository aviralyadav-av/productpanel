import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { ArrowLeft } from "lucide-react";

import { requirePermission } from "@/lib/auth/guards";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";

import { ManualOrderForm } from "@/features/orders/components/manual-order-form";

export const metadata: Metadata = { title: "New order" };

/**
 * /admin/orders/new (blueprint §10 createManualOrder, §14.C3).
 *
 * The whole screen is one client island because every field feeds the live
 * re-pricing call; there is nothing here that could usefully render on the
 * server first.
 */
export default async function NewOrderPage() {
  await requirePermission("orders.create");

  return (
    <div className="space-y-4">
      <PageHeader
        title="New order"
        description="Key an order taken over the phone or at a counter. It is priced by the same engine as the storefront: stock, customisation rules, coupons, shipping rates and tax all apply."
        actions={
          <Button asChild size="sm" variant="ghost">
            <Link href={"/admin/orders" as Route}>
              <ArrowLeft /> All orders
            </Link>
          </Button>
        }
      />
      <ManualOrderForm />
    </div>
  );
}
