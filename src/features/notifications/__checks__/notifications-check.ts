import "dotenv/config";

import { db } from "@/lib/db";
import { NOTIFICATION_TYPES } from "@/lib/enums";

import { groupNotifications, parseNotificationFilters } from "@/features/notifications/schemas";
import { changedPreferences, savePreferences, sendTestNotification } from "@/features/notifications/preferences";
import { getPreferences, markRead, unreadCount } from "@/features/notifications/service";
import {
  listNotifications,
  notificationOverview,
  notificationTypeCounts,
} from "@/features/notifications/queries";

/**
 * End-to-end check against the REAL database:
 *
 *   node --env-file=.env --import tsx --import ./src/features/storefront/__checks__/stub-server-only.ts \
 *     src/features/notifications/__checks__/notifications-check.ts
 *
 * (queries.ts imports `server-only`, hence the stub preload.)
 *
 * Covers the inbox read path (filters, counts, unread-first ordering and the
 * grouping the list renders), the preferences round trip with its audit row,
 * and the "send me a test notification" probe. Every row it creates is
 * deleted again; the preferences it touches are put back exactly.
 */

const MARKER = `check_notifications_${Date.now()}`;

let failures = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    failures += 1;
    console.error(`  FAIL  ${message}`);
  } else {
    console.log(`  ok    ${message}`);
  }
}

const LIST_PARAMS = { page: 1, pageSize: 50, skip: 0, sort: "createdAt", order: "desc" as const, q: "" };

