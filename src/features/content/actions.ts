"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import type { z } from "zod";

import {
  ok,
  fail,
  zodFail,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import { diffOf, writeAudit } from "@/lib/audit";
import { requireAdminOrThrow } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { asObject } from "@/lib/json";
import { filenameFromUrl, isExternalUrl, isVideoUrl } from "@/lib/media";
import { sectionDefinition } from "./registry";
import {
  addMediaByUrlSchema,
  createBlockSchema,
  createFaqSchema,
  createTestimonialSchema,
  deleteBlockSchema,
  deleteFaqSchema,
  deleteMediaSchema,
  deleteReviewSchema,
  reorderBlocksSchema,
  reorderFaqsSchema,
  reorderSectionsSchema,
  setCmsPageStatusSchema,
  setReviewStatusSchema,
  toggleBlockSchema,
  toggleFaqSchema,
  toggleReviewFeaturedSchema,
  toggleSectionSchema,
  updateBlockSchema,
  updateCmsPageSchema,
  updateFaqSchema,
  updateFooterConfigSchema,
  updateMediaAltSchema,
  updateSectionPayloadSchema,
} from "./schemas";

/**
 * Every mutation on the Content page.
 *
 * The shape is the same in all of them: authorise, validate, do the work inside
 * runAction, write an audit row, revalidate, return a sentence a human can
 * read. Payload validation for sections and blocks is delegated to the type's
 * schema in registry.ts, so a new section type gains full validation without
 * touching this file.
 */

const CONTENT_ROUTE = "/content";

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

/**
 * Content payloads carry asset URLs as plain strings because that is what the
 * storefront reads. Registering them in MediaAsset as well is what makes the
 * Media tab's "used by" count true rather than decorative.
 */
async function linkMedia(
  url: unknown,
  folder: string,
): Promise<string | null> {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (!isExternalUrl(trimmed) && !trimmed.startsWith("/")) return null;

  const asset = await db.mediaAsset.upsert({
    where: { url: trimmed },
    update: {},
    create: {
      url: trimmed,
      filename: filenameFromUrl(trimmed),
      kind: isVideoUrl(trimmed) ? "video" : "image",
      folder,
      source: isExternalUrl(trimmed) ? "external" : "legacy",
    },
    select: { id: true },
  });

  return asset.id;
}

// ===========================================================================
// Homepage sections
// ===========================================================================

export async function toggleSection(
  input: z.infer<typeof toggleSectionSchema>,
): Promise<ActionResult<{ enabled: boolean }>> {
  const actor = await requireAdminOrThrow();
  const parsed = toggleSectionSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  return runAction(async () => {
    const section = await db.contentSection.findUnique({
      where: { id: parsed.data.id },
      select: { id: true, title: true, enabled: true },
    });
    if (!section) return fail("That section no longer exists.");

    await db.contentSection.update({
      where: { id: section.id },
      data: { enabled: parsed.data.enabled },
    });

    await writeAudit({
      actor,
      action: "content.section.toggle",
      entityType: "ContentSection",
      entityId: section.id,
      summary: `${parsed.data.enabled ? "Enabled" : "Disabled"} the ${section.title} section`,
      diff: diffOf(
        { enabled: section.enabled },
        { enabled: parsed.data.enabled },
      ),
    });

    revalidatePath(CONTENT_ROUTE);
    return ok(
      { enabled: parsed.data.enabled },
      parsed.data.enabled
        ? `${section.title} is on.`
        : `${section.title} is off.`,
    );
  });
}

export async function reorderSections(
  input: z.infer<typeof reorderSectionsSchema>,
): Promise<ActionResult<{ count: number }>> {
  const actor = await requireAdminOrThrow();
  const parsed = reorderSectionsSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  return runAction(async () => {
    const known = await db.contentSection.count({
      where: { id: { in: parsed.data.ids } },
    });
    if (known !== parsed.data.ids.length) {
      return fail("The section list changed. Reload and try again.");
    }

    await db.$transaction(
      parsed.data.ids.map((id, index) =>
        db.contentSection.update({ where: { id }, data: { position: index } }),
      ),
    );

    await writeAudit({
      actor,
      action: "content.section.reorder",
      entityType: "ContentSection",
      summary: `Reordered ${parsed.data.ids.length} homepage sections`,
    });

    revalidatePath(CONTENT_ROUTE);
    return ok({ count: parsed.data.ids.length }, "Order saved.");
  });
}

export async function updateSectionPayload(
  input: z.infer<typeof updateSectionPayloadSchema>,
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireAdminOrThrow();
  const parsed = updateSectionPayloadSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  return runAction(async () => {
    const section = await db.contentSection.findUnique({
      where: { id: parsed.data.id },
    });
    if (!section) return fail("That section no longer exists.");

    const definition = sectionDefinition(section.type);
    const current = asObject<Record<string, unknown>>(section.payload, {});

    // Merged, not replaced: keys the registry has no field for (a future flag,
    // the promo `slots` list) must survive an edit made through the form.
    const merged = { ...current, ...parsed.data.values };
    const validated = definition.sectionSchema.safeParse(merged);
    if (!validated.success) return zodFail(validated.error);

    await db.contentSection.update({
      where: { id: section.id },
      data: { payload: toJson(validated.data) },
    });

    await writeAudit({
      actor,
      action: "content.section.update",
      entityType: "ContentSection",
      entityId: section.id,
      summary: `Updated the ${section.title} section settings`,
      diff: diffOf(current, validated.data),
    });

    revalidatePath(CONTENT_ROUTE);
    return ok({ id: section.id }, `${section.title} saved.`);
  });
}

export async function createBlock(
  input: z.infer<typeof createBlockSchema>,
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireAdminOrThrow();
  const parsed = createBlockSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  return runAction(async () => {
    const section = await db.contentSection.findUnique({
      where: { id: parsed.data.sectionId },
      select: { id: true, title: true, type: true },
    });
    if (!section) return fail("That section no longer exists.");

    const definition = sectionDefinition(section.type);
    if (!definition.repeatable) {
      return fail(`${definition.label} does not hold items.`);
    }

    const existing = await db.contentBlock.count({
      where: { sectionId: section.id },
    });
    if (existing >= definition.maxBlocks) {
      return fail(
        `${definition.label} holds at most ${definition.maxBlocks} ${definition.blockNoun}s.`,
      );
    }

    const validated = definition.blockSchema.safeParse(parsed.data.payload);
    if (!validated.success) return zodFail(validated.error);

    const last = await db.contentBlock.findFirst({
      where: { sectionId: section.id },
      orderBy: { position: "desc" },
      select: { position: true },
    });

    const mediaId = definition.previewKey
      ? await linkMedia(
          validated.data[definition.previewKey],
          `content/${section.type}`,
        )
      : null;

    const block = await db.contentBlock.create({
      data: {
        sectionId: section.id,
        position: (last?.position ?? -1) + 1,
        enabled: true,
        payload: toJson(validated.data),
        mediaId,
      },
      select: { id: true },
    });

    await writeAudit({
      actor,
      action: "content.block.create",
      entityType: "ContentBlock",
      entityId: block.id,
      summary: `Added a ${definition.blockNoun} to ${section.title}`,
      diff: diffOf(null, validated.data),
    });

    revalidatePath(CONTENT_ROUTE);
    return ok({ id: block.id }, `${definition.blockNoun} added.`);
  });
}

export async function updateBlock(
  input: z.infer<typeof updateBlockSchema>,
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireAdminOrThrow();
  const parsed = updateBlockSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  return runAction(async () => {
    const block = await db.contentBlock.findUnique({
      where: { id: parsed.data.id },
      include: { section: { select: { title: true, type: true } } },
    });
    if (!block) return fail("That item no longer exists.");

    const definition = sectionDefinition(block.section.type);
    const current = asObject<Record<string, unknown>>(block.payload, {});
    const merged = { ...current, ...parsed.data.payload };

    const validated = definition.blockSchema.safeParse(merged);
    if (!validated.success) return zodFail(validated.error);

    const mediaId = definition.previewKey
      ? await linkMedia(
          validated.data[definition.previewKey],
          `content/${block.section.type}`,
        )
      : block.mediaId;

    await db.contentBlock.update({
      where: { id: block.id },
      data: { payload: toJson(validated.data), mediaId },
    });

    await writeAudit({
      actor,
      action: "content.block.update",
      entityType: "ContentBlock",
      entityId: block.id,
      summary: `Edited a ${definition.blockNoun} in ${block.section.title}`,
      diff: diffOf(current, validated.data),
    });

    revalidatePath(CONTENT_ROUTE);
    return ok({ id: block.id }, `${definition.blockNoun} saved.`);
  });
}

export async function deleteBlock(
  input: z.infer<typeof deleteBlockSchema>,
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireAdminOrThrow();
  const parsed = deleteBlockSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  return runAction(async () => {
    const block = await db.contentBlock.findUnique({
      where: { id: parsed.data.id },
      include: { section: { select: { id: true, title: true, type: true } } },
    });
    if (!block) return fail("That item no longer exists.");

    const definition = sectionDefinition(block.section.type);
    const siblings = await db.contentBlock.count({
      where: { sectionId: block.section.id },
    });

    if (siblings <= definition.minBlocks) {
      return fail(
        definition.minBlocks === 1
          ? `${definition.label} needs at least one ${definition.blockNoun}. Turn the whole section off instead.`
          : `${definition.label} needs at least ${definition.minBlocks} ${definition.blockNoun}s.`,
      );
    }

    await db.contentBlock.delete({ where: { id: block.id } });

    await writeAudit({
      actor,
      action: "content.block.delete",
      entityType: "ContentBlock",
      entityId: block.id,
      summary: `Deleted a ${definition.blockNoun} from ${block.section.title}`,
      diff: diffOf(asObject<Record<string, unknown>>(block.payload, {}), null),
    });

    revalidatePath(CONTENT_ROUTE);
    return ok({ id: block.id }, `${definition.blockNoun} deleted.`);
  });
}

export async function reorderBlocks(
  input: z.infer<typeof reorderBlocksSchema>,
): Promise<ActionResult<{ count: number }>> {
  const actor = await requireAdminOrThrow();
  const parsed = reorderBlocksSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  return runAction(async () => {
    const section = await db.contentSection.findUnique({
      where: { id: parsed.data.sectionId },
      select: { id: true, title: true },
    });
    if (!section) return fail("That section no longer exists.");

    // Scoped to the section so a bad id cannot renumber another section's rows.
    const known = await db.contentBlock.count({
      where: { sectionId: section.id, id: { in: parsed.data.ids } },
    });
    if (known !== parsed.data.ids.length) {
      return fail("The list changed. Reload and try again.");
    }

    await db.$transaction(
      parsed.data.ids.map((id, index) =>
        db.contentBlock.update({ where: { id }, data: { position: index } }),
      ),
    );

    await writeAudit({
      actor,
      action: "content.block.reorder",
      entityType: "ContentSection",
      entityId: section.id,
      summary: `Reordered ${parsed.data.ids.length} items in ${section.title}`,
    });

    revalidatePath(CONTENT_ROUTE);
    return ok({ count: parsed.data.ids.length }, "Order saved.");
  });
}

export async function toggleBlock(
  input: z.infer<typeof toggleBlockSchema>,
): Promise<ActionResult<{ enabled: boolean }>> {
  const actor = await requireAdminOrThrow();
  const parsed = toggleBlockSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  return runAction(async () => {
    const block = await db.contentBlock.findUnique({
      where: { id: parsed.data.id },
      include: { section: { select: { title: true, type: true } } },
    });
    if (!block) return fail("That item no longer exists.");

    await db.contentBlock.update({
      where: { id: block.id },
      data: { enabled: parsed.data.enabled },
    });

    const definition = sectionDefinition(block.section.type);

    await writeAudit({
      actor,
      action: "content.block.toggle",
      entityType: "ContentBlock",
      entityId: block.id,
      summary: `${parsed.data.enabled ? "Showed" : "Hid"} a ${definition.blockNoun} in ${block.section.title}`,
      diff: diffOf(
        { enabled: block.enabled },
        { enabled: parsed.data.enabled },
      ),
    });

    revalidatePath(CONTENT_ROUTE);
    return ok(
      { enabled: parsed.data.enabled },
      parsed.data.enabled ? "Item shown." : "Item hidden.",
    );
  });
}

// ===========================================================================
// CMS pages
// ===========================================================================

/**
 * Body block ids are anchor targets: the footer links to
 * /shipping-returns#shipping, which only resolves if that block keeps the id
 * "shipping". Existing ids are therefore preserved untouched and only new
 * blocks get an id derived from their heading.
 */
function slugifyBlockId(title: string, fallback: number): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || `block-${fallback}`;
}

