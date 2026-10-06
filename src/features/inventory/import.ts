import { db } from "@/lib/db";
import { diffOf, writeAudit, type AuditActor } from "@/lib/audit";
import { conflict, validationError } from "@/lib/api/errors";
import { invalidatePublic, listTagsFor } from "@/lib/cache-tags";
import type { StockState } from "@/lib/enums";
import { MAX_IMPORT_ROWS, parseImportCsv, type RawImportRow } from "./csv";
import { importRowSchema, type AdjustableStockMovementType, type ImportRowValues } from "./schemas";
import { InventoryError, afterStockChange, applyStockAdjustment, type StockChange } from "./service";
import { previewAdjustment, type AdjustMode } from "./stock-math";
import { toApiError } from "./mutations";

/**
 * CSV bulk stock update (blueprint §1 Inventory "bulk update (CSV)", §11.33).
 *
 * Two passes over the same file: a DRY RUN that resolves every SKU, validates
 * every row and previews the resulting balances without writing anything,
 * and an APPLY that runs the identical rows through applyStockAdjustment in
 * ONE transaction. The preview is what the operator approves; the apply
 * re-derives every "set" delta under the row lock, so the numbers can differ
 * only if stock moved between the two clicks - and then the ledger, not the
 * preview, is right.
 *
 * All-or-nothing: a file with one bad row applies nothing. Fixing one line and
 * re-uploading is cheap; working out which 1,400 of 2,000 rows landed is not.
 */

export type ImportRowReport = {
  line: number;
  sku: string;
  mode: AdjustMode | null;
  quantity: number | null;
  type: AdjustableStockMovementType | null;
  reason: string | null;
  note: string | null;
  status: "ok" | "error";
  message: string | null;
  variant: {
    variantId: string;
    label: string;
    productId: string;
    onHand: number;
    reserved: number;
    allowBackorder: boolean;
  } | null;
  /** Preview against the balances read now (dry run) or the written result (apply). */
  delta: number | null;
  nextOnHand: number | null;
  nextAvailable: number | null;
  nextState: StockState | null;
};

export type ImportReport = {
  dryRun: boolean;
  rows: ImportRowReport[];
  total: number;
  valid: number;
  invalid: number;
  /** Rows that would move nothing (a "set" to the current count). */
  noop: number;
  /** File-level errors (missing columns, too many rows). */
  fileErrors: string[];
  /** Filled after an apply. */
  applied: { moved: number; unchanged: number } | null;
};

/** Default the movement type by intent: a count is a correction, everything else an adjustment. */
function defaultType(mode: AdjustMode): AdjustableStockMovementType {
  return mode === "set" ? "CORRECTION" : "ADJUSTMENT";
}

function firstIssue(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid row.";
  const field = issue.path.map(String).join(".");
  return field ? `${field}: ${issue.message}` : issue.message;
}

/** Text rows from a CSV or object rows from a JSON body → the same raw shape. */
export function normaliseRows(input: string | ReadonlyArray<Record<string, unknown>>): {
  rows: RawImportRow[];
  fileErrors: string[];
} {
  if (typeof input === "string") {
    const parsed = parseImportCsv(input);
    return { rows: parsed.rows, fileErrors: parsed.errors };
  }
  if (input.length > MAX_IMPORT_ROWS) {
    return { rows: [], fileErrors: [`Too many rows: ${input.length}. Send at most ${MAX_IMPORT_ROWS}.`] };
  }
  const text = (value: unknown) => (value === null || value === undefined ? "" : String(value));
  return {
    fileErrors: [],
    rows: input.map((row, index) => ({
      line: index + 1,
      sku: text(row.sku),
      mode: text(row.mode),
      quantity: text(row.quantity),
      reason: text(row.reason),
      note: text(row.note),
      type: text(row.type),
    })),
  };
}

type ResolvedVariant = NonNullable<ImportRowReport["variant"]> & { lowStockThreshold: number };

async function resolveSkus(skus: readonly string[]): Promise<Map<string, ResolvedVariant>> {
  if (skus.length === 0) return new Map();
  const rows = await db.productVariant.findMany({
    where: { sku: { in: [...skus] }, deletedAt: null },
    take: skus.length,
    select: {
      id: true,
      sku: true,
      name: true,
      product: { select: { id: true, title: true } },
      inventory: { select: { onHand: true, reserved: true, allowBackorder: true, lowStockThreshold: true } },
    },
  });
  const map = new Map<string, ResolvedVariant>();
  for (const row of rows) {
    if (!row.sku) continue;
    map.set(row.sku, {
      variantId: row.id,
      productId: row.product.id,
      label: row.name && row.name !== "Default" ? `${row.product.title} · ${row.name}` : row.product.title,
      onHand: row.inventory?.onHand ?? 0,
      reserved: row.inventory?.reserved ?? 0,
      allowBackorder: row.inventory?.allowBackorder ?? false,
      lowStockThreshold: row.inventory?.lowStockThreshold ?? 0,
    });
  }
  return map;
}

/**
 * Validate and preview. SKUs are matched exactly (they are unique, A9); a SKU
 * that appears twice is rejected because the second row's preview would be
 * computed against a balance the first row is about to change.
 */
