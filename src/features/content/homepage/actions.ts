"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, runAction, zodFail, type ActionResult } from "@/lib/action-result";
import { requirePermissionOrThrow } from "@/lib/auth/guards";
import { invalidatePublic } from "@/lib/cache-tags";
import { scheduleContentExpiry } from "@/lib/queue/handlers/platform";

import {
  blockInputSchema,
  blockReorderSchema,
  contentIdSchema,
  footerFormSchema,
  sectionCreateSchema,
  sectionReorderSchema,
  sectionUpdateSchema,
  type BlockInput,
  type FooterFormInput,
  type SectionCreateInput,
  type SectionReorderInput,
  type SectionUpdateInput,
} from "./schemas";
import {
  addBlock,
  createSection,
  deleteBlock,
  deleteSection,
  duplicateSection,
  reorderBlocks,
  reorderSections,
  saveFooter,
  setSectionEnabled,
  updateBlock,
  updateSection,
} from "./service";

/**
 * Server Actions for /admin/homepage. Every commit invalidates the public
 * `content` cache (the storefront's /home and /footer read these rows) and
 * re-arms the `content.expire` chain so a publish window flips the storefront
 * at the boundary without anyone clicking Save again (§11.26, E1).
 */

const PATH = "/admin/homepage";
const PERMISSION = "homepage.manage";

async function afterChange(): Promise<void> {
  await invalidatePublic(["content"]);
  await scheduleContentExpiry();
  revalidatePath(PATH);
}

type SavedSection = { id: string; title: string; type: string };

export async function createSectionAction(input: SectionCreateInput): Promise<ActionResult<SavedSection>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(PERMISSION);
    const parsed = sectionCreateSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const row = await createSection(parsed.data, actor);
    await afterChange();
    return ok({ id: row.id, title: row.title, type: row.type }, `Section "${row.title}" added (disabled until you enable it).`);
  });
}

export async function updateSectionAction(id: string, input: SectionUpdateInput): Promise<ActionResult<SavedSection>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(PERMISSION);
    const parsedId = contentIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid section id.");
    const parsed = sectionUpdateSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const row = await updateSection(parsedId.data, parsed.data, actor);
    await afterChange();
    return ok({ id: row.id, title: row.title, type: row.type }, `Section "${row.title}" saved.`);
  });
}

export async function setSectionEnabledAction(id: string, enabled: boolean): Promise<ActionResult<SavedSection & { enabled: boolean }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(PERMISSION);
    const parsedId = contentIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid section id.");
    const row = await setSectionEnabled(parsedId.data, Boolean(enabled), actor);
    await afterChange();
    return ok({ id: row.id, title: row.title, type: row.type, enabled: row.enabled }, `Section ${row.enabled ? "enabled" : "disabled"}.`);
  });
}

export async function duplicateSectionAction(id: string): Promise<ActionResult<SavedSection>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(PERMISSION);
    const parsedId = contentIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid section id.");
    const row = await duplicateSection(parsedId.data, actor);
    await afterChange();
    return ok({ id: row.id, title: row.title, type: row.type }, "Duplicated (disabled until you enable it).");
  });
}

export async function deleteSectionAction(id: string): Promise<ActionResult<{ id: string; title: string; blocks: number }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(PERMISSION);
    const parsedId = contentIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid section id.");
    const result = await deleteSection(parsedId.data, actor);
    await afterChange();
    return ok(result, `Section "${result.title}" deleted.`);
  });
}

export async function reorderSectionsAction(input: SectionReorderInput): Promise<ActionResult<{ moved: number }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(PERMISSION);
    const parsed = sectionReorderSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const result = await reorderSections(parsed.data.ids, actor);
    await invalidatePublic(["content"]);
    revalidatePath(PATH);
    return ok(result, result.moved > 0 ? "Order saved." : undefined);
  });
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

type SavedBlock = { id: string; sectionId: string };

export async function addBlockAction(sectionId: string, input: BlockInput): Promise<ActionResult<SavedBlock>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(PERMISSION);
    const parsedId = contentIdSchema.safeParse(sectionId);
    if (!parsedId.success) return fail("Invalid section id.");
    const parsed = blockInputSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const row = await addBlock(parsedId.data, parsed.data, actor);
    await afterChange();
    return ok({ id: row.id, sectionId: row.sectionId }, "Item added.");
  });
}

export async function updateBlockAction(sectionId: string, blockId: string, input: BlockInput): Promise<ActionResult<SavedBlock>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(PERMISSION);
    const ids = [contentIdSchema.safeParse(sectionId), contentIdSchema.safeParse(blockId)];
    if (!ids[0]?.success || !ids[1]?.success) return fail("Invalid id.");
    const parsed = blockInputSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const row = await updateBlock(ids[0].data, ids[1].data, parsed.data, actor);
    await afterChange();
    return ok({ id: row.id, sectionId: row.sectionId }, "Item saved.");
  });
}

export async function deleteBlockAction(sectionId: string, blockId: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(PERMISSION);
    const ids = [contentIdSchema.safeParse(sectionId), contentIdSchema.safeParse(blockId)];
    if (!ids[0]?.success || !ids[1]?.success) return fail("Invalid id.");
    const result = await deleteBlock(ids[0].data, ids[1].data, actor);
    await afterChange();
    return ok(result, "Item removed.");
  });
}

export async function reorderBlocksAction(sectionId: string, ids: string[]): Promise<ActionResult<{ moved: number }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(PERMISSION);
    const parsedId = contentIdSchema.safeParse(sectionId);
    if (!parsedId.success) return fail("Invalid section id.");
    const parsed = blockReorderSchema.safeParse({ ids });
    if (!parsed.success) return zodFail(parsed.error);
    const result = await reorderBlocks(parsedId.data, parsed.data.ids, actor);
    await invalidatePublic(["content"]);
    revalidatePath(PATH);
    return ok(result, result.moved > 0 ? "Order saved." : undefined);
  });
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

export async function saveFooterAction(input: FooterFormInput): Promise<ActionResult<{ updatedAt: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow(PERMISSION);
    const parsed = footerFormSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const row = await saveFooter(parsed.data, actor);
    await invalidatePublic(["content"]);
    revalidatePath(PATH);
    return ok({ updatedAt: row.updatedAt.toISOString() }, "Footer saved.");
  });
}
