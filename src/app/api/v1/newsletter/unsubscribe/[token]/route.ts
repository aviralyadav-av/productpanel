import { handleOptions, withPublicApi } from "@/lib/api/public";

import { unsubscribeTokenSchema } from "@/features/newsletter/schemas";
import { unsubscribeByToken } from "@/features/newsletter/service";

/**
 * GET /api/v1/newsletter/unsubscribe/:token   (blueprint §5.3)
 *
 * The one-click link printed in every campaign. It answers with a tiny HTML
 * page rather than JSON because a person clicks it in a mail client, not a
 * script - and it is idempotent, because mail clients and link scanners
 * pre-fetch links: a second visit says "already unsubscribed" instead of
 * failing. An unknown or tampered token gets the same calm page (404 status)
 * so the URL cannot be used to test which tokens exist.
 *
 * `no-store` everywhere: nothing about a specific person may be cached.
 */
export const GET = withPublicApi<{ token: string }>(async ({ params }) => {
  const parsed = unsubscribeTokenSchema.safeParse(params.token);
  const result = parsed.success ? await unsubscribeByToken(parsed.data) : { ok: false, email: null, alreadyUnsubscribed: false };

  const title = result.ok ? (result.alreadyUnsubscribed ? "You are already unsubscribed" : "You have been unsubscribed") : "This link is no longer valid";
  const body = result.ok
    ? result.alreadyUnsubscribed
      ? "This address was already removed from our newsletter. You will not receive any more campaigns."
      : "You will not receive any more newsletter emails from us. Order and account emails are unaffected."
    : "The unsubscribe link has expired or was mistyped. If you keep receiving emails, reply to one of them and we will remove you.";

  return new Response(page(title, body, result.email), {
    status: result.ok ? 200 : 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
});

export const OPTIONS = handleOptions;

/** Self-contained: no CSS or scripts to load, and it renders in any mail-client browser. */
function page(title: string, body: string, email: string | null): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
         font: 15px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         background: #faf9f7; color: #1c1917; }
  main { max-width: 32rem; background: #fff; border: 1px solid #e7e5e4; border-radius: 12px; padding: 28px; }
  h1 { margin: 0 0 8px; font-size: 20px; }
  p { margin: 0 0 8px; color: #57534e; }
  .email { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; color: #78716c; }
  @media (prefers-color-scheme: dark) {
    body { background: #1c1917; color: #fafaf9; }
    main { background: #292524; border-color: #44403c; }
    p { color: #d6d3d1; }
    .email { color: #a8a29e; }
  }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(body)}</p>
  ${email ? `<p class="email">${escapeHtml(email)}</p>` : ""}
</main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) =>
    char === "&" ? "&amp;" : char === "<" ? "&lt;" : char === ">" ? "&gt;" : char === '"' ? "&quot;" : "&#39;",
  );
}
