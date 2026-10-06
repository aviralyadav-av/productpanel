import { db } from "@/lib/db";
import { badRequest, notFound } from "@/lib/api/errors";
import { writeAudit } from "@/lib/audit";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";
import { slugify } from "@/lib/validation";
import { isSelectType, resolveCategoryAttributes, type EffectiveAttribute } from "@/features/catalog/attribute-resolution";
import { recomputeProductFacets } from "@/features/catalog/facets";

import { PRODUCT_ENTITY, upsertAttributeValues, type Db } from "./internal";
import { parseCsv, splitMulti, toCsv } from "./csv";
import type { AttributeValueInput } from "./schemas";
import type { ProductActor } from "./service";

/**
 * Attribute CSV import/export (blueprint §14.A7).
 *
 * The file has one row per product in the category (descendants included)
 * and one column per effective attribute CODE - the same set the editor shows,
 * so a value that cannot be typed in the form cannot be imported either.
 * Select cells hold AttributeValue.value(s) joined by "|"; scalar cells hold
 * the text/number/yes-no. A blank cell leaves the product's value alone
 * (the export is also the template, and operators fill in what they know).
 *
 * Import is two-phase: `previewAttributeImport` reports every problem and the
 * unknown values the file introduces; `applyAttributeImport` writes only when
 * the report has no errors, creating unknown values solely when the operator
 * ticked `createValues`.
 */

export const FIXED_COLUMNS = ["product_id", "slug", "title"] as const;

type ProductRow = {
  id: string;
  slug: string;
  title: string;
  attributeValues: Array<{
    attributeId: string;
    valueId: string | null;
    textValue: string | null;
    numberValue: number | null;
    boolValue: boolean | null;
    value: { value: string } | null;
  }>;
};

async function categoryScope(tx: Db | undefined, categoryId: string) {
  const client = tx ?? db;
  const category = await client.category.findUnique({ where: { id: categoryId }, select: { id: true, name: true, path: true } });
  if (!category) throw notFound("Category");
  const effective = (await resolveCategoryAttributes(categoryId, tx)).filter((entry) => entry.attribute.isActive);
  const where = {
    deletedAt: null,
    OR: [{ categoryId }, { categoryPath: category.path }, { categoryPath: { startsWith: `${category.path}/` } }],
  };
  return { category, effective, where };
}

function cellFor(entry: EffectiveAttribute, rows: ProductRow["attributeValues"]): string {
  const mine = rows.filter((row) => row.attributeId === entry.attribute.id);
  if (isSelectType(entry.attribute.inputType)) {
    return mine.map((row) => row.value?.value).filter((value): value is string => Boolean(value)).join("|");
  }
  const scalar = mine[0];
  if (!scalar) return "";
  if (entry.attribute.inputType === "NUMBER") return scalar.numberValue === null ? "" : String(scalar.numberValue);
  if (entry.attribute.inputType === "BOOLEAN") return scalar.boolValue === null ? "" : scalar.boolValue ? "yes" : "no";
  return scalar.textValue ?? "";
}

export type AttributeCsvExport = { filename: string; csv: string; rowCount: number; columns: string[] };

