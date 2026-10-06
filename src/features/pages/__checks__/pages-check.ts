import "dotenv/config";

import { db } from "@/lib/db";
import { verifyPreviewToken } from "@/lib/preview-token";
import { createBlogPost, deleteBlogPost, issueBlogPreviewToken, setBlogPostStatus } from "@/features/blog/service";
import { blogPostFormSchema } from "@/features/blog/schemas";
import { createFaq, deleteFaq, reorderFaqs, setFaqFlag } from "@/features/faqs/service";
import { faqFormSchema } from "@/features/faqs/schemas";
import { createPage, deletePage, duplicatePage, issuePagePreviewToken, setPageStatus } from "@/features/pages/service";
import { pageFormSchema } from "@/features/pages/schemas";
import { countWords, readingMinutes } from "@/features/pages/text";

/**
 * End-to-end check of the CMS modules against the REAL database (§14.G):
 *
 *   npx tsx src/features/pages/__checks__/pages-check.ts
 *
 * It exercises the write paths a route cannot: create → publish → preview
 * token → duplicate → delete for a page, the same for a blog post (including
 * the SCHEDULED ⇄ PUBLISHED normalisation that replaces the publish job), and
 * create → reorder → toggle → delete for FAQs. Every row it writes is prefixed
 * `check_` / `check-` and removed in a finally block, so it is safe to run
 * against the seeded demo database.
 *
 * What it asserts is the behaviour the UI depends on and types cannot express:
 * HTML is sanitised on write, slugs de-duplicate instead of colliding, a
 * preview token verifies for its own entity and not for another, publishing
 * stamps `publishedAt`, a future publish date becomes SCHEDULED, reading time
 * is derived from the body, and FAQ positions stay contiguous after a move.
 */

const PREFIX = "check_";
const SLUG = "check-cms-probe";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
}

const created = { pageIds: [] as string[], postIds: [] as string[], faqIds: [] as string[] };

