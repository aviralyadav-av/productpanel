import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { loadTemplate, previewTemplate } from "@/features/email/templates-service";
import { previewTemplateSchema } from "@/features/email/templates-schemas";

/**
 * POST /api/admin/email-templates/:id/preview  { vars?: Record<string,string> }
 *
 * Renders the STORED template with sample data, overridden by whatever the
 * caller passes. Read-only despite being a POST: the variables are a body, not
 * a query string, and some of them (an items table) are far too big for a URL.
 *
 * The response includes `unknownVariables` so a client can show the same
 * warning the editor shows, and `vars` so it can see what the sample data was.
 */
export const POST = withAdminApi<{ id: string }>(
  async ({ req, params }) => {
    const body = await parseJsonBody(req, previewTemplateSchema);
    const template = await loadTemplate(params.id);
    const preview = previewTemplate(template, body.vars ?? {});

    return apiOk({
      key: template.key,
      subject: preview.subject,
      html: preview.html,
      text: preview.text,
      vars: preview.vars,
      unknownVariables: preview.unknownVariables,
    });
  },
  { permission: "email_templates.view" },
);
