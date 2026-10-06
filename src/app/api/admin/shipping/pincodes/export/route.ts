import { withAdminApi } from "@/lib/api/admin";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { exportRows, paginateAll, parseExportFormat, type ExportColumn } from "@/lib/export";

import { pincodeCsvTemplate } from "@/features/shipping/csv";
import { buildPincodeWhere } from "@/features/shipping/queries";
import { parsePincodeListFilters } from "@/features/shipping/schemas";

/**
 * GET /api/admin/shipping/pincodes/export?format=csv|xlsx|print&q&zone&serviceable&cod   (shipping.view)
 *     Streams the filtered pincode table 5,000 rows at a time (§11.28); audited with the filter and row count (D13).
 * GET /api/admin/shipping/pincodes/export?template=1
 *     The import template - same columns the importer reads, so an export re-imports unchanged.
 */
const COLUMNS: readonly ExportColumn[] = [
  { key: "pincode", label: "pincode" },
  { key: "city", label: "city" },
  { key: "state", label: "state" },
  { key: "zone", label: "zone" },
  { key: "serviceable", label: "serviceable", type: "boolean" },
  { key: "cod", label: "cod", type: "boolean" },
  { key: "estimatedDays", label: "estimatedDays", type: "number" },
  { key: "updatedAt", label: "updatedAt", type: "date" },
];

export const GET = withAdminApi(
  async ({ req, actor, ip, searchParams }) => {
    if (searchParams.get("template")) {
      return new Response(pincodeCsvTemplate(), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="pincodes-template.csv"',
          "Cache-Control": "no-store",
        },
      });
    }

    const format = parseExportFormat(searchParams.get("format"));
    const filters = parsePincodeListFilters(searchParams);
    const where = buildPincodeWhere(filters);

    const rows = paginateAll(
      (skip, take) =>
        db.pincodeServiceability.findMany({
          where,
          orderBy: { pincode: "asc" },
          skip,
          take,
          include: { zone: { select: { name: true } } },
        }),
      {
        map: (row) => ({
          pincode: row.pincode,
          city: row.city,
          state: row.state,
          zone: row.zone?.name ?? null,
          serviceable: row.isServiceable,
          cod: row.codAvailable,
          estimatedDays: row.estimatedDays,
          updatedAt: row.updatedAt,
        }),
      },
    );

    return exportRows({
      format,
      filename: "pincodes",
      title: "Pincode serviceability",
      columns: COLUMNS,
      rows,
      onComplete: (rowCount) =>
        writeAudit({
          actor,
          action: "pincode.export",
          entityType: "PincodeServiceability",
          summary: `Exported ${rowCount} pincodes as ${format.toUpperCase()}.`,
          diff: { format, filters: { ...filters }, rowCount },
          ip,
          userAgent: req.headers.get("user-agent"),
        }),
    });
  },
  { permission: "shipping.view" },
);