export async function prepareStockImport(
  input: string | ReadonlyArray<Record<string, unknown>>,
): Promise<ImportReport> {
  const { rows: raw, fileErrors } = normaliseRows(input);
  if (fileErrors.length > 0) {
    return { dryRun: true, rows: [], total: 0, valid: 0, invalid: 0, noop: 0, fileErrors, applied: null };
  }

  const parsed = raw.map((row) => ({ raw: row, result: importRowSchema.safeParse(row) }));
  const skus = [...new Set(parsed.flatMap((row) => (row.result.success ? [row.result.data.sku] : [])))];
  const variants = await resolveSkus(skus);

  const seen = new Map<string, number>();
  const reports: ImportRowReport[] = parsed.map(({ raw: line, result }) => {
    const base: ImportRowReport = {
      line: line.line,
      sku: line.sku,
      mode: null,
      quantity: null,
      type: null,
      reason: line.reason || null,
      note: line.note || null,
      status: "error",
      message: null,
      variant: null,
      delta: null,
      nextOnHand: null,
      nextAvailable: null,
      nextState: null,
    };
    if (!result.success) return { ...base, message: firstIssue(result.error) };

    const values: ImportRowValues = result.data;
    const type = values.type ?? defaultType(values.mode);
    const filled = { ...base, mode: values.mode, quantity: values.quantity, type, reason: values.reason ?? null, note: values.note ?? null };

    const variant = variants.get(values.sku);
    if (!variant) return { ...filled, message: `No variant has SKU "${values.sku}".` };

    const { lowStockThreshold, ...publicVariant } = variant;
    const earlier = seen.get(values.sku);
    if (earlier !== undefined) {
      return { ...filled, variant: publicVariant, message: `SKU "${values.sku}" already appears on line ${earlier}.` };
    }
    seen.set(values.sku, line.line);

    const preview = previewAdjustment({
      mode: values.mode,
      quantity: values.quantity,
      onHand: variant.onHand,
      reserved: variant.reserved,
      lowStockThreshold,
      allowBackorder: variant.allowBackorder,
    });

    return {
      ...filled,
      variant: publicVariant,
      delta: preview.delta,
      nextOnHand: preview.nextOnHand,
      nextAvailable: preview.nextAvailable,
      nextState: preview.nextState,
      status: preview.blocked ? "error" : "ok",
      message: preview.blocked
        ? `Would take stock to ${preview.nextAvailable} available and the variant does not allow backorders.`
        : preview.noop
          ? "Already at this count; nothing will move."
          : null,
    };
  });

  const valid = reports.filter((row) => row.status === "ok").length;
  return {
    dryRun: true,
    rows: reports,
    total: reports.length,
    valid,
    invalid: reports.length - valid,
    noop: reports.filter((row) => row.status === "ok" && row.delta === 0).length,
    fileErrors: [],
    applied: null,
  };
}

/** Enough for 2,000 rows × (lock + movement + projection) on a modest database. */
const IMPORT_TRANSACTION_TIMEOUT_MS = 120_000;

/**
 * Apply a file. Runs the same preparation first so the REST client cannot
 * skip validation by calling apply directly; refuses if any row is invalid.
 */
export async function applyStockImport(
  actor: AuditActor,
  input: string | ReadonlyArray<Record<string, unknown>>,
): Promise<ImportReport> {
  const report = await prepareStockImport(input);
  if (report.fileErrors.length > 0) {
    throw validationError({ file: report.fileErrors.join(" ") }, report.fileErrors[0]);
  }
  if (report.total === 0) throw validationError({ file: "The file has no data rows." }, "The file has no data rows.");
  if (report.invalid > 0) {
    throw validationError(
      { file: `${report.invalid} row${report.invalid === 1 ? "" : "s"} failed validation.` },
      `${report.invalid} of ${report.total} rows are invalid. Fix them and upload again; nothing was applied.`,
    );
  }

  const byLine = new Map(report.rows.map((row) => [row.line, row] as const));
  let currentLine: number | undefined;
  let changes: StockChange[];
  let results: Array<{ line: number; delta: number; moved: boolean; onHand: number; available: number; state: StockState }>;
  try {
    const out = await db.$transaction(
      async (tx) => {
        const applied: typeof results = [];
        const moved: StockChange[] = [];
        for (const row of report.rows) {
          currentLine = row.line;
          const result = await applyStockAdjustment(tx, {
            variantId: row.variant!.variantId,
            mode: row.mode!,
            quantity: row.quantity!,
            type: row.type!,
            reason: row.reason ?? `CSV import line ${row.line}`,
            note: row.note,
            actorId: actor.id,
          });
          if (result.change) moved.push(result.change);
          applied.push({
            line: row.line,
            delta: result.delta,
            moved: result.moved,
            onHand: result.after.onHand,
            available: result.after.available,
            state: result.after.stockState,
          });
        }
        return { applied, moved };
      },
      { timeout: IMPORT_TRANSACTION_TIMEOUT_MS },
    );
    changes = out.moved;
    results = out.applied;
  } catch (error) {
    if (error instanceof InventoryError) {
      const row = currentLine === undefined ? undefined : byLine.get(currentLine);
      const api = toApiError(error, row?.variant?.label);
      throw conflict(`Line ${currentLine ?? "?"}: ${api.message} Nothing was applied.`, api.details);
    }
    throw error;
  }

  for (const change of changes) await afterStockChange(change.variantId, change);
  if (changes.length > 0) await invalidatePublic(listTagsFor("inventory"));

  await writeAudit({
    actor,
    action: "inventory.import",
    entityType: "InventoryItem",
    entityId: null,
    summary: `CSV stock import: ${report.total} rows, ${changes.length} moved`,
    diff: diffOf(null, {
      rowCount: report.total,
      moved: changes.length,
      lines: results.map((row) => ({ line: row.line, delta: row.delta })),
    }),
  });

  const byResult = new Map(results.map((row) => [row.line, row] as const));
  return {
    ...report,
    dryRun: false,
    rows: report.rows.map((row) => {
      const result = byResult.get(row.line);
      return result
        ? { ...row, delta: result.delta, nextOnHand: result.onHand, nextAvailable: result.available, nextState: result.state }
        : row;
    }),
    applied: { moved: changes.length, unchanged: report.total - changes.length },
  };
}
