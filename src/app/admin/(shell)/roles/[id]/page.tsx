import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { forbidden, notFound } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";

import { can, requirePermission } from "@/lib/auth/guards";
import { formatIstDateTime } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";

import { RoleForm } from "@/features/roles/components/role-form";
import { getRoleDetail, permissionGroupViews } from "@/features/roles/queries";
import { editRoleProblem, grantableCodes } from "@/features/roles/subset";

export const metadata: Metadata = { title: "Role" };

/**
 * /admin/roles/[id] (blueprint §3, §14.D3).
 *
 * `new` is handled by this same route so the create and edit screens cannot
 * drift apart - the only difference is that there is no role to load and no
 * user list to show.
 */
export default async function RoleDetailPage({ params }: PageProps<"/admin/roles/[id]">) {
  const actor = await requirePermission("roles.view");
  const { id } = await params;

  const canManage = can(actor, "roles.manage");
  const groups = permissionGroupViews();
  const grantable = grantableCodes(actor);

  if (id === "new") {
    if (!canManage) forbidden();
    return (
      <div className="space-y-4">
        <PageHeader
          title="New role"
          description="Pick the permissions this role grants. You can only grant what you already hold."
          actions={<BackButton />}
        />
        <RoleForm
          role={null}
          groups={groups}
          grantableCodes={grantable}
          editProblem={null}
          canManage={canManage}
          userCount={0}
        />
      </div>
    );
  }

  const role = await getRoleDetail(id);
  if (!role) notFound();

  const problem = canManage
    ? editRoleProblem(
        actor,
        {
          id: role.id,
          slug: role.slug,
          name: role.name,
          isSystem: role.isSystem,
          permissions: role.permissions,
        },
        role.permissions,
      )
    : "You do not have permission to change roles.";

  return (
    <div className="space-y-4">
      <PageHeader
        title={role.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <code className="text-[11px]">{role.slug}</code>
            {role.isSystem ? (
              <Badge variant="outline" className="h-5 gap-1 font-normal">
                <Lock className="size-3" />
                System role
              </Badge>
            ) : null}
            <span className="text-muted-foreground">
              {role.userCount} user(s) · updated {formatIstDateTime(new Date(role.updatedAt))}
            </span>
          </span>
        }
        actions={<BackButton />}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <RoleForm
          role={role}
          groups={groups}
          grantableCodes={grantable}
          editProblem={problem}
          canManage={canManage}
          userCount={role.userCount}
        />

        <section className="surface h-fit">
          <header className="border-b px-4 py-2.5">
            <h2 className="text-sm font-semibold tracking-tight">
              Users with this role{" "}
              <span data-numeric className="text-muted-foreground text-xs font-normal">
                {role.users.length}
              </span>
            </h2>
          </header>
          {role.users.length === 0 ? (
            <EmptyState
              title="Nobody holds this role"
              description="A role with no users can be deleted."
            />
          ) : (
            <ul className="divide-y">
              {role.users.map((user) => (
                <li key={user.id} className="px-4 py-2">
                  <Link
                    href={`/admin/users/${user.id}` as Route}
                    className="text-xs font-medium hover:underline"
                  >
                    {user.name ?? user.email}
                  </Link>
                  <p className="text-muted-foreground text-[11px]">
                    {user.email} · {user.isActive ? "active" : "inactive"} ·{" "}
                    {user.lastLoginAt
                      ? `last seen ${formatIstDateTime(new Date(user.lastLoginAt))}`
                      : "never signed in"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function BackButton() {
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={"/admin/roles" as Route}>
        <ArrowLeft className="size-3.5" />
        All roles
      </Link>
    </Button>
  );
}
