import type { Metadata } from "next";
import Link from "next/link";
import { Inbox, SearchX } from "lucide-react";

import { requirePermission } from "@/lib/auth/guards";
import { INQUIRY_STATUSES, INQUIRY_STATUS_META } from "@/lib/enums";
import { parseListParams, type SearchParams } from "@/lib/list-params";
import { Button } from "@/components/ui/button";
import { DataTableToolbar } from "@/components/shared/data-table-toolbar";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterTabs, PaginationBar, SearchInput } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";

import { InquiryFilters } from "@/features/inquiries/components/inquiry-filters";
import { InquiryTable } from "@/features/inquiries/components/inquiry-table";
import { inquiryStatusCounts, listAssignableUsers, listInquiries } from "@/features/inquiries/queries";
import { hasInquiryFilters, parseInquiryFilters, parseInquirySort } from "@/features/inquiries/schemas";

export const metadata: Metadata = { title: "Inquiries" };

/** /admin/inquiries (blueprint §1 Inquiries): the contact-form inbox. */
export default async function InquiriesPage({ searchParams }: PageProps<"/admin/inquiries">) {
  await requirePermission("inquiries.view");

  const params = (await searchParams) as SearchParams;
  const list = parseListParams(params, { defaultSort: "createdAt", defaultOrder: "desc", pageSize: 25 });
  const sort = parseInquirySort(list.sort);
  const filters = parseInquiryFilters(params);

  const [counts, result, users] = await Promise.all([inquiryStatusCounts(filters), listInquiries({ ...list, sort }, filters), listAssignableUsers()]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Inquiries"
        description="Messages from the storefront contact form. Assign, reply by email (the customer gets your reply with the store signature), keep internal notes, and resolve or flag spam."
      />

      <div className="surface overflow-hidden">
        <DataTableToolbar
          search={<SearchInput placeholder="Search name, email, subject, message or order number…" />}
          filters={
            <>
              <FilterTabs
                paramKey="status"
                allLabel={`All ${counts.all}`}
                options={INQUIRY_STATUSES.map((status) => ({ value: status, label: INQUIRY_STATUS_META[status].label, count: counts[status] }))}
              />
              <InquiryFilters users={users} />
            </>
          }
        />

        {result.rows.length === 0 ? (
          hasInquiryFilters(filters) ? (
            <EmptyState
              icon={SearchX}
              title="No inquiries match these filters"
              description="Try a different search, or clear the filters."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/admin/inquiries">Clear filters</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState icon={Inbox} title="No inquiries yet" description="Messages sent through the storefront contact form (POST /api/v1/contact) appear here." />
          )
        ) : (
          <>
            <InquiryTable rows={result.rows} sort={sort} order={list.order} users={users} />
            <PaginationBar meta={result.meta} itemLabel="inquiries" />
          </>
        )}
      </div>
    </div>
  );
}
