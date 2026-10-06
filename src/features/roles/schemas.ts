/**
 * Client-safe vocabulary for /admin/roles: zod inputs, URL parsing and the
 * row/detail shapes the components render. No db imports, so a Client
 * Component can import the types without dragging Prisma into the bundle.
 */
import { z } from "zod";

import { PERMISSION_CODES } from "@/lib/permissions";
import { one, type SearchParams } from "@/lib/list-params";
import { SLUG_PATTERN, slugify } from "@/lib/validation";

export const ROLE_SORTS = ["name", "slug", "users", "permissions", "updatedAt"] as const;
export type RoleSort = (typeof ROLE_SORTS)[number];

export function resolveRoleSort(raw: string | undefined): RoleSort {
  return (ROLE_SORTS as readonly string[]).includes(raw ?? "") ? (raw as RoleSort) : "name";
}

export const roleIdSchema = z.string().min(1).max(64);

const permissionCodeSchema = z
  .string()
  .refine((code) => (PERMISSION_CODES as readonly string[]).includes(code), {
    message: "Unknown permission code.",
  });

export const roleFormSchema = z.object({
  name: z.string().trim().min(2, "Give the role a name.").max(60),
  slug: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((value) => (value ? slugify(value) : ""))
    .refine((value) => value === "" || SLUG_PATTERN.test(value), {
      message: "Use lowercase letters, numbers and hyphens.",
    }),
  description: z.string().trim().max(280).nullish().transform((value) => value || null),
  permissions: z.array(permissionCodeSchema).max(PERMISSION_CODES.length).default([]),
});

export type RoleFormInput = z.input<typeof roleFormSchema>;
export type RoleFormValues = z.output<typeof roleFormSchema>;

export type RoleListFilters = { q: string; system: boolean | undefined };

export function parseRoleFilters(params: SearchParams): RoleListFilters {
  const system = one(params, "system");
  return {
    q: (one(params, "q") ?? "").trim(),
    system: system === "1" ? true : system === "0" ? false : undefined,
  };
}

export function hasRoleFilters(filters: RoleListFilters): boolean {
  return Boolean(filters.q) || filters.system !== undefined;
}

/** One row of /admin/roles. */
export type RoleListRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  userCount: number;
  permissionCount: number;
  updatedAt: string;
};

export type RoleUserRow = {
  id: string;
  name: string | null;
  email: string;
  isActive: boolean;
  lastLoginAt: string | null;
};

/** Everything /admin/roles/[id] renders. */
export type RoleDetail = RoleListRow & {
  permissions: string[];
  users: RoleUserRow[];
  createdAt: string;
};