export async function updateCmsPage(
  input: z.infer<typeof updateCmsPageSchema>,
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireAdminOrThrow();
  const parsed = updateCmsPageSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  return runAction(async () => {
    const page = await db.cmsPage.findUnique({ where: { id: parsed.data.id } });
    if (!page) return fail("That page no longer exists.");

    const used = new Set<string>();
    const body = parsed.data.body.map((block, index) => {
      let id = block.id?.trim() || slugifyBlockId(block.title, index + 1);
      while (used.has(id)) id = `${id}-${index + 1}`;
      used.add(id);
      return { id, title: block.title, content: block.content };
    });

    const before = {
      title: page.title,
      eyebrow: page.eyebrow,
      intro: page.intro,
      blocks: Array.isArray(page.body) ? page.body.length : 0,
      metaTitle: page.metaTitle,
      metaDescription: page.metaDescription,
    };

    await db.cmsPage.update({
      where: { id: page.id },
      data: {
        title: parsed.data.title,
        eyebrow: parsed.data.eyebrow || null,
        intro: parsed.data.intro || null,
        body: toJson(body),
        metaTitle: parsed.data.metaTitle || null,
        metaDescription: parsed.data.metaDescription || null,
      },
    });

    await writeAudit({
      actor,
      action: "content.page.update",
      entityType: "CmsPage",
      entityId: page.id,
      summary: `Updated the /${page.slug} page`,
      diff: diffOf(before, {
        title: parsed.data.title,
        eyebrow: parsed.data.eyebrow || null,
        intro: parsed.data.intro || null,
        blocks: body.length,
        metaTitle: parsed.data.metaTitle || null,
        metaDescription: parsed.data.metaDescription || null,
      }),
    });

    revalidatePath(CONTENT_ROUTE);
    return ok({ id: page.id }, `/${page.slug} saved.`);
  });
}

