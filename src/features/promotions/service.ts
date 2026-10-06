import type { Prisma, Promotion } from "@prisma/client";

import { conflict, notFound } from "@/lib/api/errors";
import { diffOf, writeAudit, type AuditActor } from "@/lib/audit";
import { db } from "@/lib/db";
import { slugify } from "@/lib/validation";
import { promotionActive, recomputeProductPricing, schedulePricingRefresh } from "@/features/catalog/pricing";

import type { PromotionFormValues } from "./schemas";

/**
 * Promotion mutations (blueprint §4.7, §14.A4, §11.6, §11.23).
 *
 * Every save ends with `recomputeProductPricing(tx, { promotionId })`, which
 * re-prices both the products the promotion now covers AND the products that
 * carried it before (via `activePromotionId`), so narrowing or ending a
 * promotion removes it from the storefront in the same transaction. It then
 * queues `pricing.refresh` for the next window boundary so the switch-over
 * happens on time without anyone touching the admin.
 *
 * No `server-only` / `next/*` imports: the job handler and the REST routes
 * call in here directly; cache invalidation lives in actions.ts / routes.
 */

type Db = Prisma.TransactionClient;

export type PromotionSaveResult = { promotion: Promotion; repriced: number; productIds: string[] };

function auditSnapshot(row: Promotion): Record<string, unknown> {
  const { createdAt, updatedAt, ...rest } = row;
  void createdAt;
  void updatedAt;
  return rest;
}

async function loadPromotion(tx: Db, id: string): Promise<Promotion> {
  const row = await tx.promotion.findUnique({ where: { id } });
  if (!row) throw notFound("Promotion");
  return row;
}

