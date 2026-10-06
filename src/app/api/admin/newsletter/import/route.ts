import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { badRequest } from "@/lib/api/errors";

import { MAX_IMPORT_CSV_BYTES, importSubscribersSchema } from "@/features/newsletter/schemas";
import { applySubscriberImport, previewSubscriberImport } from "@/features/newsletter/service";

/**
 * POST /api/admin/newsletter/import  (newsletter.manage)
 *  - JSON { csv, source?, apply? }
 *  - or multipart/form-data with `file` (a .csv) and optional `source`, `apply`
 * `?dryRun=1` (or apply=false, the default) reports what would happen without
 * writing; applying runs in one transaction and is audited (D13).
 */
export const POST = withAdminApi(
  async ({ req, actor, ip, searchParams }) => {
    const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
    let values;

    if (contentType.startsWith("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw badRequest("Attach the CSV as the `file` field.", { file: "Missing." });
      if (file.size > MAX_IMPORT_CSV_BYTES) throw badRequest("The file must be 2 MB or smaller.", { file: "Too large." });
      values = importSubscribersSchema.parse({
        csv: await file.text(),
        source: form.get("source")?.toString() || undefined,
        apply: form.get("apply")?.toString() === "true" || form.get("apply")?.toString() === "1",
      });
    } else {
      values = await parseJsonBody(req, importSubscribersSchema);
    }

    const dryRun = searchParams.get("dryRun") === "1" || !values.apply;
    const report = dryRun ? await previewSubscriberImport({ ...values, apply: false }) : await applySubscriberImport(values, actor, { ip });
    return apiOk(report);
  },
  { permission: "newsletter.manage", rateLimit: { limit: 30, windowMs: 60 * 1000, keyBy: "actor" } },
);