export async function setCmsPageStatus(
  input: z.infer<typeof setCmsPageStatusSchema>,
): Promise<ActionResult<{ status: string }>> {
  const actor = await requireAdminOrThrow();
  const parsed = setCmsPageStatusSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  return runAction(async () => {
    const page = await db.cmsPage.findUnique({
      where: { id: parsed.data.id },
      select: { id: true, slug: true, status: true, publishedAt: true },
    });
    if (!page) return fail("That page no longer exists.");

    const publishing = parsed.data.status === "PUBLISHED";

    await db.cmsPage.update({
      where: { id: page.id },
      data: {
        status: parsed.data.status,
        publishedAt: publishing ? (page.publishedAt ?? new Date()) : null,
      },
    });

    await writeAudit({
      actor,
      action: "content.page.status",
      entityType: "CmsPage",
      entityId: page.id,
      summary: `${publishing ? "Published" : "Unpublished"} the /${page.slug} page`,
      diff: diffOf({ status: page.status }, { status: parsed.data.status }),
    });

    revalidatePath(CONTENT_ROUTE);
    return ok(
      { status: parsed.data.status },
      publishing ? `/${page.slug} is published.` : `/${page.slug} is a draft.`,
    );
  });
}

// ===========================================================================
// FAQ
// ===========================================================================

