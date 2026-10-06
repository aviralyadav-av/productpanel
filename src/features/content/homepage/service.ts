import { Prisma, type ContentBlock, type ContentSection, type FooterConfig } from "@prisma/client";
import type { z } from "zod";

import { badRequest, conflict, notFound, validationError, zodDetails } from "@/lib/api/errors";
import { diffOf, writeAudit, type AuditActor } from "@/lib/audit";
import { db } from "@/lib/db";
import { asObject } from "@/lib/json";
import { sanitizeHtml } from "@/lib/sanitize/html";
import { isSafeUrl } from "@/lib/validation";
import { isSectionType, sectionDefinition, sectionKeyFor, type SectionDefinition } from "@/features/content/registry";

import type { BlockValues, FooterFormValues, SectionCreateInput, SectionUpdateValues } from "./schemas";

/**
 * Homepage section + block + footer mutations (blueprint §4.8, §11.26, §14.E1).
 *
 * The registry is the law here: a payload is only ever written after the
 * section type's own `sectionSchema` / `blockSchema` accepted it, rich-text
 * fields are sanitised on the way in (D12, §11.21) and URL fields are checked
 * against the same allowlist the public API applies on the way out - so what
 * the storefront receives is never something the admin form merely promised.
 *
 * Sections live on page `home`; positions are dense 0..n-1 and rewritten by
 * `reorderSections`. No `server-only` / `next/*` imports: cache invalidation
 * and `content.expire` scheduling happen in actions.ts and the REST routes.
 */

type Db = Prisma.TransactionClient;

export const HOME_PAGE = "home";

const HOMEPAGE_ENTITY = "content_section";

// ---------------------------------------------------------------------------
// Payload validation
// ---------------------------------------------------------------------------

function fieldErrors(error: z.ZodError, prefix?: string): Record<string, string> {
  const details = zodDetails(error);
  if (!prefix) return details;
  const out: Record<string, string> = {};
  for (const [key, message] of Object.entries(details)) out[`${prefix}.${key}`] = message;
  return out;
}

/**
 * Registry-schema validation plus the two checks a zod object cannot express
 * generically: rich text is sanitised, URL-typed fields must be safe links.
 */
function validatePayload(
  definition: SectionDefinition,
  fields: SectionDefinition["fields"],
  schema: SectionDefinition["sectionSchema"],
  raw: Record<string, unknown>,
  errorPrefix?: string,
): Record<string, unknown> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw validationError(fieldErrors(parsed.error, errorPrefix));
  const payload: Record<string, unknown> = { ...parsed.data };
  const problems: Record<string, string> = {};

  for (const field of fields) {
    const value = payload[field.name];
    if (field.type === "richtext" && typeof value === "string") {
      payload[field.name] = sanitizeHtml(value, "rich");
    }
    if ((field.type === "url" || field.type === "link") && typeof value === "string" && value.trim() && !isSafeUrl(value.trim())) {
      problems[errorPrefix ? `${errorPrefix}.${field.name}` : field.name] = "Only http(s) or site-relative URLs are allowed.";
    }
    if (field.required && (value === undefined || value === null || value === "")) {
      problems[errorPrefix ? `${errorPrefix}.${field.name}` : field.name] = "This field is required.";
    }
  }
  if (Object.keys(problems).length > 0) {
    throw validationError(problems, `Please correct the highlighted ${definition.label} fields.`);
  }
  return payload;
}

export function validateSectionPayload(type: string, raw: Record<string, unknown>): Record<string, unknown> {
  const definition = sectionDefinition(type);
  return validatePayload(definition, definition.fields, definition.sectionSchema, raw, "payload");
}

