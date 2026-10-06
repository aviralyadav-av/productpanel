import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { FAQ_SELECT, serializeFaq, type PublicFaqGroup } from "@/lib/serializers/public";

/**
 * FAQs for `/api/v1/faqs`: enabled rows grouped by `group`, groups in the
 * order their first question appears, questions by position.
 */

type Db = Prisma.TransactionClient;

export async function getFaqGroups(tx?: Db): Promise<PublicFaqGroup[]> {
  const rows = await (tx ?? db).faq.findMany({
    where: { enabled: true },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: FAQ_SELECT,
  });
  const groups = new Map<string, PublicFaqGroup>();
  for (const row of rows) {
    const name = row.group.trim() || "General";
    const group = groups.get(name) ?? { group: name, items: [] };
    group.items.push(serializeFaq(row));
    groups.set(name, group);
  }
  return [...groups.values()];
}
