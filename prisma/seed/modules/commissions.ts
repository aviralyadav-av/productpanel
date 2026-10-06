import type { PrismaClient } from "@prisma/client";

import { commissionTargetKey } from "../../../src/lib/enums";
import type { SeedContext } from "./context";

/**
 * Exactly one GLOBAL rule (10%) - the fallback every resolution ends at - and
 * one CATEGORY example (Paintings 15%) so the resolver has something to prefer.
 * Rates are re-asserted so a stale seed cannot leave the marketplace without a
 * global rate; admins tune commission in the Commissions screen (B3).
 */
export async function seedCommissions(db: PrismaClient, ctx: SeedContext) {
  await db.commissionRule.upsert({
    where: { targetKey: commissionTargetKey("GLOBAL") },
    update: { isActive: true },
    create: {
      scope: "GLOBAL",
      targetKey: commissionTargetKey("GLOBAL"),
      rateBps: 1000,
      fixedPaise: 0,
      isActive: true,
      note: "Marketplace default commission.",
    },
  });

  const paintings = await db.category.findUnique({
    where: { slug: "paintings" },
    select: { id: true },
  });
  if (paintings) {
    await db.commissionRule.upsert({
      where: { targetKey: commissionTargetKey("CATEGORY", paintings.id) },
      update: {},
      create: {
        scope: "CATEGORY",
        targetKey: commissionTargetKey("CATEGORY", paintings.id),
        categoryId: paintings.id,
        rateBps: 1500,
        fixedPaise: 0,
        isActive: true,
        note: "Original artwork carries a higher platform commission.",
      },
    });
  }

  ctx.log(`commission rules: ${await db.commissionRule.count()}`);
}
