import "server-only";

import { db } from "@/lib/db";

/**
 * Reference lists the product screens need alongside the main query: the
 * indented category tree, the attribute catalogue for bulk/filter dialogs and
 * the seller chip. Split from queries.ts for file length only.
 */

export type CategoryOption = {
  id: string;
  name: string;
  slug: string;
  path: string;
  depth: number;
  parentId: string | null;
  isActive: boolean;
  /** "Parent / Child" for table cells. */
  namePath: string;
};

/** Every category in tree order (path sort), with the display path pre-joined. */
export async function getCategoryOptions(): Promise<CategoryOption[]> {
  const rows = await db.category.findMany({
    orderBy: [{ path: "asc" }],
    select: { id: true, name: true, slug: true, path: true, depth: true, parentId: true, isActive: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const namePath = (id: string): string => {
    const names: string[] = [];
    let current = byId.get(id);
    while (current) {
      names.unshift(current.name);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return names.join(" / ");
  };
  return rows
    .map((row) => ({ ...row, namePath: namePath(row.id) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export type AttributeCatalogEntry = {
  id: string;
  code: string;
  name: string;
  inputType: string;
  unit: string | null;
  values: Array<{ id: string; value: string; label: string; colorHex: string | null }>;
};

/** All active attributes with their values, for the bulk SET_ATTRIBUTE dialog and filter chips. */
export async function getAttributeCatalog(): Promise<AttributeCatalogEntry[]> {
  const rows = await db.attribute.findMany({
    where: { isActive: true },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      inputType: true,
      unit: true,
      values: { where: { isActive: true }, orderBy: { position: "asc" }, select: { id: true, value: true, label: true, colorHex: true } },
    },
  });
  return rows.map((row) => ({
    ...row,
    values: row.values.map((value) => ({ ...value, label: value.label ?? value.value })),
  }));
}

export async function getSellerRef(id: string): Promise<{ id: string; title: string; subtitle?: string } | null> {
  const seller = await db.seller.findUnique({ where: { id }, select: { id: true, displayName: true, status: true } });
  return seller ? { id: seller.id, title: seller.displayName, subtitle: seller.status } : null;
}

