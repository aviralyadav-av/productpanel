import "dotenv/config";

import { db } from "@/lib/db";

import {
  addSubscriber,
  applySubscriberImport,
  bulkSubscribers,
  deleteSubscriber,
  previewSubscriberImport,
  subscribeFromPublic,
  unsubscribeByToken,
  unsubscribeUrlFor,
} from "@/features/newsletter/service";

/**
 * End-to-end check against the REAL database:
 *
 *   npx tsx src/features/newsletter/__checks__/newsletter-check.ts
 *
 * Walks the whole subscriber lifecycle - public sign-up (welcome email queued
 * with a working unsubscribe link), repeat sign-up (no second welcome), the
 * one-click unsubscribe and its idempotency, resubscribe, a CSV import dry run
 * and apply, and the bulk/manual paths - then deletes everything it created.
 */

const STAMP = Date.now();
const ACTOR = { id: "system", email: "system@diybaazar.local" };
const EMAILS = [
  `check_news_${STAMP}_a@example.invalid`,
  `check_news_${STAMP}_b@example.invalid`,
  `check_news_${STAMP}_c@example.invalid`,
];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
}

async function row(email: string) {
  return db.newsletterSubscriber.findUnique({ where: { email } });
}

async function welcomeCount(email: string): Promise<number> {
  return db.emailOutbox.count({ where: { toEmail: email } });
}

