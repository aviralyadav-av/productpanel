import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Star } from "lucide-react";

import { can, requirePermission } from "@/lib/auth/guards";
import { formatIstDateTime } from "@/lib/dates";
import { BLOG_STATUS_META } from "@/lib/enums";
import { one, type SearchParams } from "@/lib/list-params";
import { getSettingString } from "@/lib/settings";
import { HtmlPreview } from "@/components/shared/html-preview";
import { FilterTabs } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { StatusPill } from "@/components/shared/status-badge";

import { blogPreviewUrlAction } from "@/features/blog/actions";
import { PostForm } from "@/features/blog/components/post-form";
import { getBlogPostEditor, listBlogCategories, listBlogTags } from "@/features/blog/queries";
import { effectiveBlogStatus, resolveBlogTab, storefrontBlogUrl } from "@/features/blog/schemas";
import { ContentActivity } from "@/features/pages/components/activity-list";
import { PreviewButton } from "@/features/pages/components/preview-button";
import { listAuthorOptions, listContentActivity } from "@/features/pages/queries";
import { formatReadingTime } from "@/features/pages/text";

export const metadata: Metadata = { title: "Blog post" };

/**
 * /admin/blog/[id]?tab=editor|preview|activity - the post editor, the saved
 * HTML in a sandboxed iframe, and the audit trail. Tabs live in the URL.
 */
export default async function BlogPostEditPage({ params, searchParams }: PageProps<"/admin/blog/[id]">) {
  const actor = await requirePermission("blog.view");
  const { id } = await params;
  const query = (await searchParams) as SearchParams;
  const tab = resolveBlogTab(one(query, "tab"));

  const [post, storefrontBaseUrl] = await Promise.all([getBlogPostEditor(id), getSettingString("storefront.base_url")]);
  if (!post) notFound();

  const [categories, tags, authors, activity] = await Promise.all([
    tab === "editor" ? listBlogCategories() : Promise.resolve([]),
    tab === "editor" ? listBlogTags() : Promise.resolve([]),
    tab === "editor" ? listAuthorOptions() : Promise.resolve([]),
    tab === "activity" ? listContentActivity("BlogPost", id) : Promise.resolve([]),
  ]);

  const status = BLOG_STATUS_META[post.status];
  const effective = effectiveBlogStatus(post);

  return (
    <div className="space-y-4">
      <PageHeader
        title={post.title}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusPill label={status.label} tone={status.tone} />
            {effective !== post.status ? <StatusPill label={`Live: ${BLOG_STATUS_META[effective].label}`} tone={BLOG_STATUS_META[effective].tone} dot={false} /> : null}
            {post.isFeatured ? (
              <span className="text-warning inline-flex items-center gap-1 text-xs">
                <Star className="size-3 fill-current" /> Featured
              </span>
            ) : null}
            <span className="text-muted-foreground font-mono text-[11px]">{storefrontBlogUrl(storefrontBaseUrl || "", post.slug)}</span>
            <span className="text-muted-foreground">{formatReadingTime(post.readingMinutes)}</span>
            {post.publishedAt ? <span className="text-muted-foreground">{post.status === "SCHEDULED" ? "Goes live" : "Published"} {formatIstDateTime(post.publishedAt)}</span> : null}
          </span>
        }
        actions={<PreviewButton action={blogPreviewUrlAction.bind(null, post.id)} />}
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

      {tab === "editor" ? (
        <PostForm mode="edit" post={post} categories={categories} authors={authors} actorId={actor.id} tagSuggestions={tags.map((entry) => entry.tag)} canManage={can(actor, "blog.manage")} canPublish={can(actor, "blog.publish")} storefrontBaseUrl={storefrontBaseUrl} />
      ) : null}
      {tab === "preview" ? (
        <div className="surface space-y-2 p-4">
          <p className="text-muted-foreground text-xs">The saved, sanitised body exactly as the public API returns it. Unsaved edits are not shown here.</p>
          <HtmlPreview html={post.content} title={`Preview of ${post.title}`} minHeight={480} />
        </div>
      ) : null}
      {tab === "activity" ? <ContentActivity rows={activity} entityLabel="post" /> : null}
    </div>
  );
}
