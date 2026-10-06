import { EMAIL_TEMPLATE_KEYS, type EmailTemplateKey } from "@/lib/enums";
import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_EVENT_KEYS,
  eventEmailVariableNames,
  type NotificationEventKey,
} from "@/features/notifications/events";

import { extractVariables, unknownVariables, type EmailTemplateSource, type EmailVars } from "./render";

/**
 * What an operator editing an email template is allowed to type between
 * `{{ }}`, and what a preview should show in its place (blueprint E3).
 *
 * PURE on purpose - no database, no `next/*`, no `server-only`. The editor
 * (a Client Component), the preview action, the REST preview endpoint, the
 * unit test and the check script all need the SAME answer to "which variables
 * does order_shipped have?", and the only way to guarantee that is one
 * function derived from the event matrix rather than four hand-kept lists.
 *
 * The event matrix is the source of truth for a template's variables;
 * `EmailTemplate.variables` (seeded from the same table) is carried alongside
 * it because a few templates - `password_reset`, and anything a later module
 * adds - are queued directly by a service rather than by `emitEvent`, and
 * their documented set exists only in the seed.
 */

/** Injected by queueEmail() into every template, so no event declares them. */
export const COMMON_EMAIL_VARIABLES = ["store_name", "store_url", "support_email"] as const;

/** templateKey -> the event that sends it (E3). Not every key has one. */
export const EVENT_BY_TEMPLATE_KEY: Partial<Record<EmailTemplateKey, NotificationEventKey>> =
  Object.fromEntries(
    NOTIFICATION_EVENT_KEYS.flatMap((eventKey) => {
      const templateKey = NOTIFICATION_EVENTS[eventKey].emailTemplateKey;
      return templateKey ? [[templateKey, eventKey] as const] : [];
    }),
  );

export function isEmailTemplateKey(value: string): value is EmailTemplateKey {
  return (EMAIL_TEMPLATE_KEYS as readonly string[]).includes(value);
}

/**
 * Every variable the template may use: the common three, whatever its event
 * supplies, and whatever the seed recorded on the row (`stored`). Order is
 * "common first, then event/seed order", which is how the editor lists chips.
 */
