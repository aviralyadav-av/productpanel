import { SYSTEM_ACTOR, writeAudit } from "@/lib/audit";
import { invalidatePublic } from "@/lib/cache-tags";
import { db } from "@/lib/db";
import { enqueue, registerJobHandler } from "@/lib/queue";
import { purgeRateLimitBuckets } from "@/lib/rate-limit";
import { getStorage } from "@/lib/storage";
import { catalogRecomputeSubtreeJob } from "@/features/catalog/facets";
import { pricingRefreshJob } from "@/features/catalog/pricing";
import { FinanceError, generatePayout, markEarningsAvailableJob } from "@/features/finance/service";

/**
 * Platform job handlers - the jobs that belong to no wave-3 module (blueprint
 * §10 job list, D6, D9, B2, A6/A9). Each handler is a thin adapter: the work
 * itself lives in the owning service so an admin action can also call it
 * synchronously; the handler validates the payload, runs it and returns a
 * JSON-serialisable result for the jobs page.
 *
 *   rate_limit.purge           drop RateLimitBucket rows whose window closed > 24 h ago (D9)
 *   uploads.purge_pending      delete expired PendingUpload objects + rows (D6)
 *   content.expire             invalidate the public `content` cache at a publish boundary,
 *                              then queue itself for the next boundary
 *   earnings.mark_available    ledger PENDING -> AVAILABLE once the hold has passed (B2)
 *   pricing.refresh            recompute effective prices at a sale/promotion boundary (A9)
 *   catalog.recompute_subtree  rebuild facets + pricing under a category / for product ids (A6)
 *   payout.generate            create one seller's payout statement in a transaction (B4)
 *
 * Every handler is idempotent (§11.30): the queue is at-least-once, so a job
 * may run twice after a worker crash.
 */

const PURGE_BATCH = 200;

// ---------------------------------------------------------------------------
// uploads.purge_pending
// ---------------------------------------------------------------------------

/**
 * A customer who uploaded a customisation photo and never placed the order
 * leaves a PRIVATE object behind; 24 h later (PendingUpload.expiresAt) it is
 * garbage. Storage is deleted before the row so a crash between the two leaves
 * a row that the next sweep retries, never an orphaned object.
 */
export async function purgePendingUploads(now = new Date()): Promise<{ deleted: number; storageErrors: number }> {
  const storage = await getStorage();
  let deleted = 0;
  let storageErrors = 0;

  for (;;) {
    const expired = await db.pendingUpload.findMany({
      where: { expiresAt: { lt: now } },
      select: { id: true, storageKey: true },
      take: PURGE_BATCH,
      orderBy: { expiresAt: "asc" },
    });
    if (expired.length === 0) break;

    for (const upload of expired) {
      // Pending uploads are PRIVATE (D6); a PUBLIC attempt covers a misfiled
      // object without failing the sweep. Missing objects are not errors.
      try {
        await storage.delete(upload.storageKey, "PRIVATE");
        await storage.delete(upload.storageKey, "PUBLIC");
      } catch (error) {
        storageErrors += 1;
        console.warn(`[uploads.purge_pending] could not delete ${upload.storageKey}:`, error);
      }
    }

    const result = await db.pendingUpload.deleteMany({
      where: { id: { in: expired.map((upload) => upload.id) } },
    });
    deleted += result.count;
    if (expired.length < PURGE_BATCH) break;
  }

  return { deleted, storageErrors };
}

// ---------------------------------------------------------------------------
// content.expire
// ---------------------------------------------------------------------------

/**
 * Homepage sections, blocks and banners carry publish windows that the public
 * API filters at read time, so all a boundary needs is a cache invalidation -
 * without it the storefront keeps serving the cached pre-boundary payload for
 * up to s-maxage + stale-while-revalidate. The earliest future boundary across
 * the three models is the next time that has to happen.
 */