export async function buildAttributeCsv(categoryId: string): Promise<AttributeCsvExport> {
  const { category, effective, where } = await categoryScope(undefined, categoryId);
  const products: ProductRow[] = await db.product.findMany({
    where,
    orderBy: [{ title: "asc" }, { id: "asc" }],
    take: 5_000,
    select: {
      id: true,
      slug: true,
      title: true,
      attributeValues: {
        select: { attributeId: true, valueId: true, textValue: true, numberValue: true, boolValue: true, value: { select: { value: true } } },
      },
    },
  });
  const columns = [...FIXED_COLUMNS, ...effective.map((entry) => entry.attribute.code)];
  const rows = products.map((product) => [product.id, product.slug, product.title, ...effective.map((entry) => cellFor(entry, product.attributeValues))]);
  return {
    filename: `attributes-${slugify(category.name) || "category"}.csv`,
    csv: toCsv([columns, ...rows]),
    rowCount: rows.length,
    columns,
  };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export type ImportRowReport = {
  line: number;
  productId: string | null;
  title: string | null;
  /** Attribute code → new cell value, only for cells that will change something. */
  changes: Array<{ code: string; value: string }>;
  errors: string[];
};

export type ImportReport = {
  categoryId: string;
  categoryName: string;
  columns: string[];
  ignoredColumns: string[];
  rows: ImportRowReport[];
  /** Select values the file uses that do not exist yet, per attribute code. */
  unknownValues: Array<{ code: string; attributeId: string; value: string }>;
  errorCount: number;
  changeCount: number;
  applied: boolean;
  createdValues: number;
};

type Plan = {
  report: ImportReport;
  writes: Array<{ productId: string; values: AttributeValueInput[]; newValues: Array<{ attributeId: string; value: string }> }>;
};

async function planImport(tx: Db | undefined, input: { categoryId: string; csv: string; createValues: boolean }): Promise<Plan> {
  const { category, effective, where } = await categoryScope(tx, input.categoryId);
  const client = tx ?? db;
  const table = parseCsv(input.csv);
  if (table.length < 2) throw badRequest("The CSV needs a header row and at least one product row.");

  const header = table[0].map((cell) => cell.trim());
  const idIndex = header.indexOf("product_id");
  const slugIndex = header.indexOf("slug");
  if (idIndex === -1 && slugIndex === -1) throw badRequest("The CSV must have a product_id or slug column.");

  const byCode = new Map(effective.map((entry) => [entry.attribute.code, entry]));
  const attributeColumns = header
    .map((code, index) => ({ code, index, entry: byCode.get(code) }))
    .filter((column) => column.index >= FIXED_COLUMNS.length || !(FIXED_COLUMNS as readonly string[]).includes(column.code))
    .filter((column): column is { code: string; index: number; entry: EffectiveAttribute } => column.entry !== undefined);
  const ignoredColumns = header.filter((code) => !(FIXED_COLUMNS as readonly string[]).includes(code) && !byCode.has(code));

  const products = await client.product.findMany({ where, select: { id: true, slug: true, title: true } });
  const byId = new Map(products.map((product) => [product.id, product]));
  const bySlug = new Map(products.map((product) => [product.slug, product]));

  const unknownValues = new Map<string, { code: string; attributeId: string; value: string }>();
  const rows: ImportRowReport[] = [];
  const writes: Plan["writes"] = [];
  const seenProducts = new Set<string>();

  for (const [offset, cells] of table.slice(1).entries()) {
    const line = offset + 2;
    const id = idIndex >= 0 ? cells[idIndex]?.trim() : "";
    const slug = slugIndex >= 0 ? cells[slugIndex]?.trim() : "";
    const product = (id && byId.get(id)) || (slug && bySlug.get(slug)) || null;
    const report: ImportRowReport = { line, productId: product?.id ?? null, title: product?.title ?? null, changes: [], errors: [] };

    if (!product) {
      report.errors.push(`Line ${line}: no product in ${category.name} matches ${id || slug || "(blank id)"}.`);
      rows.push(report);
      continue;
    }
    if (seenProducts.has(product.id)) {
      report.errors.push(`Line ${line}: ${product.title} appears more than once.`);
      rows.push(report);
      continue;
    }
    seenProducts.add(product.id);

    const values: AttributeValueInput[] = [];
    const newValues: Array<{ attributeId: string; value: string }> = [];

    for (const column of attributeColumns) {
      const raw = (cells[column.index] ?? "").trim();
      if (!raw) continue;
      const attribute = column.entry.attribute;

      if (isSelectType(attribute.inputType)) {
        const parts = attribute.inputType === "MULTI_SELECT" ? splitMulti(raw) : [splitMulti(raw)[0]].filter(Boolean);
        const known = new Map(column.entry.values.map((value) => [value.value.toLowerCase(), value]));
        const valueIds: string[] = [];
        for (const part of parts) {
          const match = known.get(part.toLowerCase()) ?? column.entry.values.find((value) => (value.label ?? "").toLowerCase() === part.toLowerCase());
          if (match) {
            valueIds.push(match.id);
            continue;
          }
          const key = `${attribute.id}:${part.toLowerCase()}`;
          if (!unknownValues.has(key)) unknownValues.set(key, { code: attribute.code, attributeId: attribute.id, value: part });
          if (input.createValues) {
            newValues.push({ attributeId: attribute.id, value: part });
          } else {
            report.errors.push(`Line ${line}: "${part}" is not a value of ${attribute.name}.`);
          }
        }
        if (valueIds.length > 0 || newValues.some((item) => item.attributeId === attribute.id)) {
          values.push({ attributeId: attribute.id, valueIds });
          report.changes.push({ code: attribute.code, value: parts.join("|") });
        }
        continue;
      }

      if (attribute.inputType === "NUMBER") {
        const number = Number(raw.replace(/,/g, ""));
        if (!Number.isFinite(number)) {
          report.errors.push(`Line ${line}: ${attribute.name} must be a number, got "${raw}".`);
          continue;
        }
        values.push({ attributeId: attribute.id, numberValue: number });
        report.changes.push({ code: attribute.code, value: String(number) });
        continue;
      }
      if (attribute.inputType === "BOOLEAN") {
        const lower = raw.toLowerCase();
        const bool = ["yes", "true", "1", "y"].includes(lower) ? true : ["no", "false", "0", "n"].includes(lower) ? false : null;
        if (bool === null) {
          report.errors.push(`Line ${line}: ${attribute.name} must be yes or no, got "${raw}".`);
          continue;
        }
        values.push({ attributeId: attribute.id, boolValue: bool });
        report.changes.push({ code: attribute.code, value: bool ? "yes" : "no" });
        continue;
      }
      values.push({ attributeId: attribute.id, textValue: raw.slice(0, 500) });
      report.changes.push({ code: attribute.code, value: raw.slice(0, 500) });
    }

    rows.push(report);
    if (report.errors.length === 0 && values.length > 0) writes.push({ productId: product.id, values, newValues });
  }

  const errorCount = rows.reduce((sum, row) => sum + row.errors.length, 0);
  return {
    report: {
      categoryId: category.id,
      categoryName: category.name,
      columns: attributeColumns.map((column) => column.code),
      ignoredColumns,
      rows,
      unknownValues: [...unknownValues.values()],
      errorCount,
      changeCount: rows.reduce((sum, row) => sum + row.changes.length, 0),
      applied: false,
      createdValues: 0,
    },
    writes,
  };
}

export async function previewAttributeImport(input: { categoryId: string; csv: string; createValues: boolean }): Promise<ImportReport> {
  return (await planImport(undefined, input)).report;
}

export async function applyAttributeImport(
  input: { categoryId: string; csv: string; createValues: boolean },
  actor: ProductActor,
  meta: { ip?: string | null } = {},
): Promise<ImportReport> {
  const result = await db.$transaction(
    async (tx) => {
      const { report, writes } = await planImport(tx, input);
      if (report.errorCount > 0) return report;

      // Create the unknown values first so the per-product writes can reference them.
      let createdValues = 0;
      const createdIds = new Map<string, string>();
      if (input.createValues) {
        for (const item of report.unknownValues) {
          const existing = await tx.attributeValue.findUnique({
            where: { attributeId_value: { attributeId: item.attributeId, value: item.value } },
            select: { id: true },
          });
          if (existing) {
            createdIds.set(`${item.attributeId}:${item.value.toLowerCase()}`, existing.id);
            continue;
          }
          const position = await tx.attributeValue.count({ where: { attributeId: item.attributeId } });
          const created = await tx.attributeValue.create({
            data: { attributeId: item.attributeId, value: item.value, label: item.value, position },
            select: { id: true },
          });
          createdIds.set(`${item.attributeId}:${item.value.toLowerCase()}`, created.id);
          createdValues += 1;
        }
      }

      for (const write of writes) {
        const values = write.values.map((value) => {
          const extra = write.newValues
            .filter((item) => item.attributeId === value.attributeId)
            .map((item) => createdIds.get(`${item.attributeId}:${item.value.toLowerCase()}`))
            .filter((id): id is string => Boolean(id));
          return extra.length > 0 ? { ...value, valueIds: [...(value.valueIds ?? []), ...extra] } : value;
        });
        await upsertAttributeValues(tx, write.productId, values, { replace: false });
        await recomputeProductFacets(tx, write.productId);
      }

      await writeAudit(tx, {
        actor,
        action: "product.attributes_import",
        entityType: PRODUCT_ENTITY,
        entityId: null,
        entityLabel: report.categoryName,
        summary: `Imported attribute values for ${writes.length} product(s) in ${report.categoryName}; ${createdValues} new value(s).`,
        diff: { categoryId: input.categoryId, products: writes.length, changes: report.changeCount, createdValues },
        ip: meta.ip,
      });
      return { ...report, applied: true, createdValues };
    },
    { timeout: 120_000 },
  );

  if (result.applied) await invalidatePublic(listTagsFor("attributeValue"));
  return result;
}