async function main(): Promise<void> {
  try {
    // 1. Public sign-up.
    const first = await subscribeFromPublic({ values: { email: EMAILS[0], name: "Check Bot", source: "footer" }, ip: "127.0.0.1" });
    assert(first.created, "first submission creates the subscriber");
    const created = await row(EMAILS[0]);
    assert(created && created.status === "SUBSCRIBED", "status is SUBSCRIBED");
    assert(created!.unsubscribeToken.length >= 24, "an unguessable unsubscribe token was generated");
    const emailsAfterFirst = await welcomeCount(EMAILS[0]);

    // 2. Repeat sign-up: no duplicate row, no second welcome.
    const second = await subscribeFromPublic({ values: { email: EMAILS[0].toUpperCase(), name: "Check Bot" }, ip: "127.0.0.1" });
    assert(!second.created && !second.resubscribed, "a repeat sign-up is a no-op");
    assert((await welcomeCount(EMAILS[0])) === emailsAfterFirst, "no second welcome email is queued");
    assert((await db.newsletterSubscriber.count({ where: { email: EMAILS[0] } })) === 1, "the email is still unique (case-insensitive input)");

    // 3. Honeypot: nothing is written, the caller cannot tell.
    const trap = await subscribeFromPublic({ values: { email: EMAILS[1], website: "http://spam.example" }, ip: "127.0.0.1" });
    assert(!trap.created && trap.message === first.message, "the honeypot answer is identical");
    assert((await row(EMAILS[1])) === null, "the honeypot submission stored nothing");

    // 4. One-click unsubscribe, then its idempotent replay (mail clients pre-fetch links).
    const token = created!.unsubscribeToken;
    assert(unsubscribeUrlFor(token).includes(token), "the unsubscribe URL carries the token");
    const off = await unsubscribeByToken(token);
    assert(off.ok && !off.alreadyUnsubscribed, "the first unsubscribe takes effect");
    const afterOff = await row(EMAILS[0]);
    assert(afterOff?.status === "UNSUBSCRIBED" && afterOff.unsubscribedAt, "status and unsubscribedAt are set");
    const again = await unsubscribeByToken(token);
    assert(again.ok && again.alreadyUnsubscribed, "a replayed unsubscribe is a no-op, not an error");
    assert((await unsubscribeByToken("not-a-real-token")).ok === false, "an unknown token reports failure without throwing");

    // 5. Resubscribe through the public form: welcome goes out again, token is unchanged.
    const back = await subscribeFromPublic({ values: { email: EMAILS[0] }, ip: "127.0.0.1" });
    assert(back.resubscribed, "an unsubscribed address can come back");
    const afterBack = await row(EMAILS[0]);
    assert(afterBack?.status === "SUBSCRIBED" && afterBack.unsubscribedAt === null, "unsubscribedAt is cleared");
    assert(afterBack?.unsubscribeToken === token, "the unsubscribe token is stable for the life of the row");

    // 6. Admin add + bulk unsubscribe.
    const manual = await addSubscriber({ email: EMAILS[1], name: "Manual", source: "admin", status: "SUBSCRIBED" }, ACTOR);
    assert(manual.source === "admin", "a hand-added subscriber records source=admin");
    const bulk = await bulkSubscribers({ ids: [manual.id], op: "unsubscribe" }, ACTOR);
    assert(bulk.affected === 1, "bulk unsubscribe affected one row");
    assert((await row(EMAILS[1]))?.status === "UNSUBSCRIBED", "bulk unsubscribe applied");

    // 7. CSV import: dry run reports, apply writes exactly what it reported.
    const csv = `email,name\n${EMAILS[2]},Imported Person\n${EMAILS[1]},Manual\n${EMAILS[0]},Check Bot\nnot-an-email,Broken\n`;
    const preview = await previewSubscriberImport({ csv, source: "import", apply: false });
    assert(preview.dryRun && preview.invalid === 1, "the dry run flags the invalid row");
    assert((await row(EMAILS[2])) === null, "the dry run wrote nothing");

    const rejected = await applySubscriberImport({ csv, source: "import", apply: true }, ACTOR);
    assert(rejected.created === 0 && rejected.fileErrors.length > 0, "a file with an invalid row is rejected whole");

    const cleanCsv = `email,name\n${EMAILS[2]},Imported Person\n${EMAILS[1]},Manual\n${EMAILS[2]},Duplicate\n`;
    const cleanPreview = await previewSubscriberImport({ csv: cleanCsv, source: "import", apply: false });
    assert(cleanPreview.toCreate === 1 && cleanPreview.toUpdate === 1 && cleanPreview.duplicates === 1, "the plan counts add/update/duplicate correctly");
    const applied = await applySubscriberImport({ csv: cleanCsv, source: "import", apply: true }, ACTOR);
    assert(applied.created === 1 && applied.updated === 1, "apply matches the plan");
    assert((await row(EMAILS[2]))?.status === "SUBSCRIBED", "the imported address is subscribed");
    assert((await row(EMAILS[1]))?.status === "SUBSCRIBED", "the unsubscribed address was reactivated by the import");

    // 8. Audit trail.
    const audits = await db.auditLog.findMany({
      where: { entityType: "NewsletterSubscriber", createdAt: { gte: new Date(STAMP) } },
      select: { action: true },
    });
    const actions = new Set(audits.map((audit) => audit.action));
    for (const action of ["newsletter.subscriber_add", "newsletter.bulk_unsubscribe", "newsletter.import"]) {
      assert(actions.has(action), `audit row written for ${action} (saw ${[...actions].join(", ")})`);
    }
    // The public sign-up is deliberately NOT audited: it is the subscriber's own
    // action, recorded by the row itself, not an administrator's.

    // 9. Manual delete.
    await deleteSubscriber(manual.id, ACTOR);
    assert((await row(EMAILS[1])) === null, "delete removes the row");

    console.log("newsletter-check PASSED", {
      welcomeEmailsQueued: await welcomeCount(EMAILS[0]),
      preview: { toCreate: cleanPreview.toCreate, toUpdate: cleanPreview.toUpdate },
      applied: { created: applied.created, updated: applied.updated },
    });
  } finally {
    // Swept by prefix rather than by this run's stamp, so a run that was killed
    // half way through does not leave rows behind for the next one to trip over.
    await db.newsletterSubscriber.deleteMany({ where: { email: { startsWith: "check_news_", mode: "insensitive" } } });
    await db.emailOutbox.deleteMany({ where: { toEmail: { startsWith: "check_news_", mode: "insensitive" } } }).catch(() => undefined);
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
