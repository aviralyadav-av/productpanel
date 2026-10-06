import type { Metadata } from "next";

import { requirePermission } from "@/lib/auth/guards";
import { PageHeader } from "@/components/shared/page-header";

import { AttributeForm } from "@/features/attributes/components/attribute-form";

export const metadata: Metadata = { title: "New attribute" };

/** Values and usage appear on the edit page once the attribute exists. */
export default async function NewAttributePage() {
  await requirePermission("attributes.manage");

  return (
    <div className="space-y-4">
      <PageHeader
        title="New attribute"
        description="Pick the input type first: it decides which filter widgets fit and whether the attribute can define variants. The code is derived from the name and locked after creation."
      />
      <AttributeForm mode="create" canManage />
    </div>
  );
}
