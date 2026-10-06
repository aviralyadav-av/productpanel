import { z } from "zod";

import {
  EMAIL_OUTBOX_STATUSES,
  EMAIL_TEMPLATE_KEYS,
  type EmailOutboxStatus,
} from "@/lib/enums";
import { one, type SearchParams } from "@/lib/list-params";
import { textSchema, optionalTextSchema } from "@/lib/validation";

/**
 * Client-safe vocabulary for /admin/email-templates: what the URL may say,
 * what the editor submits, and the view models the components render.
 *
 * Kept out of queries.ts and templates-service.ts so a Client Component can
 * import the zod schema and the row types without dragging Prisma or
 * `sanitize-html` into the browser bundle.
 */

// ---------------------------------------------------------------------------
// URL vocabulary
// ---------------------------------------------------------------------------

export const EMAIL_TABS = ["templates", "outbox"] as const;
export type EmailTab = (typeof EMAIL_TABS)[number];

export function resolveEmailTab(raw: string | undefined): EmailTab {
  return (EMAIL_TABS as readonly string[]).includes(raw ?? "") ? (raw as EmailTab) : "templates";
}

export const TEMPLATE_SORTS = ["key", "name", "subject", "updatedAt", "isActive"] as const;
export type TemplateSort = (typeof TEMPLATE_SORTS)[number];

export function resolveTemplateSort(raw: string | undefined): TemplateSort {
  return (TEMPLATE_SORTS as readonly string[]).includes(raw ?? "") ? (raw as TemplateSort) : "key";
}

export type TemplateFilters = {
  q: string;
  /** `1` = active only, `0` = disabled only. */
  active?: boolean;
};

export function parseTemplateFilters(params: SearchParams): TemplateFilters {
  const active = one(params, "active");
  return {
    q: (one(params, "q") ?? "").trim(),
    active: active === "1" ? true : active === "0" ? false : undefined,
  };
}

export function hasTemplateFilters(filters: TemplateFilters): boolean {
  return Boolean(filters.q || filters.active !== undefined);
}

