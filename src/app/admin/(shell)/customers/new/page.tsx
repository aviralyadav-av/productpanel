import type { Metadata } from "next";

import { requirePermission } from "@/lib/auth/guards";
import { PageHeader } from "@/components/shared/page-header";

import { CustomerForm } from "@/features/customers/components/customer-form";
import { getTagSuggestions } from "@/features/customers/queries";

export const metadata: Metadata = { title: "New customer" };

/** /admin/customers/new - manual customer entry for phone orders and support cases. */
export default async function NewCustomerPage() {
  await requirePermission("customers.create");
  const tagSuggestions = await getTagSuggestions();

  return (
    <div className="space-y-4">
      <PageHeader
        title="New customer"
        description="Creates an account without a password; the customer can set one from the website through a reset link. Email must be unique."
      />
      <CustomerForm customer={null} tagSuggestions={tagSuggestions} />
    </div>
  );
}