export async function createFaq(
  input: z.infer<typeof createFaqSchema>,
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireAdminOrThrow();
  const parsed = createFaqSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  return runAction(async () => {
    const last = await db.faq.findFirst({
      orderBy: { position: "desc" },
      select: { position: true },
    });

    const faq = await db.faq.create({
      data: {
        question: parsed.data.question,
        answer: parsed.data.answer,
        group: parsed.data.group,
        position: (last?.position ?? -1) + 1,
        enabled: true,
      },
      select: { id: true },
    });

    await writeAudit({
      actor,
      action: "content.faq.create",
      entityType: "Faq",
      entityId: faq.id,
      summary: `Added the FAQ "${parsed.data.question}"`,
      diff: diffOf(null, parsed.data),
    });

    revalidatePath(CONTENT_ROUTE);
    return ok({ id: faq.id }, "Question added.");
  });
}

export async function updateFaq(
  input: z.infer<typeof updateFaqSchema>,
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireAdminOrThrow();
  const parsed = updateFaqSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  return runAction(async () => {
    const faq = await db.faq.findUnique({ where: { id: parsed.data.id } });
    if (!faq) return fail("That question no longer exists.");

    await db.faq.update({
      where: { id: faq.id },
      data: {
        question: parsed.data.question,
        answer: parsed.data.answer,
        group: parsed.data.group,
      },
    });

    await writeAudit({
      actor,
      action: "content.faq.update",
      entityType: "Faq",
      entityId: faq.id,
      summary: `Edited the FAQ "${parsed.data.question}"`,
      diff: diffOf(
        { question: faq.question, answer: faq.answer, group: faq.group },
        {
          question: parsed.data.question,
          answer: parsed.data.answer,
          group: parsed.data.group,
        },
      ),
    });

    revalidatePath(CONTENT_ROUTE);
    return ok({ id: faq.id }, "Question saved.");
  });
}

