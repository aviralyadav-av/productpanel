import type { Metadata } from "next";

import { can, requirePermission } from "@/lib/auth/guards";
import { one, type SearchParams } from "@/lib/list-params";
import { FilterTabs } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";

import { FooterForm } from "@/features/content/homepage/components/footer-form";
import { SectionEditorSheet, type EditorPane } from "@/features/content/homepage/components/section-editor-sheet";
import { SectionPreview } from "@/features/content/homepage/components/section-preview";
import { SectionsBoard } from "@/features/content/homepage/components/sections-board";
import {
  getFooterEditor,
  getSectionEditor,
  getSectionPreview,
  homepageKpis,
  listHomeSections,
} from "@/features/content/homepage/queries";
import { resolveHomepageTab } from "@/features/content/homepage/schemas";
import { listMenuLinkCounts } from "@/features/navigation/queries";

export const metadata: Metadata = { title: "Homepage" };

const FOOTER_MENU_SLUGS = ["footer-1", "footer-2", "footer-3"] as const;

const TAB_DESCRIPTION = {
  sections:
    "The blocks the storefront home page is built from, in the order it renders them. Each row becomes one entry in GET /api/v1/home with its items resolved server-side; disabled or out-of-window sections are left out entirely.",
  footer:
    "The brand blurb, social profiles, customer-service block, legal links and payment marks at the bottom of every storefront page. The three link columns live in Navigation.",
} as const;

function resolvePane(raw: string | undefined): EditorPane {
  return raw === "items" || raw === "preview" ? raw : "settings";
}

/**
 * /admin/homepage (blueprint 1 Homepage, 4.8, 11.26, 14.E1).
 *
 * URL state carries everything: `?tab=footer` swaps the panel, `?section=<id>`
 * opens the editor Sheet and `?pane=items|preview` picks its tab - so a link to
 * "the hero slider's preview" is shareable and Back closes the Sheet instead of
 * leaving the page. The preview is rendered HERE, on the server, because it
 * runs the storefront's own resolver for that section; the Sheet just receives
 * the node, which means every save (router.refresh) re-resolves it.
 */
export default async function HomepagePage({ searchParams }: PageProps<"/admin/homepage">) {
  const actor = await requirePermission("homepage.view");

  const params = (await searchParams) as SearchParams;
  const tab = resolveHomepageTab(one(params, "tab"));
  const sectionId = one(params, "section");
  const canManage = can(actor, "homepage.manage");

  if (tab === "footer") {
    const [footer, menuCounts] = await Promise.all([getFooterEditor(), listMenuLinkCounts(FOOTER_MENU_SLUGS)]);
    return (
      <div className="space-y-4">
        <PageHeader title="Homepage" description={TAB_DESCRIPTION.footer}>
          <FilterTabs paramKey="tab" allLabel="Sections" options={[{ value: "footer", label: "Footer" }]} />
        </PageHeader>
        <FooterForm footer={footer} canManage={canManage} menuCounts={menuCounts} />
      </div>
    );
  }

  const [rows, kpis] = await Promise.all([listHomeSections(), homepageKpis()]);
  const editor = sectionId ? await getSectionEditor(sectionId) : null;
  const preview = editor ? await getSectionPreview(editor.id) : null;

  return (
    <div className="space-y-4">
      <PageHeader title="Homepage" description={TAB_DESCRIPTION.sections}>
        <FilterTabs paramKey="tab" allLabel="Sections" options={[{ value: "footer", label: "Footer" }]} />
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Sections" value={String(kpis.total)} hint="Rows on the home page, live or not." />
        <StatCard label="Live now" value={String(kpis.live)} hint="Enabled and inside their publish window." />
        <StatCard label="Scheduled" value={String(kpis.scheduled)} hint="Waiting for their publish time." />
        <StatCard label="Expired or off" value={String(kpis.expired + kpis.disabled)} hint="Past their window, or switched off." />
      </div>

      <SectionsBoard rows={rows} canManage={canManage} />

      {editor && preview ? (
        <SectionEditorSheet
          key={editor.id}
          section={editor}
          canManage={canManage}
          pane={resolvePane(one(params, "pane"))}
          preview={<SectionPreview preview={preview} />}
        />
      ) : null}
    </div>
  );
}
