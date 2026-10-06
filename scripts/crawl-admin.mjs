/**
 * Authenticated crawl of every admin page + a sweep of the public API.
 * Logs in through Auth.js credentials, keeps the cookie jar, then GETs every
 * route discovered from the app directory and reports non-2xx results.
 */
import { readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = "http://localhost:3000";
const EMAIL = process.env.SEED_ADMIN_EMAIL || "admin@diybaazar.local";
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || "Admin@123456";

const jar = new Map();
function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}
function storeCookies(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const c of raw) {
    const [pair] = c.split(";");
    const idx = pair.indexOf("=");
    if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
}
async function req(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    redirect: "manual",
    headers: { ...(init.headers || {}), cookie: cookieHeader() },
  });
  storeCookies(res);
  return res;
}

async function login() {
  const csrfRes = await req(`${BASE}/api/auth/csrf`);
  const { csrfToken } = await csrfRes.json();
  const body = new URLSearchParams({ email: EMAIL, password: PASSWORD, csrfToken, callbackUrl: `${BASE}/admin/dashboard`, json: "true" });
  const res = await req(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: BASE },
    body,
  });
  const sessionRes = await req(`${BASE}/api/auth/session`);
  const session = await sessionRes.json().catch(() => null);
  return { status: res.status, session };
}

// ---- discover routes from the filesystem -----------------------------------
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const SAMPLES = JSON.parse(process.env.CRAWL_SAMPLES || "{}");

function routeFromFile(file, base) {
  const rel = path.relative(base, path.dirname(file)).replace(/\\/g, "/");
  const segs = rel === "." ? [] : rel.split("/");
  const kept = segs.filter((s) => !(s.startsWith("(") && s.endsWith(")")));
  const url = "/" + kept.join("/");
  return url === "/" ? "/" : url;
}

function fillParams(url) {
  // Replace [param] and [...param] with a real id from SAMPLES, else skip.
  const missing = [];
  const filled = url.replace(/\[(\.\.\.)?([^\]]+)\]/g, (_m, spread, name) => {
    const key = `${url}:${name}`;
    const value = SAMPLES[key] ?? SAMPLES[name];
    if (!value) missing.push(name);
    return value ?? `__${name}__`;
  });
  return { filled, missing };
}

const pageFiles = walk("src/app/admin").filter((f) => /[\\/]page\.tsx$/.test(f));
const pageRoutes = [...new Set(pageFiles.map((f) => "/admin" + routeFromFile(f, "src/app/admin").replace(/^\/$/, "")))]
  .map((r) => (r === "/admin" ? "/admin" : r))
  .sort();

const apiFiles = walk("src/app/api").filter((f) => /[\\/]route\.ts$/.test(f));
const apiRoutes = [...new Set(apiFiles.map((f) => "/api" + routeFromFile(f, "src/app/api")))].sort();

async function main() {
  const auth = await login();
  const results = { login: auth.status, sessionUser: auth.session?.user?.email ?? null, pages: [], api: [], skipped: [] };
  if (!results.sessionUser) {
    console.log("LOGIN FAILED", JSON.stringify(auth).slice(0, 500));
    process.exit(1);
  }
  console.log("logged in as", results.sessionUser, "\n");

  for (const route of pageRoutes) {
    const { filled, missing } = fillParams(route);
    if (missing.length) {
      results.skipped.push({ route, missing });
      continue;
    }
    const t0 = Date.now();
    let status = 0;
    let note = "";
    try {
      const res = await req(BASE + filled);
      status = res.status;
      if (status >= 300 && status < 400) note = "-> " + res.headers.get("location");
      if (status >= 500) note = (await res.text()).slice(0, 200).replace(/\s+/g, " ");
    } catch (e) {
      status = -1;
      note = e.message;
    }
    results.pages.push({ route: filled, status, ms: Date.now() - t0, note });
    const flag = status === 200 ? "ok " : status >= 500 || status === -1 ? "ERR" : "   ";
    console.log(`${flag} ${status} ${String(Date.now() - t0).padStart(5)}ms ${filled} ${note}`);
  }

  console.log("\n--- public API (GET only) ---");
  for (const route of apiRoutes.filter((r) => r.startsWith("/api/v1") || r.startsWith("/api/admin"))) {
    const { filled, missing } = fillParams(route);
    if (missing.length) {
      results.skipped.push({ route, missing });
      continue;
    }
    let status = 0;
    let note = "";
    try {
      const res = await req(BASE + filled);
      status = res.status;
      if (status >= 500) note = (await res.text()).slice(0, 200).replace(/\s+/g, " ");
    } catch (e) {
      status = -1;
      note = e.message;
    }
    results.api.push({ route: filled, status, note });
    if (status >= 500 || status === -1) console.log(`ERR ${status} ${filled} ${note}`);
  }

  const badPages = results.pages.filter((p) => p.status !== 200);
  const badApi = results.api.filter((a) => a.status >= 500 || a.status === -1);
  console.log("\n=== SUMMARY ===");
  console.log(`pages crawled: ${results.pages.length}, non-200: ${badPages.length}`);
  console.log(`api crawled:   ${results.api.length}, 5xx: ${badApi.length}`);
  console.log(`skipped (no sample id): ${results.skipped.length}`);
  if (badPages.length) console.log("\nNON-200 PAGES:\n" + badPages.map((p) => `  ${p.status} ${p.route} ${p.note}`).join("\n"));
  if (badApi.length) console.log("\n5xx API:\n" + badApi.map((a) => `  ${a.status} ${a.route} ${a.note}`).join("\n"));
  if (results.skipped.length) console.log("\nSKIPPED:\n" + results.skipped.map((s) => `  ${s.route} (${s.missing.join(",")})`).join("\n"));
  writeFileSync(process.env.CRAWL_OUT || "crawl-results.json", JSON.stringify(results, null, 2));
}

void main();