export async function deleteFaq(
  input: z.infer<typeof deleteFaqSchema>,
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireAdminOrThrow();
  const parsed = deleteFaqSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  return runAction(async () => {
    const faq = await db.faq.findUnique({ where: { id: parsed.data.id } });
    if (!faq) return fail("That question no longer exists.");

    await db.faq.delete({ where: { id: faq.id } });

    await writeAudit({
      actor,
      action: "content.faq.delete",
      entityType: "Faq",
      entityId: faq.id,
      summary: `Deleted the FAQ "${faq.question}"`,
      diff: diffOf({ question: faq.question, answer: faq.answer }, null),
    });

    revalidatePath(CONTENT_ROUTE);
    return ok({ id: faq.id }, "Question deleted.");
  });
}

export async function reorderFaqs(
  input: z.infer<typeof reorderFaqsSchema>,
): Promise<ActionResult<{ count: number }>> {
  const actor = await requireAdminOrThrow();
  const parsed = reorderFaqsSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  return runAction(async () => {
    const known = await db.faq.count({ where: { id: { in: parsed.data.ids } } });
    if (known !== parsed.data.ids.length) {
      return fail("The list changed. Reload and try again.");
    }

    await db.$transaction(
      parsed.data.ids.map((id, index) =>
        db.faq.update({ where: { id }, data: { position: index } }),
      ),
    );

    await writeAudit({
      actor,
      action: "content.faq.reorder",
      entityType: "Faq",
      summary: `Reordered ${parsed.data.ids.length} FAQ entries`,
    });

    revalidatePath(CONTENT_ROUTE);
    return ok({ count: parsed.data.ids.length }, "Order saved.");
  });
}

export async function toggleFaq(
  input: z.infer<typeof toggleFaqSchema>,
): Promise<ActionResult<{ enabled: boolean }>> {
  const actor = await requireAdminOrThrow();
  const parsed = toggleFaqSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  return runAction(async () => {
    const faq = await db.faq.findUnique({ where: { id: parsed.data.id } });
    if (!faq) return fail("That question no longer exists.");

    await db.faq.update({
      where: { id: faq.id },
      data: { enabled: parsed.data.enabled },
    });

    await writeAudit({
      actor,
      action: "content.faq.toggle",
      entityType: "Faq",
      entityId: faq.id,
      summary: `${parsed.data.enabled ? "Showed" : "Hid"} the FAQ "${faq.question}"`,
      diff: diffOf({ enabled: faq.enabled }, { enabled: parsed.data.enabled }),
    });

    revalidatePath(CONTENT_ROUTE);
    return ok(
      { enabled: parsed.data.enabled },
      parsed.data.enabled ? "Question shown." : "Question hidden.",
    );
  });
}

