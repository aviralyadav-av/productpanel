import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import {
  PERMISSIONS,
  ROLE_DEFINITIONS,
  SUPER_ADMIN_ROLE_SLUG,
} from "../../../src/lib/permissions";
import type { SeedContext } from "./context";

const BCRYPT_COST = 12;

/**
 * Permissions, the nine system roles with their grants, the super-admin from
 * SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD, one test user per other role, and the
 * inactive SYSTEM actor that jobs and cron write audit rows as.
 *
 * Role grants are re-synced on every run so that adding a code to
 * ROLE_DEFINITIONS reaches an existing database; custom (non-system) roles are
 * never touched.
 */
export async function seedAccess(db: PrismaClient, ctx: SeedContext) {
  // ---- permissions ----------------------------------------------------------
  for (const permission of PERMISSIONS) {
    await db.permission.upsert({
      where: { code: permission.code },
      update: {
        group: permission.group,
        label: permission.label,
        description: permission.description,
      },
      create: permission,
    });
  }
  const permissionRows = await db.permission.findMany({ select: { id: true, code: true } });
  const permissionId = new Map(permissionRows.map((row) => [row.code, row.id]));
  ctx.log(`permissions: ${permissionRows.length}`);

  // ---- roles ------------------------------------------------------------------
  const roleId = new Map<string, string>();
  for (const role of ROLE_DEFINITIONS) {
    const row = await db.role.upsert({
      where: { slug: role.slug },
      update: { name: role.name, description: role.description, isSystem: role.isSystem },
      create: {
        slug: role.slug,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
      },
      select: { id: true },
    });
    roleId.set(role.slug, row.id);

    const wanted = role.permissions.map((code) => {
      const id = permissionId.get(code);
      if (!id) throw new Error(`Role ${role.slug} grants unknown permission ${code}`);
      return id;
    });

    await db.rolePermission.deleteMany({
      where: { roleId: row.id, permissionId: { notIn: wanted } },
    });
    if (wanted.length > 0) {
      await db.rolePermission.createMany({
        data: wanted.map((id) => ({ roleId: row.id, permissionId: id })),
        skipDuplicates: true,
      });
    }
  }
  ctx.log(`roles: ${roleId.size}`);

  // ---- users ------------------------------------------------------------------
  const passwordHash = await bcrypt.hash(ctx.adminPassword, BCRYPT_COST);
  const superAdminRoleId = roleId.get(SUPER_ADMIN_ROLE_SLUG)!;

  const admin = await db.user.upsert({
    where: { email: ctx.adminEmail },
    // Never reset an existing admin's password on re-seed; only the role is
    // guaranteed so the account can always get in.
    update: { roleId: superAdminRoleId, isActive: true, deletedAt: null },
    create: {
      email: ctx.adminEmail,
      name: "Super Admin",
      passwordHash,
      roleId: superAdminRoleId,
      isActive: true,
    },
    select: { id: true },
  });
  ctx.adminUserId = admin.id;

  for (const role of ROLE_DEFINITIONS) {
    if (role.slug === SUPER_ADMIN_ROLE_SLUG) continue;
    // `admin@diybaazar.local` is also the default SEED_ADMIN_EMAIL; reusing it
    // here would demote the super-admin to the `admin` role. Never collide.
    const defaultEmail = `${role.slug}@diybaazar.local`;
    const email =
      defaultEmail === ctx.adminEmail ? `${role.slug}-test@diybaazar.local` : defaultEmail;
    await db.user.upsert({
      where: { email },
      update: { roleId: roleId.get(role.slug)! },
      create: {
        email,
        name: `${role.name} (test)`,
        passwordHash,
        roleId: roleId.get(role.slug)!,
        isActive: true,
      },
    });
  }

  // The SYSTEM actor cannot sign in: inactive, unusable random password.
  await db.user.upsert({
    where: { id: ctx.systemUserId },
    update: { roleId: superAdminRoleId, isActive: false },
    create: {
      id: ctx.systemUserId,
      email: "system@diybaazar.local",
      name: "System",
      passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), BCRYPT_COST),
      roleId: superAdminRoleId,
      isActive: false,
    },
  });

  // §3 invariant: at least one ACTIVE super-admin must always exist.
  const activeSuperAdmins = await db.user.count({
    where: { isActive: true, deletedAt: null, role: { slug: SUPER_ADMIN_ROLE_SLUG } },
  });
  if (activeSuperAdmins === 0) {
    throw new Error("Seed invariant violated: no active super-admin user exists after seeding.");
  }

  ctx.log(`users: ${await db.user.count()} (super-admin ${ctx.adminEmail})`);
}
