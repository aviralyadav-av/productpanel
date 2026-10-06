import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { can, requirePermission } from "@/lib/auth/guards";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { StatusPill } from "@/components/shared/status-badge";

import { TemplateEditor } from "@/features/email/components/template-editor";
import { getEmailTemplateEditor } from "@/features/email/queries";

export const metadata: Metadata = { title: "Email template" };

/**
 * /admin/email-templates/[id] - edit one transactional email.
 *
 * The id is the record id, not the key: the key is the immutable contract
 * between the event matrix and the queue (`queueEmail({ templateKey })`), and
 * a URL that could be renamed would be a URL that breaks.
 */
export default async function EmailTemplatePage({ params }: PageProps<"/admin/email-templates/[id]">) {
  const actor = await requirePermission("email_templates.view");
  const { id } = await params;

  const template = await getEmailTemplateEditor(id);
  if (!template) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={template.name}
        description={template.eventDescription ?? undefined}
        actions={
          <div className="flex items-center gap-2">
            <StatusPill
              label={template.isActive ? "Active" : "Disabled"}
              tone={template.isActive ? "success" : "neutral"}
            />
            <Button asChild variant="outline" size="sm">
              <Link href={"/admin/email-templates" as Route}>
                <ArrowLeft /> All templates
              </Link>
            </Button>
          </div>
        }
      />

      <TemplateEditor template={template} canManage={can(actor, "email_templates.manage")} />
    </div>
  );
}
