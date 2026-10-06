import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";

import { importPincodes } from "@/features/shipping/pincode-import";
import { pincodeImportSchema } from "@/features/shipping/schemas";

/**
 * POST /api/admin/shipping/pincodes/import?dryRun=1   (shipping.manage)
 * Body `{ csv: string }` (the file's text, ≤ 6 MB / 50,000 rows).
 * → `{ data: PincodeImportReport }`. With `dryRun` nothing is written; the
 * report says what would be created, updated and rejected (first 100 row
 * errors). Without it, rows are applied in batches of 1,000 and the import is
 * audited with its counts.
 *
 * Rate-limited per actor: a 50k-row import is real work for the database.
 */
export const POST = withAdminApi(
  async ({ req, actor, ip, searchParams }) => {
    const { csv } = await parseJsonBody(req, pincodeImportSchema);
    const dryRun = ["1", "true", "yes"].includes((searchParams.get("dryRun") ?? "").toLowerCase());
    const report = await importPincodes({ csv, dryRun, actor, ip, userAgent: req.headers.get("user-agent") });
    return apiOk(report);
  },
  { permission: "shipping.manage", rateLimit: { limit: 30, windowMs: 60_000, keyBy: "actor" } },
);
