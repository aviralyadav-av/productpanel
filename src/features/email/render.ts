/**
 * Email template rendering (blueprint §10, E3).
 *
 * Templates are stored HTML/text with `{{variable}}` placeholders and an
 * optional `{{#if variable}}...{{/if}}` block. The syntax is deliberately
 * tiny: it is what an admin edits in a textarea, and every extra feature is a
 * way to break an order-confirmation email at 2 a.m.
 *
 * Escaping is the one rule that matters. A customer's name is untrusted text
 * and lands inside HTML, so in `htmlBody` every value is HTML-escaped. Two
 * exceptions exist because the matrix in E3 needs them: a variable whose name
 * ends in `_html` (e.g. `order_items_html`) is built by our own code and is
 * inserted raw, and the triple-brace form `{{{var}}}` inserts raw explicitly.
 * Subjects and text bodies are not HTML, so nothing is escaped there - and
 * `_html` variables are reduced to their text content so a plain-text reader
 * never sees tags.
 */

export type EmailVarValue = string | number | boolean | null | undefined;
export type EmailVars = Record<string, EmailVarValue>;

export type EmailTemplateSource = {
  subject: string;
  htmlBody: string;
  textBody?: string | null;
};

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

const VAR_NAME = "[A-Za-z_][A-Za-z0-9_.]*";
const IF_BLOCK = new RegExp(
  `\\{\\{#if\\s+(${VAR_NAME})\\s*\\}\\}([\\s\\S]*?)(?:\\{\\{else\\}\\}([\\s\\S]*?))?\\{\\{\\/if\\}\\}`,
  "g",
);
const TRIPLE = new RegExp(`\\{\\{\\{\\s*(${VAR_NAME})\\s*\\}\\}\\}`, "g");
const DOUBLE = new RegExp(`\\{\\{\\s*(${VAR_NAME})\\s*\\}\\}`, "g");
const ANY_VAR = new RegExp(
  `\\{\\{\\{?\\s*(?:#if\\s+)?(${VAR_NAME})\\s*\\}?\\}\\}`,
  "g",
);

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Crude but safe: tags out, entities decoded for the handful we emit. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isRawName(name: string): boolean {
  return name.endsWith("_html");
}

function truthy(value: EmailVarValue): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return value !== 0;
  return true;
}

function stringify(value: EmailVarValue): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function applyIfBlocks(body: string, vars: EmailVars): string {
  return body.replace(IF_BLOCK, (_match, name: string, inner: string, otherwise?: string) =>
    truthy(vars[name]) ? inner : (otherwise ?? ""),
  );
}

/** Render one body in HTML mode (escaped) or text mode (raw, tags stripped from _html vars). */
function renderBody(body: string, vars: EmailVars, mode: "html" | "text"): string {
  const withBlocks = applyIfBlocks(body, vars);

  const raw = withBlocks.replace(TRIPLE, (_match, name: string) => {
    const value = stringify(vars[name]);
    return mode === "text" ? htmlToText(value) : value;
  });

  return raw.replace(DOUBLE, (match, name: string) => {
    // Leave unknown placeholders visible: a blank where the order number should
    // be is worse than seeing "{{order_id}}" and knowing the template is wrong.
    if (!(name in vars)) return match;
    const value = stringify(vars[name]);
    if (mode === "text") return isRawName(name) ? htmlToText(value) : value;
    return isRawName(name) ? value : escapeHtml(value);
  });
}

export function renderTemplate(
  template: EmailTemplateSource,
  vars: EmailVars,
): RenderedEmail {
  const html = renderBody(template.htmlBody, vars, "html");
  const text =
    template.textBody && template.textBody.trim().length > 0
      ? renderBody(template.textBody, vars, "text")
      : htmlToText(html);

  return {
    subject: renderBody(template.subject, vars, "text").replace(/\s+/g, " ").trim(),
    html,
    text,
  };
}

/** Every distinct variable name a body references, in first-seen order. */
export function extractVariables(body: string): string[] {
  const seen = new Set<string>();
  for (const match of body.matchAll(ANY_VAR)) {
    if (match[1]) seen.add(match[1]);
  }
  return [...seen];
}

/**
 * Variables the template uses that the event does not provide - the editor
 * shows these as a warning because they would render as literal `{{...}}`.
 */
export function unknownVariables(
  template: EmailTemplateSource,
  knownVars: readonly string[],
): string[] {
  const known = new Set(knownVars);
  const used = new Set([
    ...extractVariables(template.subject),
    ...extractVariables(template.htmlBody),
    ...extractVariables(template.textBody ?? ""),
  ]);
  return [...used].filter((name) => !known.has(name));
}
