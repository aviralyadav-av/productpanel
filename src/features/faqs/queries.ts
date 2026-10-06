import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

import { normalizeGroupName, type FaqBoardData, type FaqGroupSummary, type FaqGroupView, type FaqListFilters, type FaqRow } from "./schemas";

/**
 * Read side of /admin/faqs. There is no pagination: the FAQ set is a few
 * dozen rows and the board needs every group at once for drag-and-drop. The
 * filters narrow which rows are shown but the group totals always describe
 * the whole group, so "Shipping (2 of 5 shown)" stays honest.
 */

const ORDER: Prisma.FaqOrderByWithRelationInput[] = [{ position: "asc" }, { createdAt: "asc" }];

export function buildFaqWhere(filters: FaqListFilters): Prisma.FaqWhereInput {
  const clauses: Prisma.FaqWhereInput[] = [];
  if (filters.group) clauses.push({ group: filters.group });
  if (filters.enabled !== undefined) clauses.push({ enabled: filters.enabled });
  if (filters.featured !== undefined) clauses.push({ isFeatured: filters.featured });
  if (filters.q) {
    clauses.push({
      OR: [
        { question: { contains: filters.q, mode: "insensitive" } },
        { answer: { contains: filters.q, mode: "insensitive" } },
        { group: { contains: filters.q, mode: "insensitive" } },
      ],
    });
  }
  return clauses.length > 0 ? { AND: clauses } : {};
}

/** Every group in storefront order with total / enabled counts. */
export async function listFaqGroupSummaries(): Promise<FaqGroupSummary[]> {
  const rows = await db.faq.findMany({ orderBy: ORDER, select: { group: true, enabled: true } });
  const groups = new Map<string, FaqGroupSummary>();
  for (const row of rows) {
    const name = normalizeGroupName(row.group);
    const entry = groups.get(name) ?? { group: name, count: 0, enabled: 0 };
    entry.count += 1;
    if (row.enabled) entry.enabled += 1;
    groups.set(name, entry);
  }
  return [...groups.values()];
}

export async function getFaqBoard(filters: FaqListFilters): Promise<FaqBoardData> {
  const [rows, allGroups] = await Promise.all([db.faq.findMany({ where: buildFaqWhere(filters), orderBy: ORDER }), listFaqGroupSummaries()]);
  const byGroup = new Map<string, FaqRow[]>();
  for (const row of rows) {
    const name = normalizeGroupName(row.group);
    const list = byGroup.get(name) ?? [];
    list.push(row);
    byGroup.set(name, list);
  }
  const groups: FaqGroupView[] = allGroups
    .filter((summary) => byGroup.has(summary.group))
    .map((summary) => ({ group: summary.group, items: byGroup.get(summary.group) ?? [], total: summary.count, enabled: summary.enabled }));
  return { groups, allGroups, total: allGroups.reduce((sum, group) => sum + group.count, 0), shown: rows.length };
}

export async function getFaq(id: string): Promise<FaqRow | null> {
  return db.faq.findUnique({ where: { id } });
}

export const FAQ_EXPORT_COLUMNS = [
  { key: "group", label: "Group" },
  { key: "position", label: "Position", type: "number" },
  { key: "question", label: "Question" },
  { key: "answer", label: "Answer (HTML)" },
  { key: "enabled", label: "Enabled", type: "boolean" },
  { key: "isFeatured", label: "Featured", type: "boolean" },
  { key: "updatedAt", label: "Updated", type: "date" },
] as const;

export async function faqExportRows(filters: FaqListFilters): Promise<Array<Record<string, unknown>>> {
  const rows = await db.faq.findMany({ where: buildFaqWhere(filters), orderBy: ORDER, take: 5000 });
  return rows.map((row) => ({
    group: row.group,
    position: row.position,
    question: row.question,
    answer: row.answer,
    enabled: row.enabled,
    isFeatured: row.isFeatured,
    updatedAt: row.updatedAt,
  }));
}