// ===========================================================================
// Footer
// ===========================================================================

export async function updateFooterConfig(
  input: z.infer<typeof updateFooterConfigSchema>,
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireAdminOrThrow();
  const parsed = updateFooterConfigSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  return runAction(async () => {
    const existing = await db.footerConfig.findFirst();
    const id = existing?.id ?? "default";

    const data = {
      brandName: parsed.data.brandName,
      brandDescription: parsed.data.brandDescription,
      copyright: parsed.data.copyright,
      socialLinks: toJson(parsed.data.socialLinks),
      sections: toJson(parsed.data.sections),
      legalLinks: toJson(parsed.data.legalLinks),
      customerService: toJson(parsed.data.customerService),
    };

    await db.footerConfig.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });

    await writeAudit({
      actor,
      action: "content.footer.update",
      entityType: "FooterConfig",
      entityId: id,
      summary: "Updated the storefront footer",
      diff: diffOf(
        existing
          ? {
              brandName: existing.brandName,
              brandDescription: existing.brandDescription,
              copyright: existing.copyright,
              socialLinks: existing.socialLinks,
              sections: existing.sections,
              legalLinks: existing.legalLinks,
              customerService: existing.customerService,
            }
          : null,
        {
          brandName: parsed.data.brandName,
          brandDescription: parsed.data.brandDescription,
          copyright: parsed.data.copyright,
          socialLinks: parsed.data.socialLinks,
          sections: parsed.data.sections,
          legalLinks: parsed.data.legalLinks,
          customerService: parsed.data.customerService,
        },
      ),
    });

    revalidatePath(CONTENT_ROUTE);
    return ok({ id }, "Footer saved.");
  });
}

// ===========================================================================
// Media
// ===========================================================================

export async function addMediaByUrl(
  input: z.infer<typeof addMediaByUrlSchema>,
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireAdminOrThrow();
  const parsed = addMediaByUrlSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  return runAction(async () => {
    const url = parsed.data.url;

    const duplicate = await db.mediaAsset.findUnique({
      where: { url },
      select: { id: true, filename: true },
    });
    if (duplicate) {
      return fail(`That URL is already in the library as ${duplicate.filename}.`);
    }

    const asset = await db.mediaAsset.create({
      data: {
        url,
        filename: filenameFromUrl(url),
        kind: parsed.data.kind ?? (isVideoUrl(url) ? "video" : "image"),
        folder: parsed.data.folder,
        alt: parsed.data.alt || null,
        // Never "upload": no storage provider is configured, so the bytes are
        // always somewhere else and the admin only holds the reference.
        source: isExternalUrl(url) ? "external" : "legacy",
      },
      select: { id: true, filename: true },
    });

    await writeAudit({
      actor,
      action: "content.media.create",
      entityType: "MediaAsset",
      entityId: asset.id,
      summary: `Added ${asset.filename} to the media library`,
      diff: diffOf(null, { url, folder: parsed.data.folder }),
    });

    revalidatePath(CONTENT_ROUTE);
    return ok({ id: asset.id }, `${asset.filename} added.`);
  });
}