/** `from`/`to` are IST calendar days (the DateRangePicker writes yyyy-mm-dd). */
export function parseIstDayParam(value: string | undefined, end: boolean): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}+05:30`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export type OutboxFilters = {
  q: string;
  status?: EmailOutboxStatus;
  templateKey?: string;
  entityType?: string;
  entityId?: string;
  from?: Date;
  to?: Date;
};

export function parseOutboxFilters(params: SearchParams): OutboxFilters {
  const status = one(params, "status");
  return {
    q: (one(params, "q") ?? "").trim(),
    status: (EMAIL_OUTBOX_STATUSES as readonly string[]).includes(status ?? "")
      ? (status as EmailOutboxStatus)
      : undefined,
    templateKey: one(params, "templateKey") || undefined,
    entityType: one(params, "entityType") || undefined,
    entityId: one(params, "entityId") || undefined,
    from: parseIstDayParam(one(params, "from"), false),
    to: parseIstDayParam(one(params, "to"), true),
  };
}

export function hasOutboxFilters(filters: OutboxFilters): boolean {
  return Boolean(
    filters.q || filters.status || filters.templateKey || filters.entityType || filters.entityId || filters.from || filters.to,
  );
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export const templateIdSchema = z.string().min(1, "Pick a template.");

/**
 * The editor saves the whole record. `htmlBody` is raw HTML up to 512 KB -
 * an email is a document, and operators paste designed markup - and the
 * SERVICE sanitises it with the `email` profile before it is stored, so a
 * pasted `<script>` never reaches an inbox.
 */
export const templateFormSchema = z.object({
  name: textSchema(120, "Name"),
  subject: textSchema(200, "Subject"),
  htmlBody: z.string().min(1, "The HTML body cannot be empty.").max(512_000, "The HTML body is too large."),
  textBody: optionalTextSchema(64_000),
  isActive: z.boolean(),
});
export type TemplateFormInput = z.input<typeof templateFormSchema>;
export type TemplateFormValues = z.output<typeof templateFormSchema>;

export const setTemplateActiveSchema = z.object({ isActive: z.boolean() });

/** Optional overrides for the sample variables used by a preview / test send. */
export const templateVarsSchema = z.record(z.string(), z.string().max(2000)).optional();

export const previewTemplateSchema = z.object({ vars: templateVarsSchema });
export type PreviewTemplateInput = z.input<typeof previewTemplateSchema>;

export const testSendSchema = z.object({ vars: templateVarsSchema });
export type TestSendInput = z.input<typeof testSendSchema>;

export const outboxIdSchema = z.string().min(1);

export const EMAIL_TEMPLATE_KEY_VALUES: readonly string[] = EMAIL_TEMPLATE_KEYS;

// ---------------------------------------------------------------------------
// Client-safe view models (dates as ISO strings)
// ---------------------------------------------------------------------------

export type TemplateListRow = {
  id: string;
  key: string;
  name: string;
  subject: string;
  isActive: boolean;
  /** Documented `{{variables}}` (event matrix + seeded list). */
  variableCount: number;
  /** Variables used in the bodies that nothing supplies - a live warning. */
  unknownCount: number;
  updatedAt: string;
  updatedByName: string | null;
  /** EmailOutbox rows ever created from this key, and the last one sent. */
  sentCount: number;
  lastSentAt: string | null;
  /** Rows sitting FAILED for this key - the reason to open it. */
  failedCount: number;
};

export type TemplateActivityRow = {
  id: string;
  action: string;
  summary: string;
  actorEmail: string;
  createdAt: string;
};

/** The one change the "Restore previous version" button would put back. */
export type TemplateRestorePoint = {
  auditId: string;
  at: string;
  actorEmail: string;
  /** Field names the restore would revert, for the confirm dialog. */
  fields: string[];
};

export type TemplateEditorData = {
  id: string;
  key: string;
  name: string;
  subject: string;
  htmlBody: string;
  textBody: string | null;
  /** As stored on the row (seeded from the event matrix). */
  variables: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  updatedByName: string | null;
  /** The event that queues this template, when there is one (E3). */
  eventKey: string | null;
  eventDescription: string | null;
  stats: {
    total: number;
    sent: number;
    queued: number;
    failed: number;
    lastSentAt: string | null;
  };
  activity: TemplateActivityRow[];
  restorePoint: TemplateRestorePoint | null;
};

export type OutboxListRow = {
  id: string;
  templateKey: string | null;
  toEmail: string;
  toName: string | null;
  subject: string;
  status: EmailOutboxStatus;
  attempts: number;
  lastError: string | null;
  scheduledAt: string;
  sentAt: string | null;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
};

export type OutboxDetailView = OutboxListRow & {
  htmlBody: string;
  textBody: string | null;
  providerMessageId: string | null;
  dedupeKey: string | null;
};

export type OutboxStatsView = {
  byStatus: Record<EmailOutboxStatus, number>;
  failedLast24h: number;
  oldestDueQueuedAt: string | null;
};

/**
 * What the `email` sanitiser profile (D12) will remove when this body is
 * saved. Approximated with regexes rather than by running sanitize-html,
 * which is server-only - the point is to warn BEFORE the operator loses work,
 * and the exact result is visible in the preview after saving.
 *
 * The inline-style rule is the one that bites: the seeded templates are laid
 * out with `style="..."` (as HTML email must be, since mail clients ignore
 * stylesheets), and the profile strips every style attribute. Saying so here
 * is the difference between "the editor mangled my email" and an informed
 * decision to keep the markup plain.
 */
export function sanitiserWarnings(html: string): string[] {
  const warnings: string[] = [];
  if (/\sstyle\s*=/i.test(html)) {
    warnings.push(
      "Inline style attributes are removed on save. HTML emails rely on them for layout, so saving will flatten this design.",
    );
  }
  if (/<style[\s>]/i.test(html)) warnings.push("A <style> block is removed entirely, including its contents.");
  if (/\sclass\s*=/i.test(html)) warnings.push("class attributes are removed (mail clients ignore stylesheets anyway).");
  if (/<(script|iframe|object|form|input)[\s>]/i.test(html)) {
    warnings.push("Scripts, iframes, objects and form controls are removed - no email client would run them.");
  }
  return warnings;
}

/** Where an outbox row's entity lives in the admin, when we can link it. */
export function outboxEntityHref(entityType: string | null, entityId: string | null): string | null {
  if (!entityType || !entityId) return null;
  const routes: Record<string, string> = {
    Order: "/admin/orders",
    Customer: "/admin/customers",
    Seller: "/admin/sellers",
    ReturnRequest: "/admin/returns",
    Refund: "/admin/refunds",
    SellerPayout: "/admin/payouts",
    User: "/admin/users",
    ContactInquiry: "/admin/inquiries",
  };
  const base = routes[entityType];
  return base ? `${base}/${entityId}` : null;
}
