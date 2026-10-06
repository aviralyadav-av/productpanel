import "server-only";

import { writeAudit, type AuditActor } from "@/lib/audit";
import { exportRows, paginateAll, type ExportColumn, type ExportFormat } from "@/lib/export";
import { getSettingString } from "@/lib/settings";

import { pageSubscribersForExport } from "./queries";
import type { NewsletterFilters, NewsletterSort } from "./schemas";
import type { SubscriberRow } from "./types";

/**
 * Subscriber export (blueprint D13: every export is audited with the filter
 * and the row count). Streamed page by page so a 50k-row list never sits in
 * memory, and gated on `newsletter.export` by the caller - reading the list is
 * a smaller privilege than walking off with it.
 */
export const NEWSLETTER_EXPORT_COLUMNS: readonly ExportColumn[] = [
  { key: "email", label: "Email" },
  { key: "name", label: "Name" },
  { key: "status", label: "Status" },
  { key: "source", label: "Source" },
  { key: "subscribedAt", label: "Subscribed", type: "date" },
  { key: "unsubscribedAt", label: "Unsubscribed", type: "date" },
];

export async function exportSubscribers(input: {
  format: ExportFormat;
  filters: NewsletterFilters;
  sort: NewsletterSort;
  order: "asc" | "desc";
  actor: AuditActor;
  ip?: string | null;
}): Promise<Response> {
  const storeName = await getSettingString("store.name").catch(() => "DIY Baazar");
  const stamp = new Date().toISOString().slice(0, 10);

  return exportRows({
    format: input.format,
    filename: `newsletter-subscribers-${stamp}`,
    title: `Newsletter subscribers - ${stamp}`,
    storeName,
    columns: NEWSLETTER_EXPORT_COLUMNS,
    rows: paginateAll<SubscriberRow>(
      (skip, take) => pageSubscribersForExport(input.filters, input.sort, input.order, skip, take),
      { pageSize: 1000 },
    ),
    onComplete: (rowCount) =>
      writeAudit({
        actor: input.actor,
        action: "newsletter.export",
        entityType: "NewsletterSubscriber",
        summary: `Exported ${rowCount} newsletter subscriber(s) as ${input.format.toUpperCase()}.`,
        diff: { format: input.format, rowCount, filters: JSON.parse(JSON.stringify(input.filters)) },
        ip: input.ip,
      }),
  });
}