export function validateBlockPayload(type: string, raw: Record<string, unknown>): Record<string, unknown> {
  const definition = sectionDefinition(type);
  return validatePayload(definition, definition.blockFields, definition.blockSchema, raw, "payload");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadSection(tx: Db, id: string): Promise<ContentSection> {
  const row = await tx.contentSection.findUnique({ where: { id } });
  if (!row) throw notFound("Section");
  return row;
}

async function loadBlock(tx: Db, sectionId: string, blockId: string): Promise<ContentBlock> {
  const row = await tx.contentBlock.findFirst({ where: { id: blockId, sectionId } });
  if (!row) throw notFound("Block");
  return row;
}

/** `imageMediaId` / `mediaId` are Restrict FKs: a stale id must fail as a form error, not a 500. */
async function assertMediaExists(tx: Db, mediaId: string | null, field: string): Promise<void> {
  if (!mediaId) return;
  const count = await tx.mediaAsset.count({ where: { id: mediaId } });
  if (count === 0) throw badRequest("That media asset no longer exists.", { [field]: "Choose another image." });
}

async function nextSectionPosition(tx: Db): Promise<number> {
  const last = await tx.contentSection.findFirst({ where: { page: HOME_PAGE }, orderBy: { position: "desc" }, select: { position: true } });
  return last ? last.position + 1 : 0;
}

async function nextBlockPosition(tx: Db, sectionId: string): Promise<number> {
  const last = await tx.contentBlock.findFirst({ where: { sectionId }, orderBy: { position: "desc" }, select: { position: true } });
  return last ? last.position + 1 : 0;
}

/** `home.<type>` when free, else `home.<type>.<short random>` - keys are unique and never reused. */
async function freeSectionKey(tx: Db, type: string): Promise<string> {
  if (!isSectionType(type)) throw badRequest("Unknown section type.");
  const base = sectionKeyFor(type);
  if ((await tx.contentSection.count({ where: { key: base } })) === 0) return base;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = sectionKeyFor(type, Math.random().toString(36).slice(2, 8));
    if ((await tx.contentSection.count({ where: { key: candidate } })) === 0) return candidate;
  }
  throw conflict("Could not allocate a unique key for the section; try again.");
}

function sectionSnapshot(row: ContentSection): Record<string, unknown> {
  const { createdAt, updatedAt, draftPayload, ...rest } = row;
  void createdAt;
  void updatedAt;
  void draftPayload;
  return rest as Record<string, unknown>;
}

