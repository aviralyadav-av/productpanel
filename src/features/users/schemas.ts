/**
 * Client-safe vocabulary for /admin/users (blueprint §1 Users, §14.D3).
 *
 * Note what is NOT here: a password field. Admins never set another admin's
 * password (D3) - an invite or a reset link is the only path, so there is no
 * schema for one and therefore no way for a form to smuggle one in.
 */
import { z } from "zod";

import { one, type SearchParams } from "@/lib/list-params";
import { emailSchema, optionalTextSchema, phoneSchema } from "@/lib/validation";

export const USER_SORTS = ["name", "email", "role", "lastLoginAt", "createdAt"] as const;
export type UserSort = (typeof USER_SORTS)[number];

export function resolveUserSort(raw: string | undefined): UserSort {
  return (USER_SORTS as readonly string[]).includes(raw ?? "") ? (raw as UserSort) : "name";
}

export const userIdSchema = z.string().min(1).max(64);

/** "" and null both mean "no phone"; anything else must be a real number. */
const optionalPhoneSchema = z
  .union([z.literal(""), z.null(), z.undefined(), phoneSchema])
  .transform((value) => (value ? value : null));

export const inviteUserSchema = z.object({
  name: z.string().trim().min(2, "Enter the person's name.").max(80),
  email: emailSchema,
  roleId: z.string().min(1, "Choose a role."),
  phone: optionalPhoneSchema,
});
export type InviteUserInput = z.input<typeof inviteUserSchema>;
export type InviteUserValues = z.output<typeof inviteUserSchema>;

export const userProfileSchema = z.object({
  name: z.string().trim().min(2, "Enter a name.").max(80),
  email: emailSchema,
  phone: optionalPhoneSchema,
});
export type UserProfileInput = z.input<typeof userProfileSchema>;
export type UserProfileValues = z.output<typeof userProfileSchema>;

export const setUserRoleSchema = z.object({ roleId: z.string().min(1, "Choose a role.") });
export type SetUserRoleInput = z.input<typeof setUserRoleSchema>;

export const setUserStatusSchema = z.object({
  isActive: z.boolean(),
  reason: optionalTextSchema(280).optional().transform((value) => value ?? null),
});
export type SetUserStatusInput = z.input<typeof setUserStatusSchema>;

export const setForcePasswordChangeSchema = z.object({ forcePasswordChange: z.boolean() });
export type SetForcePasswordChangeInput = z.input<typeof setForcePasswordChangeSchema>;

export const deactivateUserSchema = z.object({
  reason: optionalTextSchema(280).optional().transform((value) => value ?? null),
});
export type DeactivateUserInput = z.input<typeof deactivateUserSchema>;

// ---------------------------------------------------------------------------
// URL contract: /admin/users?status=active|inactive|deleted&role=<id>&q=&sort=&order=&page=
// ---------------------------------------------------------------------------

export const USER_STATUS_FILTERS = ["active", "inactive", "deleted"] as const;
export type UserStatusFilter = (typeof USER_STATUS_FILTERS)[number];

export type UserListFilters = {
  q: string;
  status: UserStatusFilter | undefined;
  roleId: string | undefined;
  twoFactor: boolean | undefined;
};

export function parseUserFilters(params: SearchParams): UserListFilters {
  const status = one(params, "status");
  const twoFactor = one(params, "twofa");
  return {
    q: (one(params, "q") ?? "").trim(),
    status: (USER_STATUS_FILTERS as readonly string[]).includes(status ?? "")
      ? (status as UserStatusFilter)
      : undefined,
    roleId: one(params, "role"),
    twoFactor: twoFactor === "1" ? true : twoFactor === "0" ? false : undefined,
  };
}

export function hasUserFilters(filters: UserListFilters): boolean {
  return Boolean(filters.q || filters.status || filters.roleId || filters.twoFactor !== undefined);
}

// ---------------------------------------------------------------------------
// Row / detail shapes (client-safe: dates are ISO strings)
// ---------------------------------------------------------------------------

export type UserListRow = {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  image: string | null;
  roleId: string | null;
  roleName: string | null;
  roleSlug: string | null;
  isActive: boolean;
  deletedAt: string | null;
  twoFactorEnabled: boolean;
  forcePasswordChange: boolean;
  lastLoginAt: string | null;
  sessionCount: number;
  createdAt: string;
};

export type UserSessionRow = {
  id: string;
  deviceLabel: string | null;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  mfaVerifiedAt: string | null;
  isCurrent: boolean;
};

export type UserActivityRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  actorEmail: string;
  ip: string | null;
  createdAt: string;
};

export type RoleOption = {
  id: string;
  name: string;
  slug: string;
  isSystem: boolean;
  permissionCount: number;
  /** False when the D3 subset rule forbids the actor from assigning it. */
  assignable: boolean;
  /** Why not, for the disabled option's tooltip. */
  reason: string | null;
};

export type UserDetail = UserListRow & {
  sessions: UserSessionRow[];
  activity: UserActivityRow[];
  updatedAt: string;
};

/** What the current actor may do to this particular user (D3, computed server-side). */
export type UserPermissions = {
  canEdit: boolean;
  canChangeRole: boolean;
  canChangeStatus: boolean;
  canResetPassword: boolean;
  canRevokeSessions: boolean;
  canDelete: boolean;
  canDisableTwoFactor: boolean;
  /** Null when allowed; otherwise the sentence explaining the block. */
  reason: string | null;
  isSelf: boolean;
};
