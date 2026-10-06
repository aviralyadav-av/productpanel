import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";

import { getEmailTemplateEditor } from "@/features/email/queries";
import { updateEmailTemplate } from "@/features/email/templates-service";
import { templateFormSchema } from "@/features/email/templates-schemas";

/**
 * GET|PUT /api/admin/email-templates/:id (blueprint §5.2)
 *
 * GET returns the editor payload: the record, its documented variables, the
 * outbox counters for its key, recent activity and whether a previous version
 * can be restored.
 *
 * PUT replaces the editable fields. The service sanitises `htmlBody` with the
 * `email` profile and audits the diff, exactly as the Server Action does -
 * this handler is a transport, not a second implementation.
 */
export const GET = withAdminApi<{ id: string }>(
  async ({ params }) => {
    const template = await getEmailTemplateEditor(params.id);
    if (!template) throw notFound("Email template");
    return apiOk(template);
  },
  { permission: "email_templates.view" },
);

export const PUT = withAdminApi<{ id: string }>(
  async ({ req, params, actor, ip }) => {
    const values = await parseJsonBody(req, templateFormSchema);
    const row = await updateEmailTemplate(params.id, values, actor, {
      ip,
      userAgent: req.headers.get("user-agent"),
    });
    return apiOk({
      id: row.id,
      key: row.key,
      name: row.name,
      subject: row.subject,
      htmlBody: row.htmlBody,
      textBody: row.textBody,
      isActive: row.isActive,
      updatedAt: row.updatedAt,
    });
  },
  { permission: "email_templates.manage" },
);
