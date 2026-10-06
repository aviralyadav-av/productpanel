import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { can, requirePermission } from "@/lib/auth/guards";
import { formatIstDateTime } from "@/lib/dates";
import { CMS_PAGE_STATUS_META, CMS_PAGE_TEMPLATE_META } from "@/lib/enums";
import { one, type SearchParams } from "@/lib/list-params";
import { getSettingString } from "@/lib/settings";
import { HtmlPreview } from "@/components/shared/html-preview";
import { FilterTabs } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { StatusPill } from "@/components/shared/status-badge";

import { pagePreviewUrlAction } from "@/features/pages/actions";
import { ContentActivity } from "@/features/pages/components/activity-list";
import { PageForm } from "@/features/pages/components/page-form";
import { PreviewButton } from "@/features/pages/components/preview-button";
import { getPageEditor, listContentActivity } from "@/features/pages/queries";
import { resolvePageTab, storefrontPageUrl } from "@/features/pages/schemas";
import { countWords, formatReadingTime, readingMinutes } from "@/features/pages/text";

export const metadata: Metadata = { title: "Page" };

/**
 * /admin/pages/[id]?tab=editor|preview|activity
 *
 * The editor tab is the form; the preview tab renders the SAVED, sanitised
 * HTML in a sandboxed iframe (what the storefront will receive); activity is
 * the audit trail. Tabs live in the URL so a link to "the activity of the
 * privacy policy" is a link.
 */
export default async function PageEditPage({ params, searchParams }: PageProps<"/admin/pages/[id]">) {
  const actor = await requirePermission("pages.view");
  const { id } = await params;
  const query = (await searchParams) as SearchParams;
  const tab = resolvePageTab(one(query, "tab"));

  const [page, storefrontBaseUrl] = await Promise.all([getPageEditor(id), getSettingString("storefront.base_url")]);
  if (!page) notFound();

  const activity = tab === "activity" ? await listContentActivity("CmsPage", id) : [];
  const canManage = can(actor, "pages.manage");
  const canPublish = can(actor, "pages.publish");
  const status = CMS_PAGE_STATUS_META[page.status];
  const words = countWords(page.content);

  return (
    <div className="space-y-4">
      <PageHeader
        title={page.title}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusPill label={status.label} tone={status.tone} />
            {page.isSystem ? <StatusPill label="System page" tone="brand" dot={false} /> : null}
            <StatusPill label={CMS_PAGE_TEMPLATE_META[page.template].label} tone="neutral" dot={false} />
            <span className="text-muted-foreground font-mono text-[11px]">{storefrontPageUrl(storefrontBaseUrl || "", page.slug)}</span>
            <span className="text-muted-foreground" data-numeric>
              {words.toLocaleString("en-IN")} words · {formatReadingTime(readingMinutes(words))}
            </span>
            {page.publishedAt ? <span className="text-muted-foreground">Published {formatIstDateTime(page.publishedAt)}</span> : null}
          </span>
        }
        actions={<PreviewButton action={pagePreviewUrlAction.bind(null, page.id)} />}
      >
        <FilterTabs
          paramKey="tab"
          allLabel="Editor"
          options={[
            { value: "preview", label: "HTML preview" },
            { value: "activity", label: "Activity" },
          ]}
        />
      </PageHeader>

      {tab === "editor" ? <PageForm mode="edit" page={page} canManage={canManage} canPublish={canPublish} storefrontBaseUrl={storefrontBaseUrl} /> : null}
      {tab === "preview" ? (
        <div className="surface space-y-2 p-4">
          <p className="text-muted-foreground text-xs">The saved, sanitised body exactly as the public API returns it. Unsaved edits in the editor are not shown here.</p>
          <HtmlPreview html={page.content} title={`Preview of ${page.title}`} minHeight={480} />
        </div>
      ) : null}
      {tab === "activity" ? <ContentActivity rows={activity} entityLabel="page" /> : null}
    </div>
  );
}