/** §11.23: auto-suffix on create, explicit error on edit. */
async function resolveSlug(tx: Db, wanted: string, mode: "create" | "edit", exceptId?: string): Promise<string> {
  const base = slugify(wanted) || "promotion";
  const clash = await tx.promotion.findFirst({ where: { slug: base, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
  if (!clash) return base;
  if (mode === "edit") throw conflict("Another promotion already uses this slug.", { slug: "This slug is already taken." });
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`;
    const taken = await tx.promotion.findFirst({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  throw conflict("Could not find a free slug for this promotion.");
}

function toData(input: PromotionFormValues): Omit<Prisma.PromotionUncheckedCreateInput, "slug"> {
  return {
    name: input.name,
    description: input.description ?? null,
    type: input.type,
    discountType: input.discountType,
    value: input.value,
    appliesTo: input.appliesTo,
    categoryIds: input.categoryIds,
    productIds: input.productIds,
    sellerIds: input.sellerIds,
    badgeText: input.badgeText ?? null,
    bannerMediaId: input.bannerMediaId,
    priority: input.priority,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    isActive: input.isActive,
    fundedBy: input.fundedBy,
  };
}

async function repriceFor(tx: Db, promotionId: string): Promise<{ repriced: number; productIds: string[] }> {
  const result = await recomputeProductPricing(tx, { promotionId });
  await schedulePricingRefresh(tx);
  return { repriced: result.updated, productIds: result.productIds };
}

export async function createPromotion(input: PromotionFormValues, actor: AuditActor): Promise<PromotionSaveResult> {
  return db.$transaction(
    async (tx) => {
      const slug = await resolveSlug(tx, input.slug ?? input.name, "create");
      const promotion = await tx.promotion.create({ data: { ...toData(input), slug } });
      const pricing = await repriceFor(tx, promotion.id);
      await writeAudit(tx, {
        actor,
        action: "promotion.create",
        entityType: "promotion",
        entityId: promotion.id,
        entityLabel: promotion.name,
        summary: `Created promotion "${promotion.name}" (${pricing.repriced} products re-priced).`,
        diff: diffOf(null, auditSnapshot(promotion)),
      });
      return { promotion, ...pricing };
    },
    { timeout: 60_000 },
  );
}

export async function updatePromotion(id: string, input: PromotionFormValues, actor: AuditActor): Promise<PromotionSaveResult> {
  return db.$transaction(
    async (tx) => {
      const before = await loadPromotion(tx, id);
      const slug = input.slug && input.slug !== before.slug ? await resolveSlug(tx, input.slug, "edit", id) : before.slug;
      const promotion = await tx.promotion.update({ where: { id }, data: { ...toData(input), slug } });
      const pricing = await repriceFor(tx, promotion.id);
      await writeAudit(tx, {
        actor,
        action: "promotion.update",
        entityType: "promotion",
        entityId: promotion.id,
        entityLabel: promotion.name,
        summary: `Updated promotion "${promotion.name}" (${pricing.repriced} products re-priced).`,
        diff: diffOf(auditSnapshot(before), auditSnapshot(promotion)),
      });
      return { promotion, ...pricing };
    },
    { timeout: 60_000 },
  );
}

export async function setPromotionActive(id: string, isActive: boolean, actor: AuditActor): Promise<PromotionSaveResult> {
  return db.$transaction(
    async (tx) => {
      const before = await loadPromotion(tx, id);
      if (before.isActive === isActive) return { promotion: before, repriced: 0, productIds: [] };
      const promotion = await tx.promotion.update({ where: { id }, data: { isActive } });
      const pricing = await repriceFor(tx, promotion.id);
      await writeAudit(tx, {
        actor,
        action: isActive ? "promotion.enable" : "promotion.disable",
        entityType: "promotion",
        entityId: promotion.id,
        entityLabel: promotion.name,
        summary: `${isActive ? "Enabled" : "Disabled"} promotion "${promotion.name}" (${pricing.repriced} products re-priced).`,
        diff: diffOf({ isActive: before.isActive }, { isActive }),
      });
      return { promotion, ...pricing };
    },
    { timeout: 60_000 },
  );
}

export type DeletePromotionResult = { id: string; name: string; repriced: number; productIds: string[] };

/**
 * Promotions have no order-history FK (OrderItem snapshots the discount), so
 * deletion is always hard. `Product.activePromotionId` is SetNull by the
 * schema; the products that carried it are re-priced explicitly because the
 * row is gone by the time `{ promotionId }` would look for it.
 */
export async function deletePromotion(id: string, actor: AuditActor, reason?: string): Promise<DeletePromotionResult> {
  return db.$transaction(
    async (tx) => {
      const row = await loadPromotion(tx, id);
      const carriers = await tx.product.findMany({ where: { activePromotionId: id }, select: { id: true } });
      await tx.promotion.delete({ where: { id } });
      const productIds = carriers.map((product) => product.id);
      const result = productIds.length > 0 ? await recomputeProductPricing(tx, { productIds }) : { updated: 0, productIds: [] };
      await schedulePricingRefresh(tx);
      await writeAudit(tx, {
        actor,
        action: "promotion.delete",
        entityType: "promotion",
        entityId: row.id,
        entityLabel: row.name,
        summary: `Deleted promotion "${row.name}"${reason ? ` - ${reason}` : ""} (${result.updated} products re-priced).`,
        diff: diffOf(auditSnapshot(row), null),
      });
      return { id: row.id, name: row.name, repriced: result.updated, productIds: result.productIds };
    },
    { timeout: 60_000 },
  );
}

export type ExpirePromotionsResult = { checked: number; repriced: number; promotionIds: string[] };

/**
 * Body of the hourly `promotions.expire` job (schedule.ts). The boundary
 * chain (`schedulePricingRefresh`) normally handles the exact instant a
 * window opens or closes; this is the safety net that catches a chain broken
 * by a failed job: every promotion that is live now, or that products still
 * carry while it is not, gets re-priced.
 */
export async function expirePromotions(now: Date = new Date()): Promise<ExpirePromotionsResult> {
  const promotions = await db.promotion.findMany({
    select: { id: true, isActive: true, startsAt: true, endsAt: true, activeOnProducts: { take: 1, select: { id: true } } },
  });
  const stale = promotions.filter((promotion) => {
    const live = promotion.isActive && promotion.startsAt <= now && promotion.endsAt >= now;
    return live || promotion.activeOnProducts.length > 0;
  });

  let repriced = 0;
  for (const promotion of stale) {
    const result = await db.$transaction((tx) => recomputeProductPricing(tx, { promotionId: promotion.id, now }), { timeout: 120_000 });
    repriced += result.updated;
  }
  await schedulePricingRefresh(undefined, now);
  return { checked: promotions.length, repriced, promotionIds: stale.map((promotion) => promotion.id) };
}

export { promotionActive };
