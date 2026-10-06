import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { BANNER_SELECT, serializeBanner, type PublicBanner } from "@/lib/serializers/public";

/**
 * Banners for `/api/v1/banners?placement=` and the hero/promo homepage
 * sections (blueprint §14.E1). "Active in-window" is evaluated in SQL so a
 * scheduled banner appears at startsAt without anyone saving anything - the
 * cache revalidates on its own timer.
 */

type Db = Prisma.TransactionClient;

export function bannerWindowWhere(now: Date): Prisma.BannerWhereInput {
  return {
    isActive: true,
    OR: [{ startsAt: null }, { startsAt: { lte: now } }],
    AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
  };
}

export async function getBanners(
  input: { placement?: string | null; limit?: number; now?: Date },
  tx?: Db,
): Promise<PublicBanner[]> {
  const client = tx ?? db;
  const now = input.now ?? new Date();
  const rows = await client.banner.findMany({
    where: { ...bannerWindowWhere(now), ...(input.placement ? { placement: input.placement } : {}) },
    orderBy: [{ placement: "asc" }, { position: "asc" }, { createdAt: "asc" }],
    take: input.limit,
    select: BANNER_SELECT,
  });
  return rows.map(serializeBanner);
}
