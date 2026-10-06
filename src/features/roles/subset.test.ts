import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PERMISSION_CODES, SUPER_ADMIN_ROLE_SLUG } from "@/lib/permissions";
import {
  assignRoleProblem,
  canAssignRole,
  canGrant,
  editRoleProblem,
  grantableCodes,
  isSuperAdminOnly,
  normalizePermissionCodes,
  reachProblem,
  ungrantableCodes,
  type PermissionActor,
  type RoleGrant,
} from "@/features/roles/subset";

/**
 * The privilege-escalation rules (blueprint §14.D3) without a database.
 *
 * These are the rules that decide whether an operator can quietly promote
 * themselves, so they are worth a test that reads like the rule itself: you
 * may hand out only what you hold, you may not touch somebody who out-ranks
 * you, and only a super-admin makes another super-admin.
 * Run with `npm test`.
 */

function actor(permissions: string[], options: Partial<PermissionActor> = {}): PermissionActor {
  return {
    id: "actor-1",
    email: "actor@example.test",
    isSuperAdmin: false,
    permissions: new Set(permissions),
    roleId: "role-actor",
    ...options,
  };
}

function role(permissions: string[], options: Partial<RoleGrant> = {}): RoleGrant {
  return {
    id: "role-target",
    slug: "target",
    name: "Target",
    isSystem: false,
    permissions,
    ...options,
  };
}

const SUPER_ADMIN = actor([], { id: "sa", email: "sa@example.test", isSuperAdmin: true, roleId: "role-sa" });

describe("grantableCodes / canGrant", () => {
  it("gives a super-admin every registered code", () => {
    assert.equal(grantableCodes(SUPER_ADMIN).length, PERMISSION_CODES.length);
  });

  it("gives everyone else exactly what they hold", () => {
    const subject = actor(["orders.view", "orders.update"]);
    assert.deepEqual(grantableCodes(subject), ["orders.view", "orders.update"].sort((a, b) =>
      PERMISSION_CODES.indexOf(a) - PERMISSION_CODES.indexOf(b),
    ));
    assert.equal(canGrant(subject, "orders.view"), true);
    assert.equal(canGrant(subject, "orders.cancel"), false);
  });

  it("never lets a non-super-admin hand out the super-admin-only codes, even if they somehow hold one", () => {
    const subject = actor(["settings.manage_payments", "settings.manage"]);
    assert.equal(isSuperAdminOnly("settings.manage_payments"), true);
    assert.equal(canGrant(subject, "settings.manage_payments"), false);
    assert.equal(canGrant(SUPER_ADMIN, "settings.manage_payments"), true);
  });

  it("reports missing codes in registry order", () => {
    const subject = actor(["orders.view"]);
    assert.deepEqual(ungrantableCodes(subject, ["orders.cancel", "orders.view", "users.delete"]), [
      "orders.cancel",
      "users.delete",
    ]);
  });
});

describe("normalizePermissionCodes", () => {
  it("drops unknown codes, de-duplicates and returns registry order", () => {
    const normalized = normalizePermissionCodes([
      "orders.update",
      "not.a.code",
      "orders.view",
      "orders.view",
    ]);
    assert.deepEqual(normalized, ["orders.view", "orders.update"]);
  });
});

describe("assignRoleProblem (who may be put into a role)", () => {
  it("allows a role whose grants are a subset of the actor's", () => {
    const subject = actor(["orders.view", "orders.update", "customers.view"]);
    assert.equal(canAssignRole(subject, role(["orders.view"])), true);
  });

  it("refuses a role that grants something the actor lacks, and names it", () => {
    const subject = actor(["orders.view"]);
    const problem = assignRoleProblem(subject, role(["orders.view", "users.delete"]));
    assert.ok(problem);
    assert.match(problem, /users\.delete/);
  });

  it("reserves the super-admin role for super-admins", () => {
    const powerful = actor(PERMISSION_CODES as unknown as string[]);
    const superRole = role([], { slug: SUPER_ADMIN_ROLE_SLUG, name: "Super Admin", isSystem: true });
    assert.match(assignRoleProblem(powerful, superRole) ?? "", /Only a super-admin/);
    assert.equal(assignRoleProblem(SUPER_ADMIN, superRole), null);
  });

  it("lets a super-admin assign anything", () => {
    assert.equal(assignRoleProblem(SUPER_ADMIN, role(["users.delete", "roles.manage"])), null);
  });
});

describe("reachProblem (who may act ON a user)", () => {
  it("lets an actor manage somebody with a subset role", () => {
    const subject = actor(["orders.view", "orders.update"]);
    assert.equal(reachProblem(subject, role(["orders.view"])), null);
  });

  it("refuses to manage somebody who holds more", () => {
    const subject = actor(["orders.view"]);
    const problem = reachProblem(subject, role(["orders.view", "roles.manage"]), "deactivate");
    assert.ok(problem);
    assert.match(problem, /deactivate/);
  });

  it("refuses to manage a super-admin unless you are one", () => {
    const subject = actor(PERMISSION_CODES as unknown as string[]);
    const superRole = role([], { slug: SUPER_ADMIN_ROLE_SLUG, isSystem: true });
    assert.match(reachProblem(subject, superRole, "edit") ?? "", /Only a super-admin/);
    assert.equal(reachProblem(SUPER_ADMIN, superRole, "edit"), null);
  });

  it("treats a role-less user as reachable", () => {
    assert.equal(reachProblem(actor([]), null), null);
  });
});

describe("editRoleProblem (what may be saved onto a role)", () => {
  it("blocks system roles for everyone, super-admin included", () => {
    const systemRole = role(["orders.view"], { isSystem: true, name: "Admin" });
    assert.match(editRoleProblem(SUPER_ADMIN, systemRole, ["orders.view"]) ?? "", /system role/);
  });

  it("blocks editing the role the actor is standing on", () => {
    const own = role(["orders.view"], { id: "role-actor" });
    const subject = actor(["orders.view"], { roleId: "role-actor" });
    assert.match(editRoleProblem(subject, own, ["orders.view"]) ?? "", /your own role|role you are assigned/i);
  });

  it("blocks granting a permission the actor does not hold", () => {
    const subject = actor(["orders.view"]);
    const problem = editRoleProblem(subject, role(["orders.view"]), ["orders.view", "users.delete"]);
    assert.ok(problem);
    assert.match(problem, /users\.delete/);
  });

  it("blocks editing a role that already out-ranks the actor, even when removing a permission", () => {
    const subject = actor(["orders.view"]);
    const problem = editRoleProblem(subject, role(["orders.view", "roles.manage"]), ["orders.view"]);
    assert.ok(problem);
  });

  it("allows a create (no role yet) within the actor's own grants", () => {
    const subject = actor(["orders.view", "orders.update"]);
    assert.equal(editRoleProblem(subject, null, ["orders.view"]), null);
    assert.ok(editRoleProblem(subject, null, ["users.delete"]));
  });

  it("lets a super-admin edit any non-system role", () => {
    assert.equal(editRoleProblem(SUPER_ADMIN, role(["users.delete"]), ["roles.manage"]), null);
  });
});
