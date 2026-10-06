import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { requirePermission } from "@/lib/auth/guards";
import { formatIstDateTime } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGate } from "@/components/shared/permission-gate";

import { UserDangerZone } from "@/features/users/components/user-danger";
import { UserAccessCard, UserProfileCard } from "@/features/users/components/user-profile";
import { UserActivityCard, UserSessionsCard } from "@/features/users/components/user-sessions";
import { UserStatusBadge } from "@/features/users/components/user-table";
import { getUserDetail } from "@/features/users/queries";

export const metadata: Metadata = { title: "Admin user" };

/**
 * /admin/users/[id] (blueprint §1 Users, §14.D3).
 *
 * The whole screen is driven by `permissions`, computed on the server from
 * the D3 rules: which controls are enabled, and why they are not.
 */
export default async function UserDetailPage({ params }: PageProps<"/admin/users/[id]">) {
  const actor = await requirePermission("users.view");
  const { id } = await params;

  const detail = await getUserDetail(id, actor);
  if (!detail) notFound();

  const { user, permissions, roles } = detail;

  return (
    <div className="space-y-4">
      <PageHeader
        title={user.name ?? user.email}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{user.email}</span>
            {user.roleName ? (
              <Badge variant="secondary" className="h-5 font-normal">
                {user.roleName}
              </Badge>
            ) : null}
            <UserStatusBadge row={user} />
            <span className="text-muted-foreground">
              {user.lastLoginAt
                ? `Last signed in ${formatIstDateTime(new Date(user.lastLoginAt))}`
                : "Has never signed in"}
            </span>
          </span>
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={"/admin/users" as Route}>
              <ArrowLeft className="size-3.5" />
              All users
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <UserProfileCard user={user} permissions={permissions} />
          <UserAccessCard user={user} permissions={permissions} roles={roles} />
          <PermissionGate require="users.delete">
            <UserDangerZone user={user} permissions={permissions} />
          </PermissionGate>
        </div>

        <div className="space-y-4">
          <UserSessionsCard
            userId={user.id}
            sessions={user.sessions}
            permissions={permissions}
          />
          <UserActivityCard rows={user.activity} />
        </div>
      </div>
    </div>
  );
}
