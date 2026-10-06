import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { SETTING_DEFINITIONS } from "@/lib/settings-keys";
import { FOOTER_SELECT, serializeFooter, type PublicFooter } from "@/lib/serializers/public";
import { getMenus } from "./navigation";

/**
 * `/api/v1/footer` (blueprint §14.E1): the single FooterConfig row, the three
 * footer NavigationMenus and the public `social.*` profile links.
 *
 * Social links are read straight from the Setting table rather than through
 * lib/settings because that module is `server-only` and this query must stay
 * importable from plain tsx (the denylist check, tests). The key list still
 * comes from SETTING_DEFINITIONS so a new public social key appears here
 * automatically and a secret never can.
 */

type Db = Prisma.TransactionClient;

export const FOOTER_MENU_SLUGS = ["footer-1", "footer-2", "footer-3"] as const;

const SOCIAL_PREFIX = "social.";

const SOCIAL_KEYS = SETTING_DEFINITIONS.filter(
  (definition) => definition.key.startsWith(SOCIAL_PREFIX) && definition.isPublic && definition.type !== "secret",
).map((definition) => definition.key);

async function socialSettings(client: Db): Promise<Record<string, string>> {
  if (SOCIAL_KEYS.length === 0) return {};
  const rows = await client.setting.findMany({
    where: { key: { in: SOCIAL_KEYS } },
    select: { key: true, value: true },
  });
  const social: Record<string, string> = {};
  for (const row of rows) {
    const value = row.value.trim();
    if (/^https?:\/\//i.test(value)) social[row.key.slice(SOCIAL_PREFIX.length)] = value;
  }
  return social;
}

export async function getFooter(tx?: Db): Promise<PublicFooter> {
  const client = tx ?? db;
  const [row, menus, social] = await Promise.all([
    client.footerConfig.findUnique({ where: { id: "default" }, select: FOOTER_SELECT }),
    getMenus(FOOTER_MENU_SLUGS, client),
    socialSettings(client),
  ]);
  return serializeFooter(row, social, menus);
}