function blockSnapshot(row: ContentBlock): Record<string, unknown> {
  const { createdAt, updatedAt, ...rest } = row;
  void createdAt;
  void updatedAt;
  return rest as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/** A new section of `type` at the end of the homepage with the registry's default payload. */
export async function createSection(input: SectionCreateInput, actor: AuditActor): Promise<ContentSection> {
  const definition = sectionDefinition(input.type);
  return db.$transaction(async (tx) => {
    const key = await freeSectionKey(tx, input.type);
    const defaults = definition.sectionSchema.safeParse({});
    const payload = defaults.success ? defaults.data : {};
    const row = await tx.contentSection.create({
      data: {
        key,
        page: HOME_PAGE,
        type: input.type,
        title: input.title?.trim() || definition.label,
        position: await nextSectionPosition(tx),
        enabled: false,
        payload: payload as Prisma.InputJsonValue,
      },
    });
    await writeAudit(tx, {
      actor,
      action: "homepage.section_create",
      entityType: HOMEPAGE_ENTITY,
      entityId: row.id,
      entityLabel: row.title,
      summary: `Added homepage section "${row.title}" (${definition.label}).`,
      diff: diffOf(null, sectionSnapshot(row)),
    });
    return row;
  });
}

export async function updateSection(id: string, values: SectionUpdateValues, actor: AuditActor): Promise<ContentSection> {
  return db.$transaction(async (tx) => {
    const before = await loadSection(tx, id);
    const definition = sectionDefinition(before.type);
    const payload = validateSectionPayload(before.type, values.payload);
    const { common } = values;
    await assertMediaExists(tx, common.imageMediaId, "imageMediaId");

    // Types whose link lives in the payload (promo_section) ignore the row-level link.
    const link = definition.supportsLink
      ? { linkType: common.linkType, linkUrl: common.linkType === "URL" ? common.linkUrl : null, linkTargetId: common.linkType === "URL" || common.linkType === "NONE" ? null : common.linkTargetId }
      : { linkType: "NONE", linkUrl: null, linkTargetId: null };

    const row = await tx.contentSection.update({
      where: { id },
      data: {
        title: common.title,
        subtitle: common.subtitle,
        enabled: common.enabled,
        publishAt: common.publishAt,
        unpublishAt: common.unpublishAt,
        imageMediaId: common.imageMediaId,
        ...link,
        buttonText: definition.supportsLink ? common.buttonText : null,
        payload: payload as Prisma.InputJsonValue,
        // Saving publishes: a pending working copy is superseded (DbNull = SQL NULL, not JSON null).
        draftPayload: Prisma.DbNull,
      },
    });
    await writeAudit(tx, {
      actor,
      action: "homepage.section_update",
      entityType: HOMEPAGE_ENTITY,
      entityId: row.id,
      entityLabel: row.title,
      summary: `Updated homepage section "${row.title}".`,
      diff: diffOf(sectionSnapshot(before), sectionSnapshot(row)),
    });
    return row;
  });
}

export async function setSectionEnabled(id: string, enabled: boolean, actor: AuditActor): Promise<ContentSection> {
  return db.$transaction(async (tx) => {
    const before = await loadSection(tx, id);
    if (before.enabled === enabled) return before;
    const row = await tx.contentSection.update({ where: { id }, data: { enabled } });
    await writeAudit(tx, {
      actor,
      action: enabled ? "homepage.section_enable" : "homepage.section_disable",
      entityType: HOMEPAGE_ENTITY,
      entityId: row.id,
      entityLabel: row.title,
      summary: `${enabled ? "Enabled" : "Disabled"} homepage section "${row.title}".`,
      diff: diffOf({ enabled: before.enabled }, { enabled }),
    });
    return row;
  });
}

/** A disabled copy at the end of the page, blocks included, so it can be tuned before going live. */
export async function duplicateSection(id: string, actor: AuditActor): Promise<ContentSection> {
  return db.$transaction(async (tx) => {
    const source = await loadSection(tx, id);
    const blocks = await tx.contentBlock.findMany({ where: { sectionId: id }, orderBy: { position: "asc" } });
    const key = await freeSectionKey(tx, source.type);
    const row = await tx.contentSection.create({
      data: {
        key,
        page: source.page,
        type: source.type,
        title: `${source.title} (copy)`,
        subtitle: source.subtitle,
        position: await nextSectionPosition(tx),
        enabled: false,
        publishAt: source.publishAt,
        unpublishAt: source.unpublishAt,
        imageMediaId: source.imageMediaId,
        linkType: source.linkType,
        linkUrl: source.linkUrl,
        linkTargetId: source.linkTargetId,
        buttonText: source.buttonText,
        payload: asObject<Record<string, unknown>>(source.payload, {}) as Prisma.InputJsonValue,
      },
    });
    if (blocks.length > 0) {
      await tx.contentBlock.createMany({
        data: blocks.map((block) => ({
          sectionId: row.id,
          position: block.position,
          enabled: block.enabled,
          publishAt: block.publishAt,
          unpublishAt: block.unpublishAt,
          payload: asObject<Record<string, unknown>>(block.payload, {}) as Prisma.InputJsonValue,
          mediaId: block.mediaId,
        })),
      });
    }
    await writeAudit(tx, {
      actor,
      action: "homepage.section_duplicate",
      entityType: HOMEPAGE_ENTITY,
      entityId: row.id,
      entityLabel: row.title,
      summary: `Duplicated homepage section "${source.title}" as "${row.title}" (${blocks.length} item${blocks.length === 1 ? "" : "s"}).`,
      diff: diffOf(null, { sourceId: source.id, ...sectionSnapshot(row) }),
    });
    return row;
  });
}

export async function deleteSection(id: string, actor: AuditActor): Promise<{ id: string; title: string; blocks: number }> {
  return db.$transaction(async (tx) => {
    const before = await loadSection(tx, id);
    const blocks = await tx.contentBlock.count({ where: { sectionId: id } });
    await tx.contentSection.delete({ where: { id } });
    // Close the gap so positions stay dense for the next reorder.
    const rest = await tx.contentSection.findMany({ where: { page: before.page }, orderBy: [{ position: "asc" }, { key: "asc" }], select: { id: true, position: true } });
    for (const [index, row] of rest.entries()) {
      if (row.position !== index) await tx.contentSection.update({ where: { id: row.id }, data: { position: index } });
    }
    await writeAudit(tx, {
      actor,
      action: "homepage.section_delete",
      entityType: HOMEPAGE_ENTITY,
      entityId: before.id,
      entityLabel: before.title,
      summary: `Deleted homepage section "${before.title}" with ${blocks} item${blocks === 1 ? "" : "s"}.`,
      diff: diffOf(sectionSnapshot(before), null),
    });
    return { id: before.id, title: before.title, blocks };
  });
}

/**
 * Rewrite positions from the ids the board hands back. Sections missing from
 * the list (created by someone else meanwhile) keep their relative order
 * after the listed ones rather than being lost.
 */
export async function reorderSections(ids: readonly string[], actor: AuditActor): Promise<{ moved: number }> {
  return db.$transaction(async (tx) => {
    const rows = await tx.contentSection.findMany({ where: { page: HOME_PAGE }, orderBy: [{ position: "asc" }, { key: "asc" }], select: { id: true, position: true, title: true } });
    const known = new Set(rows.map((row) => row.id));
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length > 0) throw badRequest("Some sections no longer exist; reload the page.");
    const seen = new Set<string>();
    const order = [...ids.filter((id) => !seen.has(id) && seen.add(id)), ...rows.map((row) => row.id).filter((id) => !seen.has(id))];
    let moved = 0;
    for (const [index, id] of order.entries()) {
      const current = rows.find((row) => row.id === id);
      if (current && current.position !== index) {
        await tx.contentSection.update({ where: { id }, data: { position: index } });
        moved += 1;
      }
    }
    if (moved > 0) {
      await writeAudit(tx, {
        actor,
        action: "homepage.section_reorder",
        entityType: HOMEPAGE_ENTITY,
        entityId: null,
        entityLabel: "Homepage",
        summary: `Reordered homepage sections (${moved} moved).`,
        diff: diffOf(null, { order }),
      });
    }
    return { moved };
  });
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function assertRepeatable(definition: SectionDefinition): void {
  if (!definition.repeatable) throw badRequest(`${definition.label} sections do not have items of their own.`);
}

export async function addBlock(sectionId: string, input: BlockValues, actor: AuditActor): Promise<ContentBlock> {
  return db.$transaction(async (tx) => {
    const section = await loadSection(tx, sectionId);
    const definition = sectionDefinition(section.type);
    assertRepeatable(definition);
    const count = await tx.contentBlock.count({ where: { sectionId } });
    if (count >= definition.maxBlocks) throw conflict(`${definition.label} holds at most ${definition.maxBlocks} ${definition.blockNoun}s.`);
    const payload = validateBlockPayload(section.type, input.payload);
    await assertMediaExists(tx, input.mediaId, "mediaId");
    const row = await tx.contentBlock.create({
      data: {
        sectionId,
        position: await nextBlockPosition(tx, sectionId),
        enabled: input.enabled,
        publishAt: input.publishAt,
        unpublishAt: input.unpublishAt,
        mediaId: input.mediaId,
        payload: payload as Prisma.InputJsonValue,
      },
    });
    await writeAudit(tx, {
      actor,
      action: "homepage.block_add",
      entityType: HOMEPAGE_ENTITY,
      entityId: section.id,
      entityLabel: section.title,
      summary: `Added a ${definition.blockNoun} to "${section.title}".`,
      diff: diffOf(null, blockSnapshot(row)),
    });
    return row;
  });
}

export async function updateBlock(sectionId: string, blockId: string, input: BlockValues, actor: AuditActor): Promise<ContentBlock> {
  return db.$transaction(async (tx) => {
    const section = await loadSection(tx, sectionId);
    const definition = sectionDefinition(section.type);
    const before = await loadBlock(tx, sectionId, blockId);
    const payload = validateBlockPayload(section.type, input.payload);
    await assertMediaExists(tx, input.mediaId, "mediaId");
    const row = await tx.contentBlock.update({
      where: { id: blockId },
      data: {
        enabled: input.enabled,
        publishAt: input.publishAt,
        unpublishAt: input.unpublishAt,
        mediaId: input.mediaId,
        payload: payload as Prisma.InputJsonValue,
      },
    });
    await writeAudit(tx, {
      actor,
      action: "homepage.block_update",
      entityType: HOMEPAGE_ENTITY,
      entityId: section.id,
      entityLabel: section.title,
      summary: `Updated a ${definition.blockNoun} in "${section.title}".`,
      diff: diffOf(blockSnapshot(before), blockSnapshot(row)),
    });
    return row;
  });
}

export async function deleteBlock(sectionId: string, blockId: string, actor: AuditActor): Promise<{ id: string }> {
  return db.$transaction(async (tx) => {
    const section = await loadSection(tx, sectionId);
    const definition = sectionDefinition(section.type);
    const before = await loadBlock(tx, sectionId, blockId);
    await tx.contentBlock.delete({ where: { id: blockId } });
    const rest = await tx.contentBlock.findMany({ where: { sectionId }, orderBy: { position: "asc" }, select: { id: true, position: true } });
    for (const [index, row] of rest.entries()) {
      if (row.position !== index) await tx.contentBlock.update({ where: { id: row.id }, data: { position: index } });
    }
    await writeAudit(tx, {
      actor,
      action: "homepage.block_delete",
      entityType: HOMEPAGE_ENTITY,
      entityId: section.id,
      entityLabel: section.title,
      summary: `Removed a ${definition.blockNoun} from "${section.title}".`,
      diff: diffOf(blockSnapshot(before), null),
    });
    return { id: blockId };
  });
}

export async function reorderBlocks(sectionId: string, ids: readonly string[], actor: AuditActor): Promise<{ moved: number }> {
  return db.$transaction(async (tx) => {
    const section = await loadSection(tx, sectionId);
    const rows = await tx.contentBlock.findMany({ where: { sectionId }, orderBy: { position: "asc" }, select: { id: true, position: true } });
    const known = new Set(rows.map((row) => row.id));
    if (ids.some((id) => !known.has(id))) throw badRequest("Some items no longer exist; reload the section.");
    const seen = new Set<string>();
    const order = [...ids.filter((id) => !seen.has(id) && seen.add(id)), ...rows.map((row) => row.id).filter((id) => !seen.has(id))];
    let moved = 0;
    for (const [index, id] of order.entries()) {
      const current = rows.find((row) => row.id === id);
      if (current && current.position !== index) {
        await tx.contentBlock.update({ where: { id }, data: { position: index } });
        moved += 1;
      }
    }
    if (moved > 0) {
      await writeAudit(tx, {
        actor,
        action: "homepage.block_reorder",
        entityType: HOMEPAGE_ENTITY,
        entityId: section.id,
        entityLabel: section.title,
        summary: `Reordered the items in "${section.title}".`,
        diff: diffOf(null, { order }),
      });
    }
    return { moved };
  });
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

function footerSnapshot(row: FooterConfig): Record<string, unknown> {
  const { updatedAt, ...rest } = row;
  void updatedAt;
  return rest as Record<string, unknown>;
}

/** The single FooterConfig row (id "default"), created on first save if the seed left it out. */
export async function saveFooter(values: FooterFormValues, actor: AuditActor): Promise<FooterConfig> {
  return db.$transaction(async (tx) => {
    const before = await tx.footerConfig.findUnique({ where: { id: "default" } });
    const data = {
      brandName: values.brandName,
      brandDescription: values.brandDescription,
      copyright: values.copyright,
      socialLinks: values.socialLinks as Prisma.InputJsonValue,
      customerService: values.customerService as Prisma.InputJsonValue,
      legalLinks: values.legalLinks as Prisma.InputJsonValue,
      paymentIcons: values.paymentIcons,
      appLinks: values.appLinks as Prisma.InputJsonValue,
    };
    const row = await tx.footerConfig.upsert({ where: { id: "default" }, update: data, create: { id: "default", ...data } });
    await writeAudit(tx, {
      actor,
      action: "homepage.footer_update",
      entityType: "footer_config",
      entityId: row.id,
      entityLabel: "Footer",
      summary: "Updated the storefront footer.",
      diff: diffOf(before ? footerSnapshot(before) : null, footerSnapshot(row)),
    });
    return row;
  });
}
