import type { Metadata } from "next";

import { can, requirePermission } from "@/lib/auth/guards";
import { getSettingString } from "@/lib/settings";
import { PageHeader } from "@/components/shared/page-header";

import { PostForm } from "@/features/blog/components/post-form";
import { listBlogCategories, listBlogTags } from "@/features/blog/queries";
import { listAuthorOptions } from "@/features/pages/queries";

export const metadata: Metadata = { title: "New post" };

/** /admin/blog/new - the create form; saving redirects to the editor. */
export default async function NewBlogPostPage() {
  const actor = await requirePermission("blog.manage");
  const [categories, tags, authors, storefrontBaseUrl] = await Promise.all([listBlogCategories(), listBlogTags(), listAuthorOptions(), getSettingString("storefront.base_url")]);

  return (
    <div className="space-y-4">
      <PageHeader title="New post" description="Write the post, pick a category and tags, then publish now or schedule it. You are the default author." />
      <PostForm mode="create" categories={categories} authors={authors} actorId={actor.id} tagSuggestions={tags.map((entry) => entry.tag)} canManage canPublish={can(actor, "blog.publish")} storefrontBaseUrl={storefrontBaseUrl} />
    </div>
  );
}
