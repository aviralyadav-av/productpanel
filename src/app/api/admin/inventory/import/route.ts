import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { badRequest, validationError } from "@/lib/api/errors";
import { applyStockImport, prepareStockImport } from "@/features/inventory/import";
import { importJsonBodySchema } from "@/features/inventory/schemas";

/**
 * POST /api/admin/inventory/import[?dryRun=1]   (inventory.adjust)
 *
 * Body: multipart/form-data with `file` (CSV: sku, mode, quantity, reason,
 * note[, type]) or JSON `{ rows: [{ sku, mode, quantity, reason?, note?, type? }] }`.
 * ≤ 2000 rows.
 *
 * `dryRun=1` validates and previews every row and writes nothing. Without
 * it, the same rows are applied in one transaction (all-or-nothing; a 422
 * lists what to fix, a 409 names the line that would go negative).
 */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

async function readRows(req: Request): Promise<string | Array<Record<string, unknown>>> {
  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.startsWith("application/json")) {
    const body = await parseJsonBody(req, importJsonBodySchema);
    return body.rows;
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest("Send the CSV as multipart/form-data under `file`, or JSON rows.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw validationError({ file: "Attach a CSV file." }, "Attach a CSV file.");
  if (file.size > MAX_FILE_BYTES) {
    throw validationError({ file: "The file is larger than 2 MB." }, "The file is larger than 2 MB.");
  }
  return file.text();
}

export const POST = withAdminApi(
  async ({ req, actor, searchParams }) => {
    const dryRun = searchParams.get("dryRun") === "1" || searchParams.get("dryRun") === "true";
    const rows = await readRows(req);
    const report = dryRun ? await prepareStockImport(rows) : await applyStockImport(actor, rows);
    return apiOk(report);
  },
  { permission: "inventory.adjust", rateLimit: { limit: 20, windowMs: 60_000 } },
);