async function main(): Promise<void> {
  const admin = await db.user.findFirst({ where: { isActive: true, deletedAt: null }, select: { id: true, email: true, name: true } });
  assert(admin, "an active admin user exists to act as");
  const actor = { id: admin.id, email: admin.email };
  const ctx = { actor, canPublish: true };

  // -- PAGES ---------------------------------------------------------------
  // A script tag and an external image prove the `rich` sanitiser runs on write.
  const pageInput = pageFormSchema.parse({
    title: `${PREFIX}CMS probe`,
    slug: SLUG,
    excerpt: "Written by pages-check.",
    content: '<h2>Heading</h2><p>Body text <strong>bold</strong>.</p><script>alert(1)</script><img src="https://evil.example.com/x.png" alt="x">',
    template: "DEFAULT",
    status: "DRAFT",
    showInFooter: false,
    noIndex: false,
  });

  const page = await createPage(pageInput, ctx);
  created.pageIds.push(page.id);
  assert(page.slug === SLUG, `page slug is ${SLUG}, got ${page.slug}`);
  assert(!page.content.includes("<script"), "the script tag was stripped on write");
  assert(!page.content.includes("evil.example.com"), "the off-origin image was stripped on write");
  assert(page.content.includes("<h2>"), "rich profile keeps headings");
  assert(page.status === "DRAFT" && page.publishedAt === null, "a draft has no publish date");
  assert(page.isSystem === false, "a created page is never a system page");

  // §11.23: a second page with the same wanted slug is suffixed, not rejected.
  const twin = await createPage(pageInput, ctx);
  created.pageIds.push(twin.id);
  assert(twin.slug !== page.slug && twin.slug.startsWith(SLUG), `duplicate slug was suffixed, got ${twin.slug}`);

  const published = await setPageStatus(page.id, { status: "PUBLISHED" }, ctx);
  assert(published.status === "PUBLISHED" && published.publishedAt !== null, "publishing stamps publishedAt");

  const unpublished = await setPageStatus(page.id, { status: "DRAFT" }, ctx);
  assert(unpublished.status === "DRAFT" && unpublished.publishedAt !== null, "unpublishing keeps the historical publish date");

  const pageToken = await issuePagePreviewToken(page.id, actor);
  assert(verifyPreviewToken(pageToken.token, { entity: "page", id: page.id }).ok, "the page preview token verifies for its own page");
  assert(!verifyPreviewToken(pageToken.token, { entity: "page", id: twin.id }).ok, "the page preview token is bound to one id");
  assert(!verifyPreviewToken(pageToken.token, { entity: "blog", id: page.id }).ok, "the page preview token is bound to one entity type");

  const copy = await duplicatePage(page.id, ctx);
  created.pageIds.push(copy.id);
  assert(copy.status === "DRAFT" && copy.publishedAt === null, "a duplicate is always an unpublished draft");
  assert(copy.slug !== page.slug, "a duplicate gets its own slug");

  const words = countWords(page.content);
  assert(words > 0 && readingMinutes(words) >= 1, "word count and reading time are derived from the body");

  // -- BLOG ----------------------------------------------------------------
  const post = await createBlogPost(
    blogPostFormSchema.parse({
      title: `${PREFIX}CMS probe post`,
      slug: `${SLUG}-post`,
      content: `<p>${"word ".repeat(400)}</p><script>alert(1)</script>`,
      status: "DRAFT",
      tags: ["Check", "check", " probe "],
      isFeatured: false,
    }),
    ctx,
  );
  created.postIds.push(post.id);
  assert(!post.content.includes("<script"), "post content is sanitised on write");
  assert(post.readingMinutes !== null && post.readingMinutes >= 1, "readingMinutes is computed from the body");
  assert(post.tags.length === 2 && post.tags.includes("check") && post.tags.includes("probe"), `tags are normalised and de-duplicated, got ${JSON.stringify(post.tags)}`);
  assert(post.authorId === admin.id && post.authorName === (admin.name ?? admin.email), "the acting admin is snapshotted as the author");

  const livePost = await setBlogPostStatus(post.id, { status: "PUBLISHED" }, ctx);
  assert(livePost.status === "PUBLISHED" && livePost.publishedAt !== null, "publishing a post stamps publishedAt");

  const future = new Date(Date.now() + 60 * 60 * 1000);
  const scheduled = await setBlogPostStatus(post.id, { status: "PUBLISHED", publishedAt: future }, ctx);
  assert(scheduled.status === "SCHEDULED", "PUBLISHED with a future date is normalised to SCHEDULED");

  const past = new Date(Date.now() - 60 * 1000);
  const backdated = await setBlogPostStatus(post.id, { status: "SCHEDULED", publishedAt: past }, ctx);
  assert(backdated.status === "PUBLISHED", "SCHEDULED with a past date is normalised to PUBLISHED (no publish job exists)");

  const postToken = await issueBlogPreviewToken(post.id, actor);
  assert(verifyPreviewToken(postToken.token, { entity: "blog", id: post.id }).ok, "the post preview token verifies");
  assert(!verifyPreviewToken(`${postToken.token}x`, { entity: "blog", id: post.id }).ok, "a tampered post preview token is rejected");

  // -- FAQS ----------------------------------------------------------------
  const group = `${PREFIX}Group`;
  const faqA = await createFaq(faqFormSchema.parse({ question: `${PREFIX}First?`, answer: "<p>Yes.</p><h2>Nope</h2>", group }), actor);
  const faqB = await createFaq(faqFormSchema.parse({ question: `${PREFIX}Second?`, answer: "<p>Also yes.</p>", group }), actor);
  created.faqIds.push(faqA.id, faqB.id);
  assert(!faqA.answer.includes("<h2"), "FAQ answers are sanitised with the basic profile (no headings)");
  assert(faqB.position > faqA.position, "a new question joins the end of its group");

  const reordered = await reorderFaqs({ group, ids: [faqB.id, faqA.id] }, actor);
  assert(reordered.moved > 0, "reordering moved at least one row");
  const afterMove = await db.faq.findMany({ where: { id: { in: [faqA.id, faqB.id] } }, orderBy: { position: "asc" }, select: { id: true, position: true } });
  assert(afterMove[0]?.id === faqB.id, "the dragged question is now first in its group");
  assert(afterMove[1]!.position === afterMove[0]!.position + 1, "positions stay contiguous after a move");

  const hidden = await setFaqFlag(faqA.id, "enabled", false, actor);
  assert(hidden.enabled === false, "the enabled flag toggles");

  const positions = await db.faq.findMany({ orderBy: { position: "asc" }, select: { position: true } });
  const contiguous = positions.every((row, index) => row.position === index);
  assert(contiguous, "every FAQ position is contiguous across all groups");

  // -- DELETE --------------------------------------------------------------
  for (const id of created.faqIds.splice(0)) await deleteFaq(id, actor);
  for (const id of created.postIds.splice(0)) await deleteBlogPost(id, ctx);
  for (const id of created.pageIds.splice(0)) await deletePage(id, ctx);

  const leftovers = await db.cmsPage.count({ where: { slug: { startsWith: SLUG } } });
  assert(leftovers === 0, "every page the check created was deleted");

  // §11.24: system pages refuse deletion.
  const systemPage = await db.cmsPage.findFirst({ where: { isSystem: true }, select: { id: true, slug: true } });
  if (systemPage) {
    let refused = false;
    try {
      await deletePage(systemPage.id, ctx);
    } catch {
      refused = true;
    }
    assert(refused, `deleting the system page /${systemPage.slug} is refused`);
  }

  console.log("pages-check: OK (pages, blog, faqs: create → publish → preview → duplicate → delete)");
}

main()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Best-effort cleanup for a run that failed mid-way.
    if (created.faqIds.length > 0) await db.faq.deleteMany({ where: { id: { in: created.faqIds } } });
    if (created.postIds.length > 0) await db.blogPost.deleteMany({ where: { id: { in: created.postIds } } });
    if (created.pageIds.length > 0) await db.cmsPage.deleteMany({ where: { id: { in: created.pageIds } } });
    await db.$disconnect();
  });
