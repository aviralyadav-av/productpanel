import { apiList, parseListQuery, withAdminApi } from "@/lib/api/admin";

import { listInquiries } from "@/features/inquiries/queries";
import { INQUIRY_SORTS, parseInquiryFilters, parseInquirySort } from "@/features/inquiries/schemas";

/**
 * GET /api/admin/inquiries?page&pageSize&sort&order&q&status&type&priority&assignedTo(<userId>|unassigned)&from&to
 * (inquiries.view) - `{ data: InquiryListRow[], meta }`, the same rows the inbox renders.
 */
export const GET = withAdminApi(
  async ({ searchParams }) => {
    const query = parseListQuery(searchParams, { defaultSort: "createdAt", defaultOrder: "desc", allowedSorts: INQUIRY_SORTS });
    const result = await listInquiries({ ...query, sort: parseInquirySort(query.sort) }, parseInquiryFilters(query.raw));
    return apiList(result.rows, result.meta);
  },
  { permission: "inquiries.view" },
);
