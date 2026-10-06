import "dotenv/config";
import { hostname, userInfo } from "node:os";

import { SYSTEM_ACTOR, writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";

/**
 * Break-glass 2FA reset (blueprint §14.D2).
 *
 *   npx tsx scripts/disable-2fa.ts <email> [--dry-run]
 *
 * For the admin who lost both the authenticator and the recovery codes. It
 * needs database access - there is deliberately no HTTP or UI path for this,
 * because anything reachable from a browser is reachable by whoever stole the
 * password. In one transaction it clears the TOTP secret, the last accepted
 * step and every recovery code, revokes all of the user's sessions (a session
 * that was mid-2FA must not survive the reset), and writes an AuditLog row as
 * the SYSTEM actor naming the OS user and host that ran it. The same line is
 * printed so the terminal transcript and the audit trail agree.
 *
 * The user signs in with their password only afterwards and should re-enrol
 * 2FA immediately.
 */

function usage(): never {
  console.error("Usage: npx tsx scripts/disable-2fa.ts <email> [--dry-run]");
  process.exit(2);
}

function mask(email: string): string {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 1)}***@${domain ?? ""}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const email = args.find((arg) => !arg.startsWith("--"))?.trim().toLowerCase();
  if (!email || !email.includes("@")) usage();

  const user = await db.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: {
      id: true,
      email: true,
      name: true,
      isActive: true,
      deletedAt: true,
      twoFactorEnabled: true,
      twoFactorSecretEnc: true,
      recoveryCodesHash: true,
      lastTotpStep: true,
    },
  });
  if (!user) {
    console.error(`No admin user with email ${email}.`);
    process.exit(1);
  }
  if (user.deletedAt) {
    console.error(`User ${user.email} is deleted; nothing to do.`);
    process.exit(1);
  }

  const now = new Date();
  const openSessions = await db.adminSession.count({
    where: { userId: user.id, revokedAt: null, expiresAt: { gt: now } },
  });
  const operator = `${userInfo().username}@${hostname()}`;

  console.log(`User:            ${user.email} (${user.id})${user.name ? ` - ${user.name}` : ""}`);
  console.log(`Active:          ${user.isActive}`);
  console.log(
    `2FA enabled:     ${user.twoFactorEnabled} (secret ${user.twoFactorSecretEnc ? "set" : "not set"}, ${user.recoveryCodesHash.length} recovery codes)`,
  );
  console.log(`Open sessions:   ${openSessions}`);
  console.log(`Operator:        ${operator}`);

  if (!user.twoFactorEnabled && !user.twoFactorSecretEnc && user.recoveryCodesHash.length === 0) {
    console.log("Two-factor is already disabled for this user; sessions will still be revoked.");
  }
  if (dryRun) {
    console.log("--dry-run: no changes made.");
    return;
  }

  const result = await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        twoFactorEnabled: false,
        twoFactorSecretEnc: null,
        recoveryCodesHash: [],
        lastTotpStep: null,
      },
    });
    const revoked = await tx.adminSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: now },
    });

    // Inside the transaction (D13): if the audit row cannot be written the
    // reset does not happen. The break-glass path is the last one that may
    // go unrecorded.
    await writeAudit(tx, {
      actor: SYSTEM_ACTOR,
      action: "auth.2fa_disabled",
      entityType: "User",
      entityId: user.id,
      entityLabel: user.email,
      summary: `Break-glass: two-factor authentication disabled for ${user.email} by ${operator} via scripts/disable-2fa.ts; ${revoked.count} session(s) revoked.`,
      diff: {
        twoFactorEnabled: { from: user.twoFactorEnabled, to: false },
        recoveryCodes: { from: user.recoveryCodesHash.length, to: 0 },
        lastTotpStep: { from: user.lastTotpStep, to: null },
        sessionsRevoked: revoked.count,
        operator,
      },
      ip: null,
      userAgent: "scripts/disable-2fa.ts",
    });

    return { revoked: revoked.count };
  });

  console.log(
    `AUDIT ${now.toISOString()} action=auth.2fa_disabled actor=${SYSTEM_ACTOR.email} operator=${operator} user=${user.id} email=${mask(user.email)} sessionsRevoked=${result.revoked}`,
  );
  console.log("Done. The user can sign in with their password and should re-enrol 2FA immediately.");
}

main()
  .then(async () => {
    await db.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect().catch(() => undefined);
    process.exit(1);
  });