export async function nextContentBoundary(now = new Date()): Promise<Date | null> {
  const [bannerOn, bannerOff, sectionOn, sectionOff, blockOn, blockOff] = await Promise.all([
    db.banner.findFirst({ where: { isActive: true, startsAt: { gt: now } }, orderBy: { startsAt: "asc" }, select: { startsAt: true } }),
    db.banner.findFirst({ where: { isActive: true, endsAt: { gt: now } }, orderBy: { endsAt: "asc" }, select: { endsAt: true } }),
    db.contentSection.findFirst({ where: { publishAt: { gt: now } }, orderBy: { publishAt: "asc" }, select: { publishAt: true } }),
    db.contentSection.findFirst({ where: { unpublishAt: { gt: now } }, orderBy: { unpublishAt: "asc" }, select: { unpublishAt: true } }),
    db.contentBlock.findFirst({ where: { publishAt: { gt: now } }, orderBy: { publishAt: "asc" }, select: { publishAt: true } }),
    db.contentBlock.findFirst({ where: { unpublishAt: { gt: now } }, orderBy: { unpublishAt: "asc" }, select: { unpublishAt: true } }),
  ]);

  const candidates = [
    bannerOn?.startsAt,
    bannerOff?.endsAt,
    sectionOn?.publishAt,
    sectionOff?.unpublishAt,
    blockOn?.publishAt,
    blockOff?.unpublishAt,
  ].filter((date): date is Date => date instanceof Date);
  if (candidates.length === 0) return null;
  return new Date(Math.min(...candidates.map((date) => date.getTime())));
}

/**
 * Queue `content.expire` for one second past the next boundary, deduplicated
 * by that timestamp - the same chaining pattern as `schedulePricingRefresh`.
 * The handler calls this after every run and content services should call it
 * after saving a publish window; the hourly recurring run (schedule.ts) is the
 * safety net for a chain broken by a failed job.
 */
export async function scheduleContentExpiry(now = new Date()): Promise<Date | null> {
  const boundary = await nextContentBoundary(now);
  if (!boundary) return null;
  const runAt = new Date(boundary.getTime() + 1000);
  await enqueue("content.expire", {}, { runAt, dedupeKey: `content.expire:${runAt.toISOString()}`, priority: -5 });
  return runAt;
}

// ---------------------------------------------------------------------------
// payout.generate
// ---------------------------------------------------------------------------

export type PayoutGeneratePayload = {
  sellerId: string;
  /** ISO timestamp; ledger rows available on or before it are included. Defaults to now. */
  periodTo?: string;
  /** Admin who requested the statement; the SYSTEM user when scheduled. */
  actorId?: string | null;
  notes?: string | null;
};

export type PayoutGenerateResult =
  | { generated: true; payoutId: string; payoutNumber: string; netPaise: number; entryCount: number }
  | { generated: false; reason: "held"; netPaise: number; minPayoutPaise: number; entryCount: number }
  | { generated: false; reason: "PAYOUT_OPEN" | "NOT_FOUND"; message: string };

/**
 * One seller, one statement, one transaction: the SellerPayout row, the ledger
 * rows moving to SCHEDULED, the balance recompute and the audit row commit
 * together (D13). A statement below the minimum payout is "held" - nothing is
 * written and the rows carry forward - which is a normal outcome, not an error.
 */
