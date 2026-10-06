import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { requirePermission } from "@/lib/auth/guards";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";

import { InquirySidebar } from "@/features/inquiries/components/inquiry-sidebar";
import { InquiryThread } from "@/features/inquiries/components/inquiry-thread";
import { getInquiryDetail, listAssignableUsers } from "@/features/inquiries/queries";

export const metadata: Metadata = { title: "Inquiry" };

/** /admin/inquiries/[id]: the conversation on the left, triage on the right. */
export default async function InquiryDetailPage({ params }: PageProps<"/admin/inquiries/[id]">) {
  await requirePermission("inquiries.view");
  const { id } = await params;

  const [inquiry, users] = await Promise.all([getInquiryDetail(id), listAssignableUsers()]);
  if (!inquiry) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={inquiry.subject}
        description={`${inquiry.name} · ${inquiry.email}`}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/inquiries">
              <ArrowLeft />
              All inquiries
            </Link>
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <InquiryThread inquiry={inquiry} />
        <InquirySidebar inquiry={inquiry} users={users} />
      </div>
    </div>
  );
}
