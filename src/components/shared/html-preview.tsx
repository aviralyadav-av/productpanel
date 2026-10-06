import { cn } from "cn";

/**
 * Renders operator-authored HTML (page bodies, blog posts, email templates)
 * in a sandboxed iframe. `sandbox=""` disables scripts, forms and same-origin
 * access, so even if sanitisation upstream missed something the preview
 * cannot touch the admin session. The admin's own styles do not leak in
 * either, which is the point: this is what the content looks like on its own.
 *
 * Server-compatible - it is just markup.
 */
export function HtmlPreview({
  html,
  className,
  title = "Preview",
  minHeight = 240,
}: {
  html: string;
  className?: string;
  title?: string;
  minHeight?: number;
}) {
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><style>${PREVIEW_CSS}</style></head><body>${html}</body></html>`;

  return (
    <iframe
      title={title}
      sandbox=""
      srcDoc={srcDoc}
      className={cn("bg-card w-full rounded-lg border", className)}
      style={{ minHeight }}
    />
  );
}

/**
 * Deliberately minimal and self-contained (no tokens - the iframe cannot see
 * them). Approximates the storefront's reading typography so headings, lists
 * and images look proportionate.
 */
const PREVIEW_CSS = `
  :root { color-scheme: light; }
  body { margin: 0; padding: 16px; font: 14px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; color: #2a2825; background: #fff; word-wrap: break-word; }
  h1, h2, h3, h4 { line-height: 1.25; margin: 1.2em 0 .5em; font-weight: 600; }
  h1 { font-size: 1.6em; } h2 { font-size: 1.35em; } h3 { font-size: 1.15em; }
  p, ul, ol, blockquote, pre, table { margin: 0 0 1em; }
  ul, ol { padding-left: 1.5em; }
  a { color: #8a6a3f; }
  img, video { max-width: 100%; height: auto; border-radius: 6px; }
  blockquote { border-left: 3px solid #d9d4cc; margin-left: 0; padding: .25em 1em; color: #6b665f; }
  pre { background: #f4f2ee; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 12px; }
  code { font-family: ui-monospace, monospace; font-size: .92em; background: #f4f2ee; padding: .1em .3em; border-radius: 3px; }
  pre code { background: none; padding: 0; }
  hr { border: 0; border-top: 1px solid #e6e2db; margin: 1.5em 0; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #e6e2db; padding: 6px 8px; text-align: left; }
`;
