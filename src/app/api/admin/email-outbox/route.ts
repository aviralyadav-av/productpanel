import { parseListQuery, withAdminApi } from "@/lib/api/admin";
import { EMAIL_OUTBOX_SORTS, emailOutboxStats, listEmailOutbox } from "@/features/jobs/queries";

/**
 * GET /api/admin/email-outbox?status=&templateKey=&entityType=&entityId=&q=&page=&pageSize=&sort=&order=
 *
 * List envelope `{ data, meta }` (bodies omitted) plus `stats` (counts by
 * status, failures in the last 24 h, oldest due QUEUED row) for the page
 * header. Read-only: `email_outbox.view`.
 */
export const GET = withAdminApi(
  async ({ searchParams }) => {
    const query = parseListQuery(searchParams, {
      defaultSort: "createdAt",
      defaultOrder: "desc",
      allowedSorts: EMAIL_OUTBOX_SORTS,
    });
    const [{ rows, meta }, stats] = await Promise.all([
      listEmailOutbox(query, {
        status: query.filter("status"),
        templateKey: query.filter("templateKey"),
        entityType: query.filter("entityType"),
        entityId: query.filter("entityId"),
        q: query.q,
      }),
      emailOutboxStats(),
    ]);
    return Response.json({ data: rows, meta, stats }, { headers: { "Cache-Control": "no-store" } });
  },
  { permission: "email_outbox.view" },
);
