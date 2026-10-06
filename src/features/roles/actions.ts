"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, runAction, zodFail, type ActionResult } from "@/lib/action-result";
import { requirePermissionOrThrow } from "@/lib/auth/guards";

import { roleFormSchema, roleIdSchema, type RoleFormInput } from "./schemas";
import { createRole, deleteRole, updateRole } from "./service";

/**
 * Server Actions behind /admin/roles. Thin by design: permission -> zod ->
 * service -> revalidate. Every D3 rule (subset, own role, system role) is
 * decided inside the service so the REST handlers cannot diverge.
 */
const LIST_PATH = "/admin/roles";

export async function createRoleAction(
  input: RoleFormInput,
): Promise<ActionResult<{ id: string; slug: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("roles.manage");
    const parsed = roleFormSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const role = await createRole(parsed.data, actor);
    revalidatePath(LIST_PATH);
    return ok({ id: role.id, slug: role.slug }, `Role "${role.name}" created.`);
  });
}

export async function updateRoleAction(
  id: string,
  input: RoleFormInput,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("roles.manage");
    const roleId = roleIdSchema.safeParse(id);
    if (!roleId.success) return fail("Invalid role id.");
    const parsed = roleFormSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);

    const role = await updateRole(roleId.data, parsed.data, actor);
    revalidatePath(LIST_PATH);
    revalidatePath(`${LIST_PATH}/${roleId.data}`);
    return ok({ id: role.id }, `Role "${role.name}" saved.`);
  });
}

export async function deleteRoleAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("roles.manage");
    const roleId = roleIdSchema.safeParse(id);
    if (!roleId.success) return fail("Invalid role id.");

    const result = await deleteRole(roleId.data, actor);
    revalidatePath(LIST_PATH);
    return ok({ id: result.id }, `Role "${result.name}" deleted.`);
  });
}