export function documentedVariables(key: string, stored: readonly string[] = []): string[] {
  const eventKey = isEmailTemplateKey(key) ? EVENT_BY_TEMPLATE_KEY[key] : undefined;
  const fromEvent = eventKey ? eventEmailVariableNames(eventKey) : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of [...COMMON_EMAIL_VARIABLES, ...fromEvent, ...stored]) {
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/** True when the variable's value is trusted HTML we insert unescaped (render.ts). */
export function isHtmlVariable(name: string): boolean {
  return name.endsWith("_html");
}

/**
 * One line of "what is this?" per variable, for the editor's variables panel.
 * Matched by suffix so a new `*_url` or `*_name` from a future event is
 * explained without touching this file.
 */
export function describeVariable(name: string): string {
  const exact: Record<string, string> = {
    store_name: "Your store name (setting store.name).",
    store_url: "Storefront base URL (setting storefront.base_url).",
    support_email: "Contact address (setting store.contact_email).",
    order_id: "The human order number, e.g. DB10042.",
    order_items_html: "A rendered table of the ordered lines. Inserted as HTML, not escaped.",
    payment_method: "COD, ONLINE or MANUAL.",
    expires_minutes: "How long the link in this email stays valid.",
    expires_hours: "How long the invite stays valid.",
    ticket_id: "The inquiry reference shown to the customer.",
    reason: "Free text written by the operator who took the decision.",
    eta: "Expected delivery date, already formatted.",
  };
  if (exact[name]) return exact[name];
  if (isHtmlVariable(name)) return "Pre-rendered HTML built by the platform. Inserted unescaped.";
  if (name.endsWith("_url")) return "An absolute link. Use it as an href.";
  if (name.endsWith("_email")) return "An email address.";
  if (name.endsWith("_number")) return "A reference number (order, RMA, refund, shipment).";
  if (name.endsWith("_name")) return "A person or business name; escaped when rendered.";
  if (name.endsWith("_amount") || name === "amount" || name.endsWith("_total")) {
    return "A money amount, already formatted in rupees.";
  }
  if (name.endsWith("_date")) return "A date, already formatted for India.";
  return "Supplied by the event that sends this email.";
}

const SAMPLE_ITEMS_HTML =
  '<table style="width:100%;border-collapse:collapse">' +
  '<tr><td style="padding:6px 0">Block-printed tote bag &times; 1</td>' +
  '<td style="padding:6px 0;text-align:right">Rs 1,499</td></tr>' +
  '<tr><td style="padding:6px 0">Terracotta mug &times; 2</td>' +
  '<td style="padding:6px 0;text-align:right">Rs 1,000</td></tr></table>';

const SAMPLE_VALUES: Record<string, string> = {
  store_name: "DIY Baazar",
  store_url: "https://diybaazar.example",
  support_email: "support@diybaazar.example",
  customer_name: "Ananya Sharma",
  seller_name: "Kalakari Studio",
  name: "Ananya Sharma",
  inviter_name: "Priya Menon",
  role_name: "Manager",
  order_id: "DB10042",
  order_total: "₹2,499",
  amount: "₹2,499",
  refund_amount: "₹899",
  refund_method: "Original payment method",
  refund_number: "RF10007",
  rma_number: "RMA10003",
  transaction_id: "pay_R9x2Kq8mVb",
  payment_method: "ONLINE",
  carrier: "Delhivery",
  tracking_number: "DL1234567890",
  eta: "12 Sep 2026",
  pickup_date: "11 Sep 2026",
  cancel_reason: "Customer changed their mind",
  reason: "Documents did not match the business name",
  subject: "Where is my order?",
  ticket_id: "INQ-4821",
  expires_minutes: "60",
  expires_hours: "48",
  order_items_html: SAMPLE_ITEMS_HTML,
};

/**
 * A believable value per variable, so the preview reads like a real email
 * instead of a page full of braces. Deterministic - the unit test and the
 * check script compare against it.
 */
export function sampleValueFor(name: string): string {
  const exact = SAMPLE_VALUES[name];
  if (exact !== undefined) return exact;
  if (isHtmlVariable(name)) return "<p>Sample content</p>";
  if (name.endsWith("_url")) {
    return `https://diybaazar.example/${name.replace(/_url$/, "").replace(/_/g, "-")}/sample`;
  }
  if (name.endsWith("_email")) return "customer@example.com";
  if (name.endsWith("_number")) return "DB10042";
  if (name.endsWith("_name")) return "Ananya Sharma";
  if (name.endsWith("_date")) return "12 Sep 2026";
  return `Sample ${name.replace(/_/g, " ")}`;
}

/** Sample values for every documented variable of a template. */
export function sampleVarsFor(key: string, stored: readonly string[] = []): EmailVars {
  return Object.fromEntries(
    documentedVariables(key, stored).map((name) => [name, sampleValueFor(name)]),
  );
}

/**
 * Variables the body uses that no event and no seeded list supplies. These
 * render as a literal `{{name}}` in a real send (render.ts leaves unknown
 * placeholders visible on purpose), so the editor shows them as a warning.
 */
export function unknownVariablesFor(
  template: EmailTemplateSource,
  key: string,
  stored: readonly string[] = [],
): string[] {
  return unknownVariables(template, documentedVariables(key, stored));
}

/** Every variable the three bodies reference, in first-seen order. */
export function usedVariables(template: EmailTemplateSource): string[] {
  const seen = new Set<string>();
  for (const body of [template.subject, template.htmlBody, template.textBody ?? ""]) {
    for (const name of extractVariables(body)) seen.add(name);
  }
  return [...seen];
}

/** Documented variables the bodies never use - a hint, not an error. */
export function unusedVariablesFor(
  template: EmailTemplateSource,
  key: string,
  stored: readonly string[] = [],
): string[] {
  const used = new Set(usedVariables(template));
  return documentedVariables(key, stored).filter((name) => !used.has(name));
}

/**
 * Sample values for the variables a template ACTUALLY uses, documented or
 * not. Unknown ones still get a placeholder so the preview shows the finished
 * layout rather than a raw `{{typo}}` mid-sentence; the warning list is what
 * tells the operator about the typo.
 */
export function previewVarsFor(
  template: EmailTemplateSource,
  key: string,
  stored: readonly string[] = [],
  overrides: EmailVars = {},
): EmailVars {
  const vars = sampleVarsFor(key, stored);
  for (const name of usedVariables(template)) {
    if (!(name in vars)) vars[name] = sampleValueFor(name);
  }
  return { ...vars, ...overrides };
}
