"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { Lock, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { FormActions } from "@/components/shared/form-actions";
import { FormRow, FormSection } from "@/components/shared/form-layout";
import { SlugInput } from "@/components/shared/slug-input";
import { useActionToast } from "@/components/shared/use-action-toast";

import { createRoleAction, deleteRoleAction, updateRoleAction } from "@/features/roles/actions";
import { PermissionMatrix } from "@/features/roles/components/permission-matrix";
import type { PermissionGroupView } from "@/features/roles/queries";
import type { RoleDetail } from "@/features/roles/schemas";

/**
 * Create / edit a role (blueprint §3, §11.16, §14.D3).
 *
 * `editProblem` is computed on the SERVER by the same rule the service
 * enforces (system role, your own role, a role that out-ranks you). When it is
 * set the whole form is read-only and the sentence is shown - which is more
 * useful than a disabled Save with no explanation.
 */
export function RoleForm({
  role,
  groups,
  grantableCodes,
  editProblem,
  canManage,
  userCount,
}: {
  role: RoleDetail | null;
  groups: PermissionGroupView[];
  grantableCodes: string[];
  /** Null when the actor may save; otherwise the reason they may not. */
  editProblem: string | null;
  canManage: boolean;
  userCount: number;
}) {
  const router = useRouter();
  const { pending, run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();

  const [name, setName] = React.useState(role?.name ?? "");
  const [slug, setSlug] = React.useState(role?.slug ?? "");
  const [description, setDescription] = React.useState(role?.description ?? "");
  const [selected, setSelected] = React.useState<Set<string>>(
    () => new Set(role?.permissions ?? []),
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const grantable = React.useMemo(() => new Set(grantableCodes), [grantableCodes]);
  const readOnly = !canManage || Boolean(editProblem);
  const isSuperAdmin = role?.slug === "super-admin";

  const initialPermissions = React.useMemo(
    () => new Set(role?.permissions ?? []),
    [role?.permissions],
  );
  const dirty =
    name !== (role?.name ?? "") ||
    slug !== (role?.slug ?? "") ||
    description !== (role?.description ?? "") ||
    selected.size !== initialPermissions.size ||
    [...selected].some((code) => !initialPermissions.has(code));

  async function save() {
    const input = {
      name,
      slug,
      description,
      permissions: [...selected],
    };
    const result = await run(
      () => (role ? updateRoleAction(role.id, input) : createRoleAction(input)),
      {
        onSuccess: (data) => {
          setErrors({});
          if (!role && "id" in data) router.push(`/admin/roles/${data.id}` as Route);
          router.refresh();
        },
      },
    );
    if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
  }

  async function remove() {
    if (!role) return;
    const result = await confirm({
      title: `Delete the "${role.name}" role?`,
      description:
        userCount > 0
          ? `${userCount} user(s) still hold this role. Move them first - the delete will be refused.`
          : "The role and its permission grants are removed. This cannot be undone.",
      confirmLabel: "Delete role",
      destructive: true,
    });
    if (!result.ok) return;
    await run(() => deleteRoleAction(role.id), {
      onSuccess: () => {
        router.push("/admin/roles");
        router.refresh();
      },
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      className="space-y-4"
    >
      {editProblem ? (
        <p className="border-warning/40 bg-warning-muted text-warning rounded-lg border px-3 py-2 text-xs">
          <Lock className="mr-1 inline size-3.5" />
          {editProblem}
        </p>
      ) : null}

      <FormSection
        title="Role"
        description="The name operators see when assigning it, and the slug the seed and scripts use."
      >
        <FormRow label="Name" htmlFor="role-name" required error={errors.name}>
          <Input
            id="role-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={readOnly || pending}
          />
        </FormRow>

        <FormRow
          label="Slug"
          htmlFor="role-slug"
          hint="Lowercase, hyphenated. Generated from the name when left empty."
          error={errors.slug}
        >
          <SlugInput
            id="role-slug"
            value={slug}
            onChange={setSlug}
            sourceValue={name}
            disabled={readOnly || pending}
          />
        </FormRow>

        <FormRow label="Description" htmlFor="role-description" error={errors.description}>
          <Textarea
            id="role-description"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={readOnly || pending}
            placeholder="Who is this role for, and what should they be able to do?"
          />
        </FormRow>
      </FormSection>

      <FormSection
        title="Permissions"
        description={
          isSuperAdmin
            ? "Super-admin bypasses every check in code, so it holds no individual grants. It cannot be edited or deleted."
            : "A permission an operator lacks cannot be granted by them (D3). The two settings codes below are super-admin only."
        }
      >
        {isSuperAdmin ? (
          <p className="text-muted-foreground text-xs">
            Every permission, always - including any added in a future release.
          </p>
        ) : (
          <PermissionMatrix
            groups={groups}
            selected={selected}
            onChange={setSelected}
            grantable={grantable}
            disabled={readOnly || pending}
          />
        )}
        {errors.permissions ? (
          <p className="text-destructive text-xs">{errors.permissions}</p>
        ) : null}
      </FormSection>

      {!readOnly ? (
        <FormActions
          dirty={dirty}
          pending={pending}
          disabled={!dirty}
          submitLabel={role ? "Save role" : "Create role"}
          onCancel={() => router.push("/admin/roles")}
          secondary={
            role && !role.isSystem ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={remove}
              >
                <Trash2 className="size-3.5" />
                Delete
              </Button>
            ) : null
          }
        />
      ) : (
        <p className="text-muted-foreground text-xs">
          Read-only.{" "}
          <Link href={"/admin/roles/new" as Route} className="underline underline-offset-2">
            Copy it into a new role
          </Link>{" "}
          to change what it grants.
        </p>
      )}

      {confirmDialog}
    </form>
  );
}