export async function updateMediaAlt(
  input: z.infer<typeof updateMediaAltSchema>,
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireAdminOrThrow();
  const parsed = updateMediaAltSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  return runAction(async () => {
    const asset = await db.mediaAsset.findUnique({
      where: { id: parsed.data.id },
      select: { id: true, filename: true, alt: true },
    });
    if (!asset) return fail("That asset no longer exists.");

    await db.mediaAsset.update({
      where: { id: asset.id },
      data: { alt: parsed.data.alt || null },
    });

    await writeAudit({
      actor,
      action: "content.media.update",
      entityType: "MediaAsset",
      entityId: asset.id,
      summary: `Updated the alt text on ${asset.filename}`,
      diff: diffOf({ alt: asset.alt }, { alt: parsed.data.alt || null }),
    });

    revalidatePath(CONTENT_ROUTE);
    return ok({ id: asset.id }, "Alt text saved.");
  });
}

export async function deleteMedia(
  input: z.infer<typeof deleteMediaSchema>,
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireAdminOrThrow();
  const parsed = deleteMediaSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  return runAction(async () => {
    const asset = await db.mediaAsset.findUnique({
      where: { id: parsed.data.id },
      select: { id: true, filename: true, url: true },
    });
    if (!asset) return fail("That asset no longer exists.");

    const [productImages, blocks, categories] = await Promise.all([
      db.productImage.count({ where: { mediaId: asset.id } }),
      db.contentBlock.count({ where: { mediaId: asset.id } }),
      db.category.count({ where: { imageMediaId: asset.id } }),
    ]);

    const total = productImages + blocks + categories;
    if (total > 0) {
      const parts: string[] = [];
      if (productImages) {
        parts.push(
          `${productImages} product image${productImages === 1 ? "" : "s"}`,
        );
      }
      if (blocks) {
        parts.push(`${blocks} content item${blocks === 1 ? "" : "s"}`);
      }
      if (categories) {
        parts.push(`${categories} categor${categories === 1 ? "y" : "ies"}`);
      }
      return fail(
        `${asset.filename} is still used by ${parts.join(" and ")}. Replace it there first.`,
      );
    }

    await db.mediaAsset.delete({ where: { id: asset.id } });

    await writeAudit({
      actor,
      action: "content.media.delete",
      entityType: "MediaAsset",
      entityId: asset.id,
      summary: `Deleted ${asset.filename} from the media library`,
      diff: diffOf({ url: asset.url }, null),
    });

    revalidatePath(CONTENT_ROUTE);
    return ok({ id: asset.id }, `${asset.filename} deleted.`);
  });
}

// ===========================================================================
// Reviews
// ===========================================================================

/**
 * Product.ratingAvg and Product.reviewCount are cached projections of the
 * Review table, so anything that changes which reviews are approved has to
 * recompute them. updateMany, not update, so a product deleted in another tab
 * cannot turn a successful moderation into an error.
 */
async function refreshProductRating(productId: string | null): Promise<void> {
  if (!productId) return;

  const aggregate = await db.review.aggregate({
    where: { productId, status: "APPROVED" },
    _avg: { rating: true },
    _count: { _all: true },
  });

  await db.product.updateMany({
    where: { id: productId },
    data: {
      ratingAvg: aggregate._avg.rating ?? 0,
      reviewCount: aggregate._count._all,
    },
  });
}