async function main(): Promise<void> {
  const actor = await db.user.findFirst({
    where: { isActive: true, deletedAt: null, roleId: { not: null } },
    select: { id: true, email: true, name: true },
  });
  if (!actor) {
    console.error("No active admin user - run the seed first.");
    process.exitCode = 1;
    return;
  }
  console.log(`\nActing as ${actor.email}\n`);

  const before = await notificationOverview(actor.id);
  const createdIds: string[] = [];

  try {
    // --- inbox -----------------------------------------------------------
    const unreadRow = await db.notification.create({
      data: {
        userId: actor.id,
        type: "LOW_STOCK",
        severity: "warning",
        title: `${MARKER} unread`,
        body: "Stock check",
        href: "/admin/inventory",
      },
      select: { id: true },
    });
    const readRow = await db.notification.create({
      data: {
        userId: actor.id,
        type: "NEW_ORDER",
        severity: "info",
        title: `${MARKER} read`,
        readAt: new Date(),
      },
      select: { id: true },
    });
    createdIds.push(unreadRow.id, readRow.id);

    const filters = parseNotificationFilters({ q: MARKER });
    const list = await listNotifications(actor.id, LIST_PARAMS, filters);
    assert(list.rows.length === 2, `the search finds both rows (got ${list.rows.length})`);
    assert(list.rows[0]?.readAt === null, "unread rows sort first");

    const groups = groupNotifications(list.rows);
    assert(groups[0]?.key === "unread", "the first group is the unread block");
    assert(groups.length === 2, `read rows form their own day group (got ${groups.length} groups)`);

    const unreadOnly = await listNotifications(
      actor.id,
      LIST_PARAMS,
      parseNotificationFilters({ q: MARKER, unread: "1" }),
    );
    assert(unreadOnly.rows.length === 1, "the unread filter narrows to one row");

    const bySeverity = await listNotifications(
      actor.id,
      LIST_PARAMS,
      parseNotificationFilters({ q: MARKER, severity: "warning" }),
    );
    assert(bySeverity.rows.length === 1, "the severity filter narrows to one row");

    const counts = await notificationTypeCounts(actor.id, parseNotificationFilters({ q: MARKER, type: "LOW_STOCK" }));
    assert(
      counts.LOW_STOCK === 1 && counts.NEW_ORDER === 1,
      "type counts drop the type filter so a selected tab never reads 0",
    );

    const after = await notificationOverview(actor.id);
    assert(after.unread === before.unread + 1, "the unread counter moved by exactly one");

    const marked = await markRead(actor.id, [unreadRow.id]);
    assert(marked === 1, "marking one row read reports one change");
    assert((await unreadCount(actor.id)) === before.unread, "the unread counter is back where it started");
    assert((await markRead(actor.id, [unreadRow.id])) === 0, "marking an already-read row is a no-op");

    // Another user's row must be untouchable.
    const other = await db.user.findFirst({
      where: { isActive: true, deletedAt: null, id: { not: actor.id } },
      select: { id: true },
    });
    if (other) {
      const foreign = await db.notification.create({
        data: { userId: other.id, type: "SYSTEM", severity: "info", title: `${MARKER} foreign` },
        select: { id: true },
      });
      createdIds.push(foreign.id);
      assert((await markRead(actor.id, [foreign.id])) === 0, "one admin cannot mark another admin's row read");
      const foreignRow = await db.notification.findUniqueOrThrow({ where: { id: foreign.id } });
      assert(foreignRow.readAt === null, "the other admin's row is still unread");
    }

    // --- preferences -----------------------------------------------------
    const original = await getPreferences(actor.id);
    assert(original.length === NOTIFICATION_TYPES.length, "every notification type has a preference row");
    assert(
      original.every((row) => typeof row.inApp === "boolean" && typeof row.email === "boolean"),
      "defaults are filled in for types the user has never touched",
    );

    const flipped = original.map((row) =>
      row.type === "LOW_STOCK" ? { ...row, email: !row.email } : row,
    );
    assert(changedPreferences(original, flipped).length === 1, "only the changed row is written");

    const auditBefore = await db.auditLog.count({
      where: { action: "notification.preferences_update", entityId: actor.id },
    });
    const saved = await savePreferences(actor, flipped);
    assert(saved.saved === 1, "saving reports one changed type");

    const reread = await getPreferences(actor.id);
    const lowStock = reread.find((row) => row.type === "LOW_STOCK");
    const originalLowStock = original.find((row) => row.type === "LOW_STOCK");
    assert(lowStock?.email !== originalLowStock?.email, "the flip persisted");

    const auditAfter = await db.auditLog.count({
      where: { action: "notification.preferences_update", entityId: actor.id },
    });
    assert(auditAfter === auditBefore + 1, "the change is audited exactly once");

    assert((await savePreferences(actor, reread)).saved === 0, "saving unchanged preferences writes nothing");

    // Put it back.
    await savePreferences(actor, original);
    const restored = await getPreferences(actor.id);
    assert(
      restored.find((row) => row.type === "LOW_STOCK")?.email === originalLowStock?.email,
      "preferences are restored to their original values",
    );

    // --- test notification ----------------------------------------------
    const test = await sendTestNotification(actor);
    createdIds.push(test.id);
    const testRow = await db.notification.findUniqueOrThrow({ where: { id: test.id } });
    assert(testRow.userId === actor.id, "the test notification lands in the actor's own inbox");
    assert(testRow.type === "SYSTEM", "the test notification is a SYSTEM row");
    assert(
      test.emailQueued === (restored.find((row) => row.type === "SYSTEM")?.email ?? false),
      "the test email is queued only when SYSTEM email delivery is on",
    );
    if (test.emailQueued) {
      const queued = await db.emailOutbox.findFirst({
        where: { toEmail: actor.email.toLowerCase(), subject: { startsWith: "[Test]" } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      assert(Boolean(queued), "the test email reached the outbox");
      if (queued) {
        await db.job.deleteMany({ where: { dedupeKey: `email.send:${queued.id}` } });
        await db.emailOutbox.delete({ where: { id: queued.id } });
      }
    }
  } finally {
    await db.notification.deleteMany({ where: { id: { in: createdIds } } });
  }

  const finalOverview = await notificationOverview(actor.id);
  assert(finalOverview.total === before.total, "every row this check created has been removed");

  if (failures > 0) {
    console.error(`\nFAILED with ${failures} problem(s).`);
    process.exitCode = 1;
    return;
  }
  console.log("\nPASSED");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
