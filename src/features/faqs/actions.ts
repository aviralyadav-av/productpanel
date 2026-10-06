"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, runAction, zodFail, type ActionResult } from "@/lib/action-result";
import { requirePermissionOrThrow } from "@/lib/auth/guards";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";

import {
  faqFlagSchema,
  faqFormSchema,
  faqGroupDeleteSchema,
  faqGroupRenameSchema,
  faqGroupsReorderSchema,
  faqIdSchema,
  faqPatchSchema,
  faqReorderSchema,
  type FaqFlag,
  type FaqFormInput,
  type FaqGroupDeleteInput,
  type FaqGroupRenameInput,
  type FaqGroupsReorderInput,
  type FaqPatchInput,
  type FaqReorderInput,
} from "./schemas";
import { createFaq, deleteFaq, deleteFaqGroup, renameFaqGroup, reorderFaqGroups, reorderFaqs, setFaqFlag, updateFaq } from "./service";

/**
 * Server Actions for /admin/faqs: permission → zod → service (transaction +
 * audit) → invalidate the public `pages`/`content` cache (the storefront FAQ
 * page and the FAQ-template CMS page read it) → revalidate → ActionResult.
 */

const PATH = "/admin/faqs";

async function afterChange(): Promise<void> {
  await invalidatePublic(listTagsFor("faq"));
  revalidatePath(PATH);
}

export type SavedFaq = { id: string; question: string; group: string; enabled: boolean; isFeatured: boolean };

function saved(row: SavedFaq): SavedFaq {
  return { id: row.id, question: row.question, group: row.group, enabled: row.enabled, isFeatured: row.isFeatured };
}

export async function createFaqAction(input: FaqFormInput): Promise<ActionResult<SavedFaq>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("faqs.manage");
    const parsed = faqFormSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const row = await createFaq(parsed.data, actor);
    await afterChange();
    return ok(saved(row), `Added "${row.question}" to ${row.group}.`);
  });
}

export async function updateFaqAction(id: string, patch: FaqPatchInput): Promise<ActionResult<SavedFaq>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("faqs.manage");
    const parsedId = faqIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid FAQ id.");
    const parsed = faqPatchSchema.safeParse(patch);
    if (!parsed.success) return zodFail(parsed.error);
    const row = await updateFaq(parsedId.data, parsed.data, actor);
    await afterChange();
    return ok(saved(row), "FAQ saved.");
  });
}

export async function setFaqFlagAction(id: string, flag: FaqFlag, value: boolean): Promise<ActionResult<SavedFaq>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("faqs.manage");
    const parsedId = faqIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid FAQ id.");
    const parsed = faqFlagSchema.safeParse({ flag, value });
    if (!parsed.success) return zodFail(parsed.error);
    const row = await setFaqFlag(parsedId.data, parsed.data.flag, parsed.data.value, actor);
    await afterChange();
    const message = parsed.data.flag === "enabled" ? (row.enabled ? "Shown on the storefront." : "Hidden from the storefront.") : row.isFeatured ? "Marked as featured." : "No longer featured.";
    return ok(saved(row), message);
  });
}

export async function deleteFaqAction(id: string): Promise<ActionResult<{ id: string; question: string; group: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("faqs.manage");
    const parsedId = faqIdSchema.safeParse(id);
    if (!parsedId.success) return fail("Invalid FAQ id.");
    const result = await deleteFaq(parsedId.data, actor);
    await afterChange();
    return ok(result, `Deleted "${result.question}".`);
  });
}

export async function reorderFaqsAction(input: FaqReorderInput): Promise<ActionResult<{ moved: number; group: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("faqs.manage");
    const parsed = faqReorderSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const result = await reorderFaqs(parsed.data, actor);
    await afterChange();
    return ok(result, "Order saved.");
  });
}

export async function reorderFaqGroupsAction(input: FaqGroupsReorderInput): Promise<ActionResult<{ moved: number }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("faqs.manage");
    const parsed = faqGroupsReorderSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const result = await reorderFaqGroups(parsed.data.groups, actor);
    await afterChange();
    return ok(result, "Group order saved.");
  });
}

export async function renameFaqGroupAction(input: FaqGroupRenameInput): Promise<ActionResult<{ moved: number; from: string; to: string; merged: boolean }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("faqs.manage");
    const parsed = faqGroupRenameSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const result = await renameFaqGroup(parsed.data, actor);
    await afterChange();
    return ok(result, result.merged ? `Merged "${result.from}" into "${result.to}" (${result.moved} questions).` : `Renamed "${result.from}" to "${result.to}".`);
  });
}

export async function deleteFaqGroupAction(input: FaqGroupDeleteInput): Promise<ActionResult<{ moved: number; from: string; to: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("faqs.manage");
    const parsed = faqGroupDeleteSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const result = await deleteFaqGroup(parsed.data, actor);
    await afterChange();
    return ok(result, `Removed group "${result.from}"; ${result.moved} question${result.moved === 1 ? "" : "s"} moved to "${result.to}".`);
  });
}