export async function setReviewStatus(
  input: z.infer<typeof setReviewStatusSchema>,
): Promise<ActionResult<{ count: number }>> {
  const actor = await requireAdminOrThrow();
  const parsed = setReviewStatusSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  return runAction(async () => {
    const reviews = await db.review.findMany({
      where: { id: { in: parsed.data.ids } },
      select: { id: true, authorName: true, status: true, productId: true },
    });
    if (reviews.length === 0) return fail("Those reviews no longer exist.");

    await db.review.updateMany({
      where: { id: { in: reviews.map((review) => review.id) } },
      data: { status: parsed.data.status },
    });

    const productIds = [
      ...new Set(
        reviews
          .map((review) => review.productId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    for (const productId of productIds) await refreshProductRating(productId);

    const verb =
      parsed.data.status === "APPROVED"
        ? "Approved"
        : parsed.data.status === "REJECTED"
          ? "Rejected"
          : "Reset";

    await writeAudit({
      actor,
      action: "content.review.status",
      entityType: "Review",
      entityId: reviews.length === 1 ? reviews[0].id : null,
      summary:
        reviews.length === 1
          ? `${verb} the review by ${reviews[0].authorName}`
          : `${verb} ${reviews.length} reviews`,
      diff: diffOf(
        { statuses: reviews.map((review) => review.status) },
        { status: parsed.data.status },
      ),
    });

    revalidatePath(CONTENT_ROUTE);
    return ok(
      { count: reviews.length },
      reviews.length === 1
        ? `${verb.toLowerCase()}.`
        : `${reviews.length} reviews ${verb.toLowerCase()}.`,
    );
  });
}

export async function toggleReviewFeatured(
  input: z.infer<typeof toggleReviewFeaturedSchema>,
): Promise<ActionResult<{ isFeatured: boolean }>> {
  const actor = await requireAdminOrThrow();
  const parsed = toggleReviewFeaturedSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  return runAction(async () => {
    const review = await db.review.findUnique({
      where: { id: parsed.data.id },
      select: {
        id: true,
        authorName: true,
        isFeatured: true,
        status: true,
      },
    });
    if (!review) return fail("That review no longer exists.");

    if (parsed.data.isFeatured && review.status !== "APPROVED") {
      return fail("Approve the review before featuring it on the homepage.");
    }

    await db.review.update({
      where: { id: review.id },
      data: { isFeatured: parsed.data.isFeatured },
    });

    await writeAudit({
      actor,
      action: "content.review.feature",
      entityType: "Review",
      entityId: review.id,
      summary: `${parsed.data.isFeatured ? "Featured" : "Unfeatured"} the review by ${review.authorName}`,
      diff: diffOf(
        { isFeatured: review.isFeatured },
        { isFeatured: parsed.data.isFeatured },
      ),
    });

    revalidatePath(CONTENT_ROUTE);
    return ok(
      { isFeatured: parsed.data.isFeatured },
      parsed.data.isFeatured
        ? "Featured on the homepage."
        : "Removed from the homepage.",
    );
  });
}

export async function createTestimonial(
  input: z.infer<typeof createTestimonialSchema>,
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireAdminOrThrow();
  const parsed = createTestimonialSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  return runAction(async () => {
    const last = await db.review.findFirst({
      where: { isTestimonial: true },
      orderBy: { position: "desc" },
      select: { position: true },
    });

    const review = await db.review.create({
      data: {
        authorName: parsed.data.authorName,
        authorLocation: parsed.data.authorLocation || null,
        body: parsed.data.body,
        rating: parsed.data.rating,
        // Typed in by an admin, so it is approved by definition. There is no
        // storefront form that could submit an unmoderated one.
        status: "APPROVED",
        isFeatured: parsed.data.isFeatured,
        isTestimonial: true,
        position: (last?.position ?? -1) + 1,
      },
      select: { id: true },
    });

    await writeAudit({
      actor,
      action: "content.review.create",
      entityType: "Review",
      entityId: review.id,
      summary: `Added a homepage testimonial from ${parsed.data.authorName}`,
      diff: diffOf(null, parsed.data),
    });

    revalidatePath(CONTENT_ROUTE);
    return ok({ id: review.id }, "Testimonial added.");
  });
}

export async function deleteReview(
  input: z.infer<typeof deleteReviewSchema>,
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireAdminOrThrow();
  const parsed = deleteReviewSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  return runAction(async () => {
    const review = await db.review.findUnique({
      where: { id: parsed.data.id },
      select: {
        id: true,
        authorName: true,
        body: true,
        productId: true,
        isTestimonial: true,
      },
    });
    if (!review) return fail("That review no longer exists.");

    await db.review.delete({ where: { id: review.id } });
    await refreshProductRating(review.productId);

    await writeAudit({
      actor,
      action: "content.review.delete",
      entityType: "Review",
      entityId: review.id,
      summary: `Deleted the ${review.isTestimonial ? "testimonial" : "review"} by ${review.authorName}`,
      diff: diffOf({ authorName: review.authorName, body: review.body }, null),
    });

    revalidatePath(CONTENT_ROUTE);
    return ok({ id: review.id }, "Deleted.");
  });
}
