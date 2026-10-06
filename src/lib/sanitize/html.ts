import sanitize, { type IOptions, type Transformer } from "sanitize-html";

import { env, mediaOrigins, normalizeOrigin } from "@/lib/env";

/**
 * HTML sanitisation (blueprint §14.D12).
 *
 * Applied on WRITE in services and again in public serialisers, so a row that
 * predates a rule change is still safe on the way out. Three profiles, all
 * allowlists: an attacker's `<script>`, `onerror=`, `style=` or `data:` URI
 * is not "removed" so much as never permitted to exist.
 */

export type SanitizeProfile = "rich" | "basic" | "email";

const BASIC_TAGS = ["p", "br", "strong", "em", "u", "s", "ul", "ol", "li", "a"];

const RICH_TAGS = [
  ...BASIC_TAGS,
  "h2",
  "h3",
  "h4",
  "img",
  "blockquote",
  "pre",
  "code",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "figure",
  "figcaption",
];

// Email clients lay out with tables; a few presentational attributes are the
// only way to keep a template readable in Outlook. Still no style/class.
const EMAIL_TAGS = [...RICH_TAGS, "span", "div", "h1", "center"];

const LINK_ATTRS = ["href", "title", "rel", "target"];
const IMG_ATTRS = ["src", "alt", "width", "height"];

const RICH_ATTRIBUTES: IOptions["allowedAttributes"] = {
  a: LINK_ATTRS,
  img: IMG_ATTRS,
  th: ["colspan", "rowspan"],
  td: ["colspan", "rowspan"],
};

const EMAIL_ATTRIBUTES: IOptions["allowedAttributes"] = {
  ...RICH_ATTRIBUTES,
  table: ["width", "align", "cellpadding", "cellspacing", "border", "role"],
  th: ["colspan", "rowspan", "width", "align", "valign"],
  td: ["colspan", "rowspan", "width", "align", "valign"],
  img: [...IMG_ATTRS, "align"],
};

/**
 * Relative paths ("/media/...") and absolute URLs on one of OUR origins - the
 * admin, the storefront(s), the S3/CDN host. Anything else is dropped so that
 * a stored page cannot beacon to a third party or hotlink a tracking pixel.
 */
export function isAllowedImageSrc(src: string | undefined): boolean {
  if (!src) return false;
  const value = src.trim();
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  if (!/^https?:\/\//i.test(value)) return false;
  const origin = normalizeOrigin(value);
  return origin !== null && mediaOrigins().includes(origin);
}

/**
 * External = an absolute http(s) URL on an origin that is not ours. Relative
 * paths, anchors and mailto are internal; a disallowed scheme is neither -
 * the sanitiser strips that href entirely, so it must not earn rel/target.
 */
export function isExternalHref(href: string | undefined): boolean {
  if (!href) return false;
  const value = href.trim();
  if (!/^https?:\/\//i.test(value)) return false;
  const origin = normalizeOrigin(value);
  if (!origin) return true;
  return origin !== env.APP_ORIGIN && !env.STOREFRONT_ORIGINS.includes(origin);
}

const linkTransformer: Transformer = (tagName, attribs) => {
  const { href, title } = attribs;
  const next: Record<string, string> = {};
  if (href) next.href = href;
  if (title) next.title = title;
  if (isExternalHref(href)) {
    next.rel = "noopener noreferrer nofollow";
    next.target = "_blank";
  }
  return { tagName, attribs: next };
};

const imageTransformer: Transformer = (tagName, attribs) => {
  const next: Record<string, string> = {};
  if (attribs.src) next.src = attribs.src.trim();
  if (attribs.alt !== undefined) next.alt = attribs.alt;
  for (const dim of ["width", "height", "align"] as const) {
    const value = attribs[dim];
    if (value && /^\d{1,5}$/.test(value)) next[dim] = value;
    else if (dim === "align" && value && /^(left|right|center|middle|top|bottom)$/i.test(value)) {
      next[dim] = value.toLowerCase();
    }
  }
  return { tagName, attribs: next };
};

function buildOptions(profile: SanitizeProfile): IOptions {
  const allowedTags = profile === "basic" ? BASIC_TAGS : profile === "email" ? EMAIL_TAGS : RICH_TAGS;
  const allowedAttributes =
    profile === "basic" ? { a: LINK_ATTRS } : profile === "email" ? EMAIL_ATTRIBUTES : RICH_ATTRIBUTES;

  return {
    allowedTags,
    allowedAttributes,
    // No `*` entry above, so style/class/id/on*/data-* are dropped everywhere.
    allowedClasses: {},
    allowedStyles: {},
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["http", "https"] },
    allowedSchemesAppliedToAttributes: ["href", "src"],
    allowProtocolRelative: false,
    enforceHtmlBoundary: true,
    disallowedTagsMode: "discard",
    // Drop contents of script/style/etc. instead of leaving their text behind.
    nonTextTags: ["script", "style", "textarea", "option", "noscript", "template", "iframe", "object"],
    transformTags: {
      a: linkTransformer,
      img: imageTransformer,
    },
    exclusiveFilter: (frame) => {
      if (frame.tag === "img") return !isAllowedImageSrc(frame.attribs.src);
      // An anchor whose href was stripped (bad scheme) becomes plain text.
      return false;
    },
  };
}

const optionsCache = new Map<SanitizeProfile, IOptions>();

export function sanitizeHtml(html: string | null | undefined, profile: SanitizeProfile = "rich"): string {
  if (!html) return "";
  let options = optionsCache.get(profile);
  if (!options) {
    options = buildOptions(profile);
    optionsCache.set(profile, options);
  }
  return sanitize(html, options).trim();
}

const NBSP = new RegExp(String.fromCharCode(0xa0), "g");

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  // A plain space, not U+00A0: text previews and search should not carry NBSPs.
  nbsp: String.fromCharCode(0x20),
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    return ENTITY_MAP[entity.toLowerCase()] ?? match;
  });
}

/**
 * Plain text for previews, search indexes and the text/plain half of an
 * email. Block boundaries become newlines so "<p>a</p><p>b</p>" is not "ab".
 */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h[1-6]|tr|blockquote|figcaption|pre)\s*>/gi, "\n");
  const text = sanitize(withBreaks, {
    allowedTags: [],
    allowedAttributes: {},
    nonTextTags: ["script", "style", "textarea", "option", "noscript", "template", "iframe", "object"],
  });
  return decodeEntities(text)
    // sanitize-html already decodes &nbsp; to U+00A0; previews want a plain space.
    .replace(NBSP, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
