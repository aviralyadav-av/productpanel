/**
 * Server-side authorization probe (blueprint sections 3 and 14.D14).
 *
 * NOTE on page checks: a denied admin PAGE answers 200 with the "no access"
 * screen, because Next.js commits the status line before the page guard runs on
 * these streamed routes. The check that matters is therefore whether the page
 * body contains data from the module - it must not. The admin API does return a
 * proper 403, and that is asserted below.
 *  1. anonymous  -> admin pages must redirect to login, admin API must be 401
 *  2. catalog-manager -> catalog pages allowed, finance/system pages forbidden
 *  3. public /api/v1 reads must work with no session at all
 */
const BASE = "http://localhost:3000";
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || "Admin@123456";

function makeJar() {
  const jar = new Map();
  return {
    header: () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
    store(res) {
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [pair] = c.split(";");
        const i = pair.indexOf("=");
        if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }
    },
  };
}

async function get(url, jar) {
  const res = await fetch(BASE + url, { redirect: "manual", headers: jar ? { cookie: jar.header() } : {} });
  jar?.store(res);
  return res;
}

async function login(email) {
  const jar = makeJar();
  const csrfRes = await get("/api/auth/csrf", jar);
  const { csrfToken } = await csrfRes.json();
  const res = await fetch(BASE + "/api/auth/callback/credentials", {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar.header(), origin: BASE },
    body: new URLSearchParams({ email, password: PASSWORD, csrfToken, callbackUrl: BASE + "/admin/dashboard", json: "true" }),
  });
  jar.store(res);
  const session = await (await get("/api/auth/session", jar)).json().catch(() => null);
  return { jar, email: session?.user?.email ?? null, role: session?.user?.role ?? null };
}

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) {
    pass += 1;
    console.log("  ok   " + label);
  } else {
    fail += 1;
    console.log("  FAIL " + label + "  <- " + detail);
  }
}

async function main() {
  console.log("1. ANONYMOUS");
  for (const route of ["/admin/dashboard", "/admin/products", "/admin/settings", "/admin/users"]) {
    const res = await get(route);
    const loc = res.headers.get("location") || "";
    check(`${route} redirects to login`, res.status >= 300 && res.status < 400 && loc.includes("/admin/login"), `${res.status} ${loc}`);
  }
  for (const route of ["/api/admin/products", "/api/admin/orders", "/api/admin/users"]) {
    const res = await get(route);
    check(`${route} is 401`, res.status === 401, String(res.status));
  }

  console.log("\n2. PUBLIC API (no session)");
  for (const route of ["/api/v1/categories", "/api/v1/products?include=facets", "/api/v1/home", "/api/v1/settings", "/api/v1/navigation/main", "/api/v1/faqs", "/api/v1/blog", "/api/v1/seo/sitemap"]) {
    const res = await get(route);
    let count = "";
    try {
      const body = await res.json();
      const data = body.data ?? body;
      count = Array.isArray(data) ? `${data.length} items` : typeof data === "object" ? `${Object.keys(data).length} keys` : "";
    } catch {
      count = "unparsable";
    }
    check(`${route} -> 200 (${count})`, res.status === 200, String(res.status));
  }

  console.log("\n3. CATALOG MANAGER (least privilege)");
  const cm = await login("catalog-manager@diybaazar.local");
  check("logged in as catalog-manager", cm.email === "catalog-manager@diybaazar.local", JSON.stringify(cm));
  if (cm.email) {
    for (const route of ["/admin/products", "/admin/categories", "/admin/inventory", "/admin/attributes"]) {
      const res = await get(route, cm.jar);
      check(`${route} allowed`, res.status === 200, String(res.status));
    }
    // Fingerprints only the real page renders - never the shell chrome.
    const denied = [
      ["/admin/payouts", "PO-0000"],
      ["/admin/users", "order-manager@diybaazar.local"],
      ["/admin/roles", "Finance Manager"],
      ["/admin/settings", "Asia/Kolkata"],
      ["/admin/audit-log", "seller."],
    ];
    for (const [route, fingerprint] of denied) {
      const res = await get(route, cm.jar);
      const body = res.status === 200 ? await res.text() : "";
      check(`${route} renders no module data`, !body.includes(fingerprint), `found ${fingerprint}`);
    }
    for (const route of ["/api/admin/users", "/api/admin/payouts", "/api/admin/settings"]) {
      const res = await get(route, cm.jar);
      check(`${route} is 403`, res.status === 403, String(res.status));
    }
    const allowed = await get("/api/admin/products", cm.jar);
    check("/api/admin/products is 200 for catalog manager", allowed.status === 200, String(allowed.status));
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
}

void main();