export async function generatePayoutJob(payload: PayoutGeneratePayload): Promise<PayoutGenerateResult> {
  if (typeof payload.sellerId !== "string" || !payload.sellerId) {
    throw new Error("payout.generate payload requires sellerId");
  }
  const periodTo = payload.periodTo ? new Date(payload.periodTo) : new Date();
  if (Number.isNaN(periodTo.getTime())) {
    throw new Error(`payout.generate periodTo "${payload.periodTo}" is not a date`);
  }

  try {
    return await db.$transaction(async (tx) => {
      const outcome = await generatePayout(tx, {
        sellerId: payload.sellerId,
        periodTo,
        actorId: payload.actorId ?? SYSTEM_ACTOR.id,
        notes: payload.notes ?? null,
      });
      if (outcome.held) {
        return {
          generated: false,
          reason: "held",
          netPaise: outcome.netPaise,
          minPayoutPaise: outcome.minPayoutPaise,
          entryCount: outcome.entryCount,
        };
      }

      await writeAudit(tx, {
        actor: SYSTEM_ACTOR,
        action: "payout.generate",
        entityType: "SellerPayout",
        entityId: outcome.payout.id,
        entityLabel: outcome.payout.payoutNumber,
        summary: `Generated payout statement ${outcome.payout.payoutNumber} for seller ${payload.sellerId}: ${outcome.entryCount} ledger entries, net ${outcome.payout.netPaise} paise.`,
        diff: {
          sellerId: payload.sellerId,
          periodTo: periodTo.toISOString(),
          netPaise: outcome.payout.netPaise,
          entryCount: outcome.entryCount,
          requestedBy: payload.actorId ?? null,
        },
        ip: null,
        userAgent: null,
      });

      return {
        generated: true,
        payoutId: outcome.payout.id,
        payoutNumber: outcome.payout.payoutNumber,
        netPaise: outcome.payout.netPaise,
        entryCount: outcome.entryCount,
      };
    });
  } catch (error) {
    // Retrying cannot fix an open statement or a missing seller; record the
    // outcome on the job instead of burning five attempts on it.
    if (error instanceof FinanceError && (error.code === "PAYOUT_OPEN" || error.code === "NOT_FOUND")) {
      return { generated: false, reason: error.code, message: error.message };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// registration
// ---------------------------------------------------------------------------

type PricingRefreshPayload = { productIds?: string[]; promotionId?: string; categoryId?: string };
type RecomputeSubtreePayload = { categoryId?: string; productIds?: string[] };

let registered = false;

export function registerPlatformJobHandlers(): void {
  if (registered) return;
  registered = true;

  registerJobHandler("rate_limit.purge", async ({ log }) => {
    const purged = await purgeRateLimitBuckets();
    log(`purged ${purged} rate-limit bucket(s)`);
    return { purged };
  });

  registerJobHandler("uploads.purge_pending", async ({ log }) => {
    const result = await purgePendingUploads();
    log(`deleted ${result.deleted} expired pending upload(s), ${result.storageErrors} storage error(s)`);
    return result;
  });

  registerJobHandler("content.expire", async ({ log }) => {
    await invalidatePublic(["content"]);
    const nextRunAt = await scheduleContentExpiry();
    log(`invalidated public cache tag: content; next boundary ${nextRunAt?.toISOString() ?? "none"}`);
    return { invalidated: ["content"], nextRunAt: nextRunAt?.toISOString() ?? null };
  });

  registerJobHandler("earnings.mark_available", async ({ log }) => {
    const result = await markEarningsAvailableJob();
    log(`${result.updated} ledger entries -> AVAILABLE across ${result.sellers} seller(s)`);
    return result;
  });

  registerJobHandler<PricingRefreshPayload>("pricing.refresh", async ({ payload, log }) => {
    const result = await pricingRefreshJob({
      productIds: Array.isArray(payload.productIds) ? payload.productIds : undefined,
      promotionId: typeof payload.promotionId === "string" ? payload.promotionId : undefined,
      categoryId: typeof payload.categoryId === "string" ? payload.categoryId : undefined,
    });
    log(`recomputed pricing: ${result.updated} changed of ${result.scanned} scanned; next boundary ${result.nextRefreshAt ?? "none"}`);
    return result;
  });

  registerJobHandler<RecomputeSubtreePayload>("catalog.recompute_subtree", async ({ payload, log }) => {
    const categoryId = typeof payload.categoryId === "string" ? payload.categoryId : undefined;
    const productIds = Array.isArray(payload.productIds)
      ? payload.productIds.filter((id): id is string => typeof id === "string")
      : undefined;
    if (!categoryId && !(productIds && productIds.length > 0)) {
      log("nothing to recompute (no categoryId or productIds)");
      return { products: 0 };
    }
    const result = await catalogRecomputeSubtreeJob({ categoryId, productIds });
    log(`recomputed facets + pricing for ${result.products} product(s)`);
    return result;
  });

  registerJobHandler<PayoutGeneratePayload>("payout.generate", async ({ payload, log }) => {
    const result = await generatePayoutJob(payload);
    log(
      result.generated
        ? `created ${result.payoutNumber} (${result.entryCount} entries, net ${result.netPaise} paise)`
        : result.reason === "held"
          ? `held: net ${result.netPaise} paise is at or below the minimum ${result.minPayoutPaise} (${result.entryCount} entries carry forward)`
          : `not generated: ${result.reason} - ${result.message}`,
    );
    return result;
  });
}
