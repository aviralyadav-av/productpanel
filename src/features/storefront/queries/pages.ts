import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { CMS_PAGE_SELECT, serializePage, type PublicPage } from "@/lib/serializers/public";

/**
 * CMS pages for `/api/v1/pages/:slug` (blueprint §14.E5, E6).
 *
 * `preview: true` lifts the PUBLISHED filter for the one row the caller has
 * already authorised with a preview token; the route never caches that path.
 */

type Db = Prisma.TransactionClient;

export async function findPageIdBySlug(slug: string, tx?: Db): Promise<string | null> {
  const row = await (tx ?? db).cmsPage.findUnique({ where: { slug }, select: { id: true } });
  return row?.id ?? null;
}

export async function getPage(slug: string, options: { preview?: boolean } = {}, tx?: Db): Promise<PublicPage | null> {
  const row = await (tx ?? db).cmsPage.findFirst({
    where: { slug, ...(options.preview ? {} : { status: "PUBLISHED" }) },
    select: CMS_PAGE_SELECT,
  });
  return row ? serializePage(row) : null;
}
