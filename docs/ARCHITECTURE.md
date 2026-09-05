# Niya Bags — Admin Panel Implementation Blueprint

> Generated from a 27-agent design + adversarial-hardening pass over the live storefront source.

> Storefront repo read-only reference: `../e-commerce_frontend-main`


---

# 0. Executive Audit

## Final Completeness Audit

Verification pass run against the repo before writing. Confirmed by direct read: **39 products** (6 handbags / 14 minibags / 9 sling / 7 tote / 3 wallet; 36 women, 3 men), **78 variants** of which **14 already carry ids** (the 7 tote products, shape `tote-001-brown`), **234 image references resolving to 39 distinct files**, **50 non-SVG files in `public/`**, price span **₹999–₹3,599**, **22 products below the ₹2,000 free-shipping threshold**, median **₹1,999**, **10 on sale**, **16 featured**, **8 footer page keys** with no `legal` key, and **exactly 2 synchronous `homeApi` call sites** (`BrandCraftsmanship.jsx:5`, `CustomerReviews.jsx:5` — the other five consumers already `await`). Also confirmed: `axiosClient.js` derives both base URLs from `import.meta.env`, so it needs **zero code edits** at cutover; `src/api/orderApi.js` does not exist; `CartContext.jsx`'s `hasExisting` eviction branch is real; `CartPage.jsx` totals on `product.price`; `NIYA10` is hardcoded client-side.

---

### (a) Coverage Gaps

All 20 numbered outputs are nominally owned. The real gaps are in the **extra demands**, plus three outputs owned too thinly.

| # | Gap | Sev | Section that must absorb it |
|---|---|---|---|
| G1 | **Global search / command palette.** No section owns it. §2 is nav IA only; §8 scopes ILIKE search to orders and customers. Nothing owns a cross-entity ⌘K over products, orders, customers, CMS pages, media, settings — the single highest-leverage affordance for a one-operator panel. | High | §2 owns the surface (scopes, ranking, keyboard model, empty states); §4 adds one `GET /admin/search?q=&scopes=` returning a typed union with per-scope caps. |
| G2 | **Notification delivery.** §6 designs 11 dashboard alert *tiles*. Nothing designs how an alert reaches the operator with the tab closed — the only channel that matters for "new COD order" and "stock hit zero". | High | §6 owns it. Recommend: `NotificationRule` + `NotificationLog` entities, transactional email (Resend) as the only v1 channel, digest-not-firehose, WhatsApp/push explicitly [LATER]. §5 adds the two entities. |
| G3 | **Environment-variable master table.** Vars are scattered: §1 (.env), §3 (`AUTH_URL`, `useSecureCookies`), §7 (`NEXT_PUBLIC_STOREFRONT_ORIGIN`), §9 (`VITE_CONTENT_API_BASE_URL`), §13 (the two Vite vars). No canonical inventory, no required/optional marking, no dev-vs-prod values. | High | §1 owns one table: name, scope (admin server / admin client / storefront build-time), required?, dev value, prod value, rotation risk. §13 keeps only the two storefront vars as the cutover payload. |
| G4 | **Production deployment topology.** §13 covers the Vercel redeploy mechanics of cutover but no section owns the shape: two Vercel projects, Postgres host and **region** (must be Mumbai/ap-south-1 for an India store — a us-east-1 DB adds ~200ms to every admin query), migration execution in CI, preview-env DB strategy, backups/PITR, custom domains. | High | §13 §"Deployment" (it already owns Vercel and rollback), cross-referencing §1's env table. |
| G5 | **Database considerations tiered required-now / recommended / future-ready.** The user asked for this marking explicitly. §5 models entities well but never applies the three-tier label; §10 and §11 use ad-hoc `[LATER]` tags with different meanings. | High | §5 owns it — one table where every entity and every index carries exactly one of the three labels, and `[LATER]` is retired in favour of the user's own vocabulary. |
| G6 | **Responsiveness / breakpoint strategy.** The user said "desktop and tablet first". §12 owns the design system but no decision mentions breakpoints, the sidebar's tablet collapse, or the table→card fallback. With 12+ column order tables this is a real design problem, not a Tailwind default. | Med | §12. Commit to: ≥1280 full sidebar + full tables; 768–1279 icon-rail sidebar + column-priority hiding; <768 explicitly out of scope (a stated non-goal, not a bug). |
| G7 | **Public API abuse controls.** §3 correctly drops Redis and makes rate limiting a `LoginAttempt` table written only on auth attempts. But §4's public `/api/v1/*` — the endpoints the storefront and the whole internet will hit — has no protection story at all. | Med | §4. CDN cache as the primary shield (already designed: 60s s-maxage + SWR), plus Vercel WAF/Firewall rules and an Origin allowlist. No per-request DB counter. |
| G8 | **Middleware must exempt the public API.** §3's default-deny matcher `/((?!_next/static|_next/image|favicon.ico).*)` also catches `/api/v1/*`, so an unauthenticated storefront fetch gets redirected to `/login`. Neither §2 nor §3 states the exemption. This is a live break-on-day-one bug in the current spec. | **Critical** | §3, as an explicit early-return branch in the middleware contract. |
| G9 | **Public serializer must convert paise → rupees.** §5/§6/§8/§11 all store money as `Int` paise. `products.js` ships `price: 2999` (rupees). No section states that `lib/serializers/public/` divides by 100. Ship as-is and every storefront price is 100× too high. | **Critical** | §4 (endpoint contract) with the implementation rule in §12's shape-fidelity section. |
| G10 | **Legacy order-status string on the public API.** §8 defines a 10-state enum; §12 maps legacy `"ORDER PLACED"` → `PLACED`. But `OrderReceipt.jsx` and `MyOrders.jsx` render `order.status` as a raw display string. Nothing states the public order serializer must emit the display string, not the enum token. | Med | §4, as a status→display-string map owned alongside the enum in §8. |
| G11 | **Aggregate overflow.** §5 caps `Int` paise at ₹2.14 crore per column. §8's LTV and §11's revenue rollups sum many such columns. Nothing states the aggregate type. | Med | §5. Rule: `Int` for stored columns, `BigInt`/`Decimal` for every `SUM()`, cast in the query not the app. |
| G12 | **Output 20 (final recommended architecture) is thin.** §13 carries phases + cutover + risks + recommendation. The user asked for #20 as a standalone synthesis. | Med | §13 must end with a self-contained one-page "if you build one thing, build this" — stack table, the 8 v1 entities, the 6 v1 modules, the cutover contract, and what is deliberately excluded. |
| G13 | **Settings has no canonical field registry.** Settings fields are scattered across §2 (colour vocabulary), §3 (shipping rule, surfaced read-only), §8 (`returnWindowDays`), §10 (stale-reservation days), §6 (alert thresholds). No single list. | Med | §5 owns the `Setting` entity as a typed key registry; §2 owns the screen grouping. |
| G14 | **Testing and observability.** No section owns either. For an app whose correctness claim rests on "the public API returns byte-parity shapes", the highest-value test in the codebase is a shape-parity snapshot test against the real `products.js`/`homeData.js` fixtures. | Med | §13 (phases) — one row per wave: parity snapshot tests, a Zod-validated contract test, Sentry, structured request logging. |
| G15 | **Seeder/import ownership is ambiguous.** §5 (media dedupe + URL normalisation), §7 (CSV contract, `created_at` preservation), §13 (deterministic variant `publicId`) each specify part of one importer. | Low | §5 owns the seeder spec end-to-end; §7 and §13 cross-reference it rather than re-specifying. |
| G16 | **Integrations boundary is never stated.** §8 cuts `OUT_FOR_DELIVERY` for want of a courier webhook; §10 deletes the payment TTL sweeper for want of a gateway. No section says plainly "v1 has zero third-party integrations: no payment gateway, no courier, no SMS, no ERP." | Low | §13, as a stated non-goal so it is not re-litigated in every review. |

---

### (b) Cross-Section Contradictions

| # | Conflict | Winner and why |
|---|---|---|
| X1 | **Variant count.** §6 says "66 variants across 39 products"; §10 and §13 say 78. | **78 wins** — verified by direct count. §6's inventory-setup line ("0 of 66 variant rows") must become 0 of 78. §6's *39 products* is correct and stays. |
| X2 | **What variant ids actually fix.** §2: ids "do NOT fix the cart… a second colour destroys the first". §5: ids "convert silent quantity-merging into silent eviction". §10: ids "DO fix quantity-merge via the already-written `selectedVariant?.id` branch, but the eviction branch still makes it last-wins". | **§10 wins.** Verified in `CartContext.jsx:76-108`: the `existingIndex` exact-key branch merges correctly *once ids exist*; the separate `hasExisting` branch is what evicts the other colour. §2 and §5's phrasing overstates the damage and understates the benefit. Restate once, in §5, and have §2/§10/§13 cite it. |
| X3 | **Media entity name and dedupe key.** §5: entity `Media`, `sourceUrl @unique` is the always-present key, `checksum` nullable-unique, **49 rows**. §13: entity `MediaAsset`, "hash-deduplicated", **39 assets / 234 join rows**. | **§5 wins on the key** — a content hash is impossible for the 6 external Unsplash/Pexels/slidesdocs URLs whose bytes are never fetched. Pick **one name** (`MediaAsset` reads better) and **label the scopes**: 39 is product-scope, ~49 is whole-library. Two unlabelled counts in one document will be read as an error. |
| X4 | **Storage provider — three incompatible designs.** §1 implies Vercel Blob (`blobUrl`, `blobUrl ?? imageUrl`). §3 describes an S3-shaped flow (signed token → direct PUT → **your own** HMAC `upload-completed` handler → fetch, sniff, sharp re-encode). §7 adds a third origin (`NEXT_PUBLIC_STOREFRONT_ORIGIN` + `remotePatterns`) for legacy assets. | **Name one provider now: Vercel Blob.** Its client-upload flow *is* §3's design (`handleUpload` issues the token, `onUploadCompleted` is the callback, both already signed) with none of the S3 IAM surface, and deployment is already Vercel. Consequence to write down: **sharp re-encode becomes a post-upload job, not inline**, because the bytes never traverse the app — which is exactly why §3's 1MB Server-Action limit fix works. §7's storefront-origin rendering is orthogonal and survives untouched: legacy paths stay verbatim, new uploads get Blob URLs. |
| X5 | **Cutover file count.** §1: ".env + 6 api files + 2 component files". §2: three-class model naming 5 code-needing surfaces. §13: "Wave 1's axiosClient change drops to **ZERO lines** — two Vercel env vars plus a redeploy". | **Both are right about different files; the document reads as if they contradict.** Verified: `axiosClient.js` needs 0 edits (fully env-driven), but the *adapters* (`homeApi.js`, `productApi.js`, `footerApi.js`) still have live bodies returning static data and must be uncommented. Resolve with **one cutover table in §13** — file, class (A/B/C), edit type (env / uncomment / new / component) — and have §1, §2 and §9 all cite it instead of restating counts. |
| X6 | **Which module is the content cutover target.** §1: repoint content to the `api` instance. §2: retarget everything from `contentApi.js` to `homeApi.js` — nothing imports `contentApi.js`, it is dead code. §7: "uncomment `contentApi.js`". §9: split to a new `VITE_CONTENT_API_BASE_URL`. §13: leave `contentApi.js`'s `getNotFoundBags` commented. Four positions. | **§2 wins on the target** (`homeApi.js` is the only live adapter; `contentApi.js` stays dead — §7's "uncomment contentApi.js" is simply wrong and must be struck). **§9 wins on the env fix** (a new `VITE_CONTENT_API_BASE_URL`) over §1's instance-reuse, because it is a pure additive env change and resolves the verified collision: `authApi` = `${mockoonBaseURL}/api/auth` while `contentApi` = bare `mockoonBaseURL`, so one variable cannot serve both. §13's `notFoundApi.js`-stays-sole-owner rule is compatible and stays. |
| X7 | **Middleware matcher.** §2: "real path prefixes plus a catch-all". §3: default-deny `/((?!_next/static|_next/image|favicon.ico).*)`. | **§3 wins** — it subsumes §2's prefixes and is required anyway by the per-request CSP nonce. §2 should delete its version and cite §3. Then apply **G8**: the matcher must early-return for `/api/v1/*`. |
| X8 | **Reviews data shape.** §6 (and the brief) say `reviewsData` has "no rating". §9 verified `CustomerReviews.jsx` renders `review.rating \|\| 5` and an unconditional literal `"Verified Customer"`. | **§9 wins** (verified component read). Rating is a real, consumed, optional field. §6's demotion of review *moderation* to `[LATER]` is unaffected and correct — there is still no submission path. |
| X9 | **Shipping rule fidelity.** §3 surfaces `subtotal >= 2000 \|\| subtotal === 0 ? 0 : 100` as one read-only rule. §10 verified it is hardcoded in **two** files and that `CartPage.jsx:164` sets `estimatedShipping = 0` unconditionally — so cart and checkout already disagree today. | **§10 wins.** §3's settings screen must show *both* call sites and flag the disagreement, not present a single tidy rule. |
| X10 | **Pagination convention.** §8 commits to keyset `(sortKey, id)`. §4's public catalogue and §11's analytics endpoints imply offset/limit. Never reconciled. | **Both, declared once in §4:** keyset for operator lists (§8's tuples), offset/limit for the public API — because `getAllProducts()` expects a plain array and the storefront will never send a cursor. Write the rule down so it reads as a decision, not an oversight. |
| X11 | **Caching.** §4 caches the public API (tags + 60s s-maxage + SWR); §12 removes caching from admin reads entirely; §11 cut its own `unstable_cache`. | **No actual conflict — already resolved consistently.** Flag it as *settled* ("cache the public read API only; admin screens always read live") so it is not re-opened. |
| X12 | **Featured-products limit.** §4: `?featured=true` returns ALL featured, limit defaults to null. §7: the component slices to 4, and 16 are flagged, so 12 never appear. | **Compatible, but load-bearing on §4's `position` decision.** §7's warning copy ("N featured, homepage renders the first 4") is only true if API order is deterministic. Add the cross-reference explicitly in both sections. |
| X13 | **Sale-price truth.** §5 leads with the pricing bug (cart bills `price`, cards display `finalPrice`). §10 says the same. §13 removes `finalPrice` from the DTO parity sketch as dead code. | **All three are right and mutually consistent** — but the conclusion is stated three times in three voices. Consolidate into §5 as the canonical statement; §10 and §13 cite it. This is the argument for server-authoritative pricing and it should be made once, hard. |

---

### (c) The 5 Decisions Required Before Any Code

1. **Will the storefront ever be edited — and by whom?** Everything downstream hinges on this. Verified: content cutover requires **2 component edits** (`BrandCraftsmanship.jsx:5`, `CustomerReviews.jsx:5` call `homeApi` synchronously; the moment those return Promises, craftsmanship renders empty and reviews vanish entirely). Orders require **a new file** (`src/api/orderApi.js` does not exist). If the answer is a hard never, then say so now and ship: craftsmanship + reviews stay permanently static, and orders are admin-manual-entry forever. If the answer is "a single small PR, later", get that commitment in writing before designing the CMS around it.

2. **Postgres host and region, and the one storage provider.** Three sections currently assume three different storage designs (X4). Pick Vercel Blob or S3 and the media pipeline, the `Media` schema, and the upload security model all follow. Pick the DB region deliberately — a Mumbai/ap-south-1 Postgres versus a default us-east-1 one is the difference between a snappy panel and ~200ms on every query, for an operator in India.

3. **When does the admin DB become the catalogue's source of truth?** Either (a) the seed runs once, the admin DB is authoritative from day one, and `products.js` is frozen dead weight — meaning admin edits are real but invisible until cutover; or (b) `products.js` stays canonical and the admin is a staging area needing re-sync. Option (a) is right, but it must be an explicit decision because it determines whether the seeder is one-way, whether it is re-runnable, and whether an operator editing a price on day one is doing something meaningful or something misleading.

4. **Does the admin own customer identity, or does checkout stay anonymous?** Verified: `OrderPage` never gates on auth, and `authApi.js` stores plaintext passwords in per-device `localStorage` that no server can ever reach — **zero customer accounts can migrate**. Decide now whether NextAuth serves both apps (forcing a cross-subdomain cookie `Domain=.<root>`, a CORS credentials policy, and a real USER login surface) or whether v1 is anonymous checkout only and the USER role exists solely as a DB label. The cookie architecture in §3 cannot be finalised until this is answered.

5. **Does v1 charge the sale price?** Three verified defects: the cart bills list price while cards advertise sale price (all 10 on-sale products), `NIYA10` is an unlimited client-side 10% that checkout ignores, and cart-vs-checkout shipping already disagree. Fixing this means the order-create endpoint **re-prices server-side from the catalogue and rejects client-sent totals** — which is both the security fix and the source of the `listPricePaise`/`unitPricePaise` columns analytics needs. The alternative — mirroring the storefront's buggy math for compatibility — must be a conscious choice, not a default.

---

### (d) Executive Summary

Niya Bags today is a Vite storefront with **no backend**: 39 products, 7 homepage content blocks and 8 static pages live in local JS files, carts and wishlists live in `localStorage`, and orders are written to the shopper's own browser and never transmitted. The axios code to talk to a real API is already written in `src/api/` and merely commented out.

This blueprint builds, in the empty `admin_panel/`, a standalone **Next.js App Router + TypeScript + Auth.js + Tailwind + shadcn/ui** application with its own Postgres, deployed as its own Vercel project on its own domain. It ships two things at once: an operator panel, and the **public read API the storefront will eventually consume**. Those public endpoints are designed to return the *exact shapes the existing adapters already return* — same field names, same JSON types, same null semantics — so the eventual cutover is a body swap, not a rewrite.

Be honest about reach. Nothing the admin does touches the live site until someone repoints the storefront. Verified, that cutover is **two Vercel env vars** (`axiosClient.js` is already fully env-driven and needs zero edits), **uncommenting the adapter bodies**, **two component edits** where `getCraftsmanship()` and `getReviews()` are called synchronously, and **one new file** for orders. Cart, wishlist, the hardcoded shipping rule and TrustBadges copy are permanently out of reach.

Two roles only: ADMIN and USER. Money is stored as integer paise and serialized back to rupees for the storefront. Product ids and the 14 existing tote variant ids are preserved verbatim so shoppers' saved carts are not orphaned. Public reads are cached and published-only; admin reads are always live.

Day one, the panel is useful without the cutover: manual order and customer entry — how this store already takes COD orders over WhatsApp — plus a catalogue and CMS that go live the moment two environment variables change.

---

## 1. Overall Architecture, Folder Structure, Routes and Layouts

### 1.1 Where the admin panel sits today (verified against the repo)

Two folders, **zero servers**. Every read the storefront performs resolves inside its own bundle:

| Adapter | What it actually does | Real HTTP? |
|---|---|---|
| `productApi.js` | Re-exports the ten helpers from `src/data/products.js` (~40 products, 1797 lines). Axios bodies present but commented out. | No |
| `homeApi.js` | Returns objects from `src/data/homeData.js`. | No |
| `footerApi.js` | Returns `footerData` / `footerPagesData[slug]`. | No |
| `authApi.js` | localStorage fake auth. `niyaUsers` stores **plaintext passwords**; `niyaCurrentUser` is the session. Axios version commented out at the bottom. | No |
| `contentApi.js` | **Commented out top to bottom.** Still in the `api.js` barrel, so `export * from "./contentApi"` currently exports nothing. | No |
| `cartApi.js` | Real axios against `https://shieldnest.theglamstreet.in/api/cart`. **Imported by no component** — `CartContext` uses localStorage `niya_cart`. Dead code. | Yes, uncalled |
| `notFoundApi.js` | Real axios `GET /not-found-bags` on the `contentApi` instance, base `http://localhost:3001`. **`NotFoundPage.jsx:34` genuinely calls it**, so the 404 page fires a failing localhost request in production. | Yes, and failing |

Three more verified facts that shape everything below:

- `src/api/api.js` re-exports `axiosClient`, `authApi`, `cartApi`, `productApi`, `contentApi` — **not** `footerApi` or `homeApi`. `src/pages/footer/FooterPage.jsx:3` imports `getFooterPage` from `../../api/api`, which resolves to `undefined`. That component is not referenced by `AppRoutes.jsx`, so the bug is latent rather than live — but the cutover must close it.
- `src/api/orderApi.js` **does not exist**. `OrderPage.jsx:20` has a commented import of it and `OrderPage.jsx:144` a commented `await createOrder(orderPayload)`. Phase 4 is therefore *file creation*, not uncommenting.
- Two `homeApi` functions are **synchronous and consumed synchronously**: `BrandCraftsmanship.jsx:5` does `const data = getCraftsmanship();` and `CustomerReviews.jsx:5` does `const reviews = getReviews();` — no `await`, no `useEffect`. Swapping those to axios returns a Promise and both components break instantly. This is the single most important cutover detail in the repo and it is not fixable inside `src/api/`.

**The fact that governs this design:** the admin panel cannot influence a single storefront pixel on day one, and it will not be able to even after `src/api/*.js` is repointed unless three storefront components are also changed. What we build now is *the system of record plus its operator UI*. Everything else is scheduled, named, and honest.

### 1.2 (a) The BFF decision: the Next.js admin OWNS the backend

| Option | Shape | Verdict |
|---|---|---|
| **A. Next.js owns everything** | App Router + Server Actions + Route Handlers + Prisma + Postgres, one Vercel project, which also exposes the future public read API. | **CHOSEN** |
| **B. Separate API service** | NestJS/Fastify + Prisma on Render/Railway; the Next admin is a client with a token relay. | Rejected now, kept cheap to reach |
| **C. Headless CMS for content** | Sanity/Payload for home + footer, custom API for commerce. | Rejected outright |

**Against B.** The reason to split is multiple consumers plus independent scaling. Here: one operator, ~40 SKUs, one storefront, two roles. Splitting buys a second CI pipeline, a second env matrix, a second deploy target, and a cross-service auth story — before the first product row exists. It also makes every write cross the network twice (browser → Next → API → Postgres) instead of once.

**Against C.** The user asked for *one* admin panel; a CMS adds a second admin UI with its own login and fragments the audit trail. The content shapes are also hostile to generic modelling: `footerPagesData` has a **different ad-hoc shape per slug**, `promoBannersData` is already `page` + `position` targeted, ids are **inconsistently typed** (`announcements`/`reels` use numbers, `hero`/`promo` use strings), and three titles carry real `\n` characters rendered through Tailwind `whitespace-pre-line`. Modelling that in Prisma is less work than fighting a CMS's opinions.

**The honest objection to A** — "customer traffic would be served from the admin's hostname." True. The fix is a domain alias, not a second deployable:

- `admin.niyabags.com` → the admin UI (Vercel Deployment Protection on, `robots.ts` returns `noindex`)
- `api.niyabags.com` → the *same* deployment; only `/api/storefront/v1/*` is meaningful there

One build, one database, two hostnames.

#### The discipline that keeps B available later

**All business logic lives in `server/modules/*` as framework-agnostic service functions taking `(input, actor)` and returning a typed result. Server Actions and Route Handlers are thin adapters that authenticate, validate with Zod, call a service, and revalidate cache tags.** No Prisma call in a React component. No `cookies()`, `headers()`, `redirect()` or `next/*` import inside `server/modules/`. If the store outgrows Vercel functions, `server/` lifts into a Fastify app with the adapters rewritten and the domain untouched.

#### The storefront cutover story

| Phase | What happens | Touches storefront? |
|---|---|---|
| **0. Build** | Admin UI + Prisma schema + Postgres + `/api/storefront/v1/*`. Verifiable only against its own data. | No |
| **1. Seed** | One-time seeder ingests **JSON snapshots** of `products.js`, `homeData.js`, `footerData.js` committed under `prisma/seed/source/`. Mints stable `variant.id` values. Keeps `id: "handbag-001"` as the primary key. | No |
| **2. Contract parity** | Public responses are **field supersets with identical types** for every existing field. Additive only. | No |
| **3. Cutover** | Separate PR in the storefront repo: `.env` + 6 files in `src/api/` + **2 component files**. Not 10 lines. | **Yes** |
| **4. Writes** | Create `src/api/orderApi.js`, wire `createOrder`, swap `authApi.js` to its axios version, repoint the `authApi` instance. | Yes |
| **5. Trust badges** | `TrustBadges.jsx` becomes data-driven. Separate, because it needs an icon-name→component map. | Yes |

Why the seeder reads **snapshots, not the sibling folder**: `admin_panel/` is its own Vercel project with its own root directory. A relative import reaching up into `e-commerce_frontend-main/src/data/` would leave the build root and fail on Vercel, and would couple two independently deployed projects at build time. The snapshots are produced once by a local script that reads the storefront read-only (permitted — reading is not modifying) and writes `prisma/seed/source/*.json` inside `admin_panel/`.

**Phase 3, file by file (the real list):**

| Storefront file | Change | Backed by |
|---|---|---|
| `.env` | `VITE_API_BASE_URL=https://api.niyabags.com/api/storefront/v1` | — |
| `src/api/productApi.js` | Delete `data/products.js` imports, uncomment the axios block | `GET /products` + `?featured`/`?bestSeller`/`?newArrival`/`?search`/`?subcategory`/`?minPrice&maxPrice`, `/products/:id`, `/products/:id/suggestions`, `/categories` |
| `src/api/contentApi.js` | Uncomment **and repoint from the `contentApi` instance to `api`**. The commented code uses `contentApi` (mockoon `http://localhost:3001`) — uncommenting it as written points production at localhost. | 8 content endpoints |
| `src/api/homeApi.js` | Delete static returns; re-export from `contentApi.js`. **`getPromoBanners`, `getCampaign`, `getReviews`, `getCraftsmanship` must become `async`.** | same |
| `src/api/footerApi.js` | Replace static returns with `GET /footer`, `GET /pages/:slug` | net-new endpoints (no commented axios version exists) |
| `src/api/api.js` | **Add `footerApi` and `homeApi` to the barrel.** Not optional — `FooterPage.jsx` already imports `getFooterPage` from it and gets `undefined`. | — |
| `src/api/axiosClient.js` | Drop the `contentApi` instance, or repoint `mockoonBaseURL`. **One env var cannot serve both mockoon instances**: `contentApi` has no path prefix while `authApi` appends `/api/auth`, so setting `VITE_MOCKOON_API_BASE_URL` to the v1 base yields `/v1/api/auth/login`. Give customer auth its own base URL. | — |
| `src/components/home/BrandCraftsmanship.jsx` | `const data = getCraftsmanship()` → `useEffect` + state (or `use()`), because the function becomes async | — |
| `src/components/home/CustomerReviews.jsx` | Same for `getReviews()` | — |

**Three caveats stated up front, not buried.**

1. **`TrustBadges.jsx` has no data file.** Its four badges are hardcoded, and `icon` is a **React component reference** (`FiBox`, `FiShield`, `FiRefreshCw`, `FiHelpCircle` from `react-icons/fi`) — a value no database can hold. Admin-editable trust badges therefore require the component to keep an allowlisted `iconName → component` map and read `{ iconName, title, text }` from the API. This is Phase 5, scoped as a component change, not a `src/api/` repoint.
2. **Image and video paths are not uniform.** `products.js` uses raw-space relative paths (`/products/bags/handbags/WhatsApp Image ... .jpeg`); `heroBannersData` uses **percent-encoded** versions of the same paths (`%20`, `%281%29`); `craftsmanshipData.image` and `campaignData.image` are absolute Unsplash URLs; one promo banner is an external slidesdocs URL; `reelsData` mixes a local `.mp4` (with a space in the filename) against `pexels.com/download/video/*` URLs. **Committed rule:** the seeder stores an `imageUrl` that is either absolute (kept verbatim) or storefront-root-relative (kept verbatim, decoded once so raw and encoded forms converge), and a nullable `blobUrl`. The API returns `blobUrl ?? imageUrl`. Nothing is rewritten in place, so pre-cutover storefront rendering is unaffected and post-cutover images resolve identically until an operator re-uploads.
3. **Newlines are load-bearing.** `craftsmanshipData.title`, `campaignData.title` and `heroBannersData[1].title` contain real `\n`, rendered via `whitespace-pre-line` at `BrandCraftsmanship.jsx:19` and `CampaignSpotlight.jsx:78`. Every admin editor for these fields is a `Textarea` with newline-preserving validation. A single-line `Input` silently collapses the layout.

#### What the public API exposes at Phase 2

| Endpoint (`/api/storefront/v1`) | Replaces | Visibility rule |
|---|---|---|
| `GET /products`, `/products/:id`, `/products/:id/suggestions`, `/categories` | `productApi.js` commented block | **Published only.** `costPrice`, `supplierNote`, internal flags never serialized |
| `GET /hero-banners`, `/promo-banners`, `/announcements`, `/campaign`, `/reels`, `/craftsmanship`, `/reviews`, `/not-found-bags` | `contentApi.js` commented block | Active/published only; `isActive:false` rows omitted, matching today's client-side filtering |
| `GET /footer`, `GET /pages/:slug` | `footerApi.js` | Net-new; `/pages/:slug` returns the per-slug ad-hoc shape verbatim or `null` |
| `POST /orders` | the commented `createOrder` | Phase 4 |
| `/auth/*` (customer) | `authApi.js` axios version | Phase 4, **separate cookie and separate host path from the admin's Auth.js session** |

`GET /categories` keeps returning the derived `{ gender, name, filter, image, count }` shape, computed server-side exactly as `getCategories()` does today (group by `gender + "-" + subcategory`; image falls through to `variants[0].images[0]`). Collections are a *new* entity alongside it, not a replacement.

**Contract parity rules, stated precisely** (the draft's "byte-compatible superset" is a contradiction):
- Every field that exists today keeps its name, JSON type, and null semantics (`salePrice: null`, not `0`; `announcements.id` stays a number, `hero.id` stays a string).
- New fields (`sku`, `stock`, `status`, `updatedAt`, `variants[].id`) are **additive**; no storefront code reads them at Phase 3.
- `variants[].name` is **frozen as an identifier**, not just a label: `ShopPage.jsx` filters `selectedColors` against it and `WishlistContext` keys entries as `productId-color`. Renaming "Black" to "Jet Black" in the admin orphans wishlist entries. The variant editor warns on rename and the audit log records it.
- `orderCount`, `rating`, `reviewCount` are hardcoded seed values in `products.js`, and `getBestSellerProducts()` sorts by `orderCount`. They stay editable **editorial** fields, labelled as such in the UI, until Phase 4 produces real orders.

### 1.3 (b) Folder structure for `admin_panel/`

```
admin_panel/
├── app/
│   ├── (auth)/
│   │   ├── layout.tsx                    centred card, no shell
│   │   ├── login/page.tsx
│   │   └── _components/login-form.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx                    shell: sidebar + topbar
│   │   ├── loading.tsx  error.tsx
│   │   ├── page.tsx                      overview + the only KPIs that are real yet
│   │   ├── _components/                  app-sidebar, topbar, breadcrumbs, command-menu
│   │   ├── catalog/
│   │   │   ├── layout.tsx                section tabs
│   │   │   ├── products/
│   │   │   │   ├── page.tsx  loading.tsx  error.tsx
│   │   │   │   ├── new/page.tsx
│   │   │   │   ├── [productId]/page.tsx  not-found.tsx
│   │   │   │   └── _components/          product-table, filters-bar, variant-editor
│   │   │   ├── collections/[collectionId]/
│   │   │   └── inventory/page.tsx
│   │   ├── orders/[orderId]/
│   │   ├── customers/[customerId]/
│   │   ├── marketing/sale/
│   │   ├── content/
│   │   │   ├── layout.tsx
│   │   │   ├── home/{hero-banners,promo-banners,announcements,campaign,
│   │   │   │        reels,craftsmanship,reviews,trust-badges}/
│   │   │   ├── pages/[slug]/
│   │   │   ├── footer/
│   │   │   └── not-found/
│   │   └── settings/{general,shipping,team,audit-log}/
│   ├── unauthorized/page.tsx
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts
│   │   ├── storefront/v1/                PUBLIC, CORS, cached. The cutover target.
│   │   ├── internal/upload/route.ts
│   │   └── health/route.ts
│   ├── layout.tsx  not-found.tsx  global-error.tsx  robots.ts
├── components/
│   ├── ui/                               shadcn primitives ONLY (generated)
│   └── shared/                           data-table, page-header, empty-state,
│                                         money.tsx (INR), confirm-dialog, image-field
├── server/                               'server-only'. The extractable core.
│   ├── modules/{catalog,orders,customers,content,marketing,settings,identity}/
│   │     each: service.ts | repository.ts | schema.ts | mappers.ts
│   ├── db/{client.ts,transaction.ts}
│   ├── auth/{config.ts,guards.ts,password.ts}
│   ├── storage/blob.ts
│   ├── audit/logger.ts
│   ├── cache/tags.ts
│   └── errors.ts
├── lib/                                  isomorphic, no DB, no secrets
│   └── utils.ts  format.ts  slugify.ts  search-params.ts  constants.ts
├── types/                                domain types + frozen storefront contract types
├── config/                               nav.ts, site.ts, order-status.ts, roles.ts
├── prisma/
│   ├── schema.prisma  migrations/
│   └── seed/{index.ts, source/*.json}    snapshots of products/home/footer data
├── env.ts                                @t3-oss/env-nextjs + zod
├── middleware.ts                         session gate + CORS preflight
├── tests/{unit,e2e}/
└── components.json  next.config.ts  tsconfig.json
```

| Directory | Belongs here | Does NOT belong here |
|---|---|---|
| `app/` | Routing, layouts, page composition, thin adapters | Business logic, Prisma calls, Zod schemas |
| `app/**/_components/` | Components used by exactly one segment (underscore = excluded from routing) | Anything a second segment imports — promote to `components/shared/` |
| `components/ui/` | shadcn generated primitives, untouched except theming | Hand-written app components |
| `components/shared/` | Reused by two or more sections | Section-specific tables and forms |
| `server/` | Domain logic, Prisma access, guards, audit. `server-only` | React, `cookies()`, `next/navigation` — keeps it liftable to Fastify |
| `lib/` | Pure functions safe on both sides (INR formatting, slug, param parsing) | Secrets, DB, anything importing `server/` |
| `types/` | Domain types + the frozen storefront response contract | Prisma-generated types (import from `@prisma/client`) |
| `config/` | Static declarative config: nav tree, order status enum, role matrix | Runtime env reads — those live in `env.ts` |
| `prisma/` | Schema, migrations, seeder, committed source snapshots | Query helpers (those are repositories) |

**Cut from the draft's tree, with reasons:** `catalog/media` as a browsable asset library → **[LATER]**, uploads happen inline in product/content forms and a grid earns its place past ~200 assets. `settings/api-keys` → **cut**, there is one revalidation secret and it lives in Vercel env, rotated there. `analytics/` as its own section → **folded into `/`**, because every chart would be empty until Phase 4. `@modal` parallel slot and both intercepting routes → **[LATER]** (see 1.4).

### 1.4 (c) Route map

Auth column: **Public** | **ADMIN**. There are exactly two roles. A signed-in `USER` never reaches the dashboard; it is redirected to `/unauthorized`.

#### Auth and system

| Path | Purpose | Auth | Rendering | Notes |
|---|---|---|---|---|
| `/login` | Credentials sign-in | Public | Server shell + client form | Redirects to `/` if an ADMIN session exists |
| `/unauthorized` | Authenticated `USER` hit an admin route | Any session | Server | Distinct from 401; explains and offers sign-out |
| `/api/auth/[...nextauth]` | Auth.js v5 handler | Public | Route Handler | — |
| `/api/health` | Liveness + `SELECT 1` | Public | Route Handler | Monitor target |
| `*` (`not-found.tsx`) | 404 | inherits | Server | Root + `catalog/products/[productId]` |

#### Dashboard and catalog

| Path | Purpose | Auth | Rendering | Notes |
|---|---|---|---|---|
| `/` | Overview | ADMIN | Server, streamed cards | **Honest by construction:** until Phase 4 the only real numbers are catalog counts (products, published/draft, on-sale, low stock, missing images). Revenue/orders cards render a labelled "no orders yet — storefront not connected" state, never a zero that looks measured |
| `/catalog/products` | List, filter, bulk actions | ADMIN | Server table + client filter bar | Filters mirror `ShopPage.jsx` exactly: `subcategory`, `gender`, price range, plus its four "availability" toggles which are **not stock** — they are `sale` / `featured` / `best-sellers` / `new-arrivals`. Admin adds `status` and `stock`. URL state via `nuqs` |
| `/catalog/products/new` | Create | ADMIN | Client form, Server Action submit | `react-hook-form` + `zodResolver`. Id follows the `<subcategory>-NNN` convention; variants get server-minted ids |
| `/catalog/products/[productId]` | Edit | ADMIN | Server fetch + client form | Tabs: Details / Variants / Media / Pricing / SEO. `notFound()` on unknown id. Variant rename warns about wishlist keys |
| `/catalog/collections` | **Real** collection entity | ADMIN | Server | `getCategories()` today *derives* facets by grouping `gender + "-" + subcategory` — there is no description, banner, slug, SEO or ordering anywhere. This creates that entity; `GET /categories` keeps returning the derived shape |
| `/catalog/collections/[collectionId]` | Edit collection | ADMIN | Server + client form | Ordering is a numeric `position` field in v1. Drag-and-drop reordering → **[LATER]**, `dnd-kit` is not worth it for 5 collections |
| `/catalog/inventory` | Stock and low-stock threshold | ADMIN | Server table, inline client edit | **Net new** — no stock field exists on any product. Admin-internal until a storefront change consumes it; do not imply it gates checkout |

#### Orders, customers, marketing

| Path | Purpose | Auth | Rendering | Notes |
|---|---|---|---|---|
| `/orders` | List, status filter, search by `NIYA-*` | ADMIN | Server table | **Empty until Phase 4.** Orders live in localStorage `niyaOrders` today and never leave the device. Status vocabulary in the storefront is exactly one value: `ORDER PLACED` |
| `/orders/[orderId]` | Items, shipping (`pinCode`, `state`), timeline | ADMIN | Server | `paymentMethod: "ONLINE"` is a radio option only — **no gateway is integrated anywhere**. Render as "payment not collected — no gateway integrated", never as paid. `date` is a `toLocaleString("en-IN")` string today; the API stores ISO and formats on display |
| `/customers` | Customer list | ADMIN | Server table | **Empty until Phase 4.** Derived from order `shippingDetails.email`; `niyaUsers` is device-local and its plaintext passwords are not migrated |
| `/customers/[customerId]` | Profile, order history, lifetime value | ADMIN | Server | No server-side cart or wishlist exists to display — both are localStorage-only. Do not build panels for them |
| `/marketing/sale` | Bulk `isOnSale`, `salePrice`, `discountPercentage` | ADMIN | Server table + client bulk bar | Backs `/sale`, which filters `getAllProducts()` by `isOnSale`. Validates `salePrice < price` and recomputes `discountPercentage` |
| `/marketing/discounts` | — | — | — | **Out of scope.** No coupon, campaign or discount-rule entity exists. Do not build it |

#### Content

| Path | Purpose | Auth | Rendering | Notes |
|---|---|---|---|---|
| `/content/home` | Section index with published/draft badges | ADMIN | Server | Each card links to its editor and shows last-edited actor |
| `/content/home/hero-banners` | `{id,image,title,subtitle,buttonText,buttonLink}` | ADMIN | Client list + form | `title` is a `Textarea` (hero-2 contains `\n`). Ordering is new; today it is array order. Image paths here are percent-encoded — preserved verbatim |
| `/content/home/promo-banners` | `{id,page,position,image,title,alt,isActive}` | ADMIN | Client | Already `page` (home/shop/wishlist) + `position` (after-hero/after-products) targeted. Model it exactly; both fields are constrained selects, not free text |
| `/content/home/announcements` | `{id:number,text}` ticker | ADMIN | Client | Id stays numeric in the API response |
| `/content/home/campaign` | Singleton `{eyebrow,title,description,image,buttonText,buttonLink}` | ADMIN | Client form | `title` contains `\n` → `Textarea` |
| `/content/home/reels` | `{id:number,video,title,isActive}` | ADMIN | Client | Mixed local `.mp4` and Pexels download URLs; keep the URL field free-form with a URL-or-path validator, not a strict URL check |
| `/content/home/craftsmanship` | Singleton, `description: string[2]`, 3 stats | ADMIN | Client form | `title` → `Textarea`. `description` is a fixed 2-item array; stats are exactly 3. Enforce arity, do not generalize to n |
| `/content/home/reviews` | `{name,location,text}` | ADMIN | Client | **No rating, no product link, no date, no verification** in the shape. These are editorial testimonials. **No moderation queue** |
| `/content/home/trust-badges` | `{iconName,title,text}` | ADMIN | Client | **Hardcoded in `TrustBadges.jsx`; `icon` is a react-icons component reference.** Admin edits are inert until the Phase 5 component change adds an icon-name map. The editor says so on the page |
| `/content/pages` and `/content/pages/[slug]` | `about`, `our-story`, `contact`, `faq`, `shipping-returns`, `size-guide`, `legal` | ADMIN | Server + client editor | Each slug has a *different* ad-hoc shape; `faq` alone carries `faqs:[{question,answer}]`. **Per-slug Zod schema and per-slug form**, not one generic page model. Slugs are a fixed enum — the storefront routes them individually |
| `/content/footer` | brand, 4 social links, ABOUT / CUSTOMER CARE sections, legal links, copyright | ADMIN | Client form | Link `path` values must stay in the storefront's route set; validate against a committed list |
| `/content/not-found` | 404 bag picks | ADMIN | Client | Backs `GET /not-found-bags` — the one content endpoint the storefront already calls. Fixing its base URL is the cheapest possible cutover proof |

#### Settings

| Path | Purpose | Auth | Rendering | Notes |
|---|---|---|---|---|
| `/settings/general` | Store name, currency (INR, fixed), timezone (IST, fixed) | ADMIN | Client form | Currency and timezone are displayed and locked, not configurable |
| `/settings/shipping` | Shipping fee + free-shipping threshold | ADMIN | Client form | `OrderPage.jsx` computes `shippingFee` client-side today; this becomes its source at Phase 4, and `TrustBadges` advertises "Orders over ₹10,000" — the two must agree |
| `/settings/team` | ADMIN and USER accounts, invite, deactivate | ADMIN | Server + client dialogs | Exactly two roles. No manager/editor/moderator. Cannot demote or deactivate the last ADMIN |
| `/settings/audit-log` | Immutable actor / action / entity / before-after diff | ADMIN | Server, cursor-paginated | Justifies "enterprise-grade" more than any UI polish, and it is the only defence when one person has full write access |

#### File conventions and parallel routes

| Convention | Placement | Why |
|---|---|---|
| `loading.tsx` | `(dashboard)/` and every list route | Shell paints instantly; only the table streams |
| `error.tsx` | `(dashboard)/` + each section root | A Prisma error in `/orders` must not blank the sidebar |
| `global-error.tsx` | `app/` | Root layout crashes only |
| `not-found.tsx` | root + `catalog/products/[productId]` | `notFound()` on an unknown `handbag-0xx` |
| `@modal` + intercepting routes | **[LATER]** | Deferred, not adopted. With ~40 products the list is a single page, and `/orders` is empty until Phase 4 — interception would be routing complexity guarding scroll state that barely exists. Revisit when the catalog passes ~150 products or orders are real. If adopted, `@modal/default.tsx` **must** return `null` or the slot 404s on non-intercepted navigation |
| Parallel slots for KPI panels | **rejected** | `Suspense` gives the same streaming at a fraction of the routing cost |

### 1.5 (d) Layout architecture

| Layer | File | Type | Contents |
|---|---|---|---|
| Root | `app/layout.tsx` | Server | `<html suppressHydrationWarning>`, `next/font` (self-hosted), `next-themes` provider (the storefront already ships dark mode via `ThemeContext` — match it), `sonner` `<Toaster />`, `NuqsAdapter`. **No `SessionProvider`** — sessions are read server-side via `auth()`; a client provider would push the tree client-side |
| Auth | `(auth)/layout.tsx` | Server | Centred `Card`, brand mark, no nav. Redirects to `/` when an ADMIN session exists |
| Shell | `(dashboard)/layout.tsx` | Server | Resolves the session **once** via `auth()`, enforces `role === "ADMIN"` (redirect to `/unauthorized` for `USER`, to `/login` for anonymous), passes `{name, email, role}` down as props. Reads the `sidebar_state` cookie server-side so a collapsed sidebar does not flash open. Renders `SidebarProvider` › `AppSidebar` + `SidebarInset` › topbar + `{children}` |
| Section | `catalog/layout.tsx`, `content/layout.tsx`, `settings/layout.tsx` | Server | Section heading + persistent sub-nav (`Tabs` for catalog and content, vertical nav for settings). Persistent layouts mean tab switching does not re-render the shell |

**The layout guard is not the security boundary.** `middleware.ts` does a cheap cookie check for redirect UX, the dashboard layout does a real session check, and **every service function in `server/modules/` re-checks `actor.role` itself**. A layout guard protects rendering, not data; Server Actions are POST endpoints reachable without ever rendering a layout.

**Shell composition, with real shadcn parts:**

- `AppSidebar` — `Sidebar`, `SidebarGroup`, `SidebarMenu`, `Collapsible`. The nav tree is declared once in `config/nav.ts` and consumed by the sidebar, the breadcrumbs and the command menu, so they cannot drift.
- Topbar — `SidebarTrigger`, `Separator`, `Breadcrumb`, command-menu button, `DropdownMenu` user menu, theme toggle.
- `CommandMenu` — shadcn `Command` (cmdk) in a `CommandDialog` bound to `Cmd/Ctrl+K`, **v1 scope: static nav entries only**, sourced from `config/nav.ts`. Debounced product/order search → **[LATER]**, once there is enough data for scanning to beat the filter bar.
- Breadcrumbs — derived from `usePathname()` against `config/nav.ts`. The trailing `[productId]` segment is replaced by the entity title passed down from the page's server fetch, not re-fetched on the client.

**Where `Suspense` goes, and where it does not:**

| Boundary | Fallback | Reason |
|---|---|---|
| Around each overview card | `Skeleton` | Independent queries; the slowest must not gate the rest |
| Around the products/orders/customers table body | table `Skeleton` | Header, filter bar and "New product" stay interactive during refetch |
| Around sidebar badge counts (low stock, drafts) | none, count hidden | Nav must render at once; a count is not worth blocking on |
| Around the whole dashboard shell | **no** | That is `loading.tsx`'s job; wrapping the shell defeats persistent layouts |
| Around forms on `[productId]` | **no** | Fetch in the Server Component and hydrate `defaultValues` once. A streamed form flashes empty inputs |

### 1.6 (e) Environment variables and Vercel deployment

#### Auth.js v5, committed specifics

Credentials provider (email + password, Argon2id), which **requires the JWT session strategy** — Auth.js does not support database sessions with Credentials, so **no Prisma adapter is installed**; the `User` table is ours and the authorize callback queries it directly. This is also what lets `middleware.ts` run without importing Prisma. Session: 8-hour max age, rolling refresh. `role` is written into the token at sign-in and re-read from the database on refresh so a demotion takes effect within one refresh rather than at expiry. Only `AUTH_*` v5 variable names are used; `NEXTAUTH_*` (v4) appear nowhere.

#### Variables

| Variable | Scope | Required | Purpose |
|---|---|---|---|
| `DATABASE_URL` | Server | yes | Pooled Postgres connection |
| `DIRECT_URL` | Server | yes | Unpooled connection for `prisma migrate` only |
| `AUTH_SECRET` | Server | yes | Auth.js JWT/cookie encryption |
| `AUTH_URL` | Server | prod only | Canonical `https://admin.niyabags.com` |
| `AUTH_TRUST_HOST` | Server | preview | `true` so per-deployment preview hostnames validate |
| `STOREFRONT_ORIGINS` | Server | yes | Comma-separated CORS allowlist for `/api/storefront/v1/*` |
| `REVALIDATE_SECRET` | Server | yes | Bearer token for manual cache-tag invalidation |
| `BLOB_READ_WRITE_TOKEN` | Server | yes | Product and banner image uploads |
| `NEXT_PUBLIC_APP_URL` | **Client** | yes | Absolute URLs in client-built links |
| `NEXT_PUBLIC_STOREFRONT_URL` | **Client** | yes | "View on store" deep links from a product row |

Validated with `@t3-oss/env-nextjs` + `zod` in `env.ts`, imported from `next.config.ts` so **the build fails at boot on a missing or malformed variable** rather than 500ing at 2am when the operator opens `/orders`. `server/db/client.ts` imports the `server-only` package, so importing it from a Client Component becomes a *compile* error rather than a leaked connection string.

#### Vercel considerations for a separately deployed admin

**CORS.** Post-cutover the storefront calls `api.niyabags.com` cross-origin. Handle preflight in `middleware.ts`, matched to `/api/storefront/v1/*` only (the matcher excludes `/api/auth`, `_next`, and static assets). Echo the request `Origin` when it matches `STOREFRONT_ORIGINS`, never `*`, and always send `Vary: Origin` — without it the CDN caches a response bearing one origin's `ACAO` and serves it to another. Product and content reads are anonymous and need no credentials. **Phase 4 is different**: the storefront's `cartApi` and `authApi` instances set `withCredentials: true`, which requires `Access-Control-Allow-Credentials: true`, an exact echoed origin (never `*`), and a customer cookie with `SameSite=None; Secure` because `niyabags.com` → `api.niyabags.com` is cross-site. That customer cookie is a **different cookie, different name, different issuer** from the admin session.

**Cookie scoping.** The admin session cookie is host-only on `admin.niyabags.com`: `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, with the `__Host-` prefix. Auth.js v5 defaults to `__Secure-authjs.session-token` in production, so `__Host-` requires an explicit `cookies.sessionToken` override in the auth config — it is not free. **Never** set `Domain=.niyabags.com`: that ships an ADMIN cookie to the public storefront and every future subdomain, turning any storefront XSS into full admin compromise.

**Preview environments.** Preview hostnames are per-deployment: set `AUTH_TRUST_HOST=true` and no hardcoded `AUTH_URL` on preview. Point previews at a **branched database**, never production — a preview running `prisma migrate deploy` against prod is the classic way to lose a catalog. Enable Vercel Deployment Protection so preview URLs are not publicly reachable, and ship `robots.ts` with `noindex` for the admin host.

**Database pooling on serverless.** Each concurrent invocation opens its own connection; a modest spike exhausts Postgres.

1. **Preferred:** Neon + `@prisma/adapter-neon` over HTTP — stateless, no pool to exhaust, well matched to the short read-heavy queries an admin issues.
2. **Fallback:** PgBouncer in transaction mode with `?pgbouncer=true&connection_limit=1`, plus the separate unpooled `DIRECT_URL`, because migrations need session-level statements PgBouncer will not proxy.

Instantiate `PrismaClient` as a module-scoped singleton guarded on `globalThis` so dev HMR does not open a pool per reload.

**Region — with the correction the draft missed.** Pin Vercel functions to `bom1` (Mumbai): this store is INR, pin-code, COD, India-only, and leaving the `iad1` default adds a transatlantic round trip to every operator click and every future product fetch. **But Neon has no India region** — its nearest is `ap-southeast-1` (Singapore, roughly 40–60 ms from Mumbai). So the committed pairing is: **Supabase `ap-south-1` (Mumbai) if we want function and database co-located**, or **Neon `ap-southeast-1` if we want the HTTP adapter's poolless simplicity**, accepting ~50 ms per query. Given this admin issues few queries per page and the storefront read path is CDN-cached anyway, **Neon `ap-southeast-1` + `bom1` functions is the default**; revisit only if p95 admin page latency exceeds 800 ms.

**Caching and failure behaviour.** Admin pages are dynamic and uncached. `/api/storefront/v1/*` responses are CDN-cached (`s-maxage=60, stale-while-revalidate=86400`) and invalidated by tag on write: `products`, `product:{id}`, `collections`, `content:home`, `content:footer`, `page:{slug}`.

Being honest about what this buys: `stale-while-revalidate` covers a *broken deploy* only for paths already in the cache and only within the window, and query permutations that were never requested still miss. **The real rollback for the coupling this design accepts is that the storefront keeps `src/data/*.js` in git after cutover** — reverting one small commit restores the fully static storefront in a single deploy, with no dependency on the admin being healthy. That, not the SWR window, is the answer to "what if the admin goes down".

#### Testing scope (committed, not aspirational)

`tests/unit` — Vitest against `server/modules/*` services with a test database: catalog CRUD, publish/unpublish visibility rules, variant-id minting, the per-slug content schemas, and a **contract test that asserts every `/api/storefront/v1` response is a field-superset with identical types against the committed `prisma/seed/source/*.json` snapshots**. That single test is what keeps the Phase 3 promise true over time. `tests/e2e` — one Playwright path: sign in as ADMIN, edit a hero banner, verify the change appears in `GET /api/storefront/v1/hero-banners`, and verify a `USER` session is redirected to `/unauthorized`.


**Decisions**

- FIX: Corrected the cutover scope. The draft called Phase 3 'a ~10-line PR confined to src/api/*.js'. Verified false: BrandCraftsmanship.jsx:5 and CustomerReviews.jsx:5 call getCraftsmanship()/getReviews() synchronously with no await, so making those adapters async breaks both components. Phase 3 is now stated as .env + 6 api files + 2 component files.
- FIX: Corrected the Phase 4 claim. The draft said 'uncomment await createOrder(orderPayload)'. Verified src/api/orderApi.js does not exist at all (only a commented import at OrderPage.jsx:20), so Phase 4 requires creating a new storefront file, not uncommenting one.
- FIX: Corrected 'both fail silently'. Verified cartApi.js is imported by no component (dead code, CartContext uses localStorage), while notFoundApi IS called at NotFoundPage.jsx:34 against http://localhost:3001 — a live failing request in production. The two are not the same case.
- FIX: Promoted the api.js barrel item from 'optional' to required. Verified FooterPage.jsx:3 imports getFooterPage from ../../api/api, which the barrel does not export, so it resolves to undefined. It is unrouted so the bug is latent, but the cutover must close it.
- FIX: Added a verified cutover trap the draft missed: axiosClient derives both the contentApi instance (no path prefix) and the authApi instance (appends /api/auth) from a single mockoonBaseURL, so one env var cannot serve both. Committed to repointing content to the `api` instance and giving customer auth its own base URL.
- FIX: Corrected the newline claim. The draft said craftsmanshipData.title 'contains an embedded newline escape rendered literally'. It is a real \n rendered through Tailwind whitespace-pre-line at BrandCraftsmanship.jsx:19 and CampaignSpotlight.jsx:78, and it affects three fields (craftsmanship.title, campaign.title, heroBannersData[1].title). Committed to Textarea editors for exactly those fields.
- FIX: Corrected and specified the image-path story. Not just 'relative paths': products.js uses raw-space paths, heroBannersData uses percent-encoded versions of the same paths, craftsmanship/campaign use absolute Unsplash URLs, one promo banner is an external slidesdocs URL, and reels mix a local .mp4 with pexels URLs. Replaced 'the seeder must normalise one way or the other' with a committed rule: store imageUrl verbatim (decoded once) plus a nullable blobUrl; API returns blobUrl ?? imageUrl.
- FIX: Corrected the ShopPage filter mapping. The draft implied availabilityFilter is stock availability; it is actually sale / featured / best-sellers / new-arrivals. Also documented that selectedColors filters on variant.name, which makes variant names load-bearing identifiers (WishlistContext keys are productId-color) and renaming them orphans wishlist entries.
- FIX: Replaced the self-contradictory 'byte-compatible superset' with explicit parity rules: identical names, JSON types and null semantics for existing fields (including announcements/reels numeric ids vs hero/promo string ids), additive new fields only.
- FIX: Added a field-visibility rule the draft omitted. Its 'GET /products returns exactly the products.js shape plus status' would have leaked draft products and cost price through the public endpoint. Public reads are now published-only with an explicit never-serialized list.
- FIX: Committed the seeder's data source. 'Imports the ~40 products' would mean a relative import out of admin_panel/ into a sibling folder, which breaks a Vercel build rooted at admin_panel/ and couples two independently deployed projects. Now: committed JSON snapshots under prisma/seed/source/, produced once by a read-only local script.
- FIX: Corrected the region advice. The draft said 'put Postgres in an India region'; Neon has no India region. Committed to Neon ap-southeast-1 (Singapore) + bom1 functions as the default, with Supabase ap-south-1 (Mumbai) as the co-located alternative, and a stated latency threshold for revisiting.
- FIX: Specified Auth.js v5 concretely instead of hand-waving. Credentials provider forces the JWT session strategy, so no Prisma adapter is installed and middleware needs no database access; 8-hour rolling session; role re-read on refresh so demotion takes effect within one refresh.
- FIX: Made the __Host- cookie claim accurate. Auth.js v5 defaults to __Secure-authjs.session-token in production, so __Host- requires an explicit cookies.sessionToken override — the draft presented it as automatic.
- FIX: Added the missing security boundary statement. The draft's guard lived in middleware and the layout only; now every service in server/modules re-checks actor.role, because Server Actions are POST endpoints reachable without rendering any layout.
- FIX: Added the Phase 4 credentialed-CORS case the draft missed. Storefront cartApi and authApi set withCredentials:true, which needs Allow-Credentials, an exact echoed origin, and a customer cookie with SameSite=None; Secure — and that cookie must be distinct from the admin session.
- FIX: Made the resilience claim honest. Replaced 'stale-while-revalidate keeps the storefront up if the admin breaks' (true only for warm paths inside the window) with the real rollback: the storefront keeps src/data/*.js in git after cutover, so reverting one commit restores a fully static storefront.
- FIX (over-engineering): Demoted both intercepting routes and the @modal slot to [LATER] — 40 products fit one page and /orders is empty until Phase 4, so interception guards scroll state that barely exists.
- FIX (over-engineering): Cut /settings/api-keys entirely (one revalidation secret, rotated in Vercel env), demoted /catalog/media to [LATER], folded /analytics into the overview because every chart would be empty until Phase 4, and reduced collection ordering to a numeric position field with dnd-kit deferred.
- FIX (over-engineering): Scoped the command menu to static nav entries in v1, deferring debounced server-side search until there is data worth scanning.
- FIX: Replaced the vague overview KPI row with an honest one — until Phase 4 the only real metrics are catalog counts; revenue/orders render a labelled 'storefront not connected' state rather than a zero that reads as measured.
- FIX: Made TrustBadges precise. Its icon values are react-icons component references (FiBox, FiShield, FiRefreshCw, FiHelpCircle), which no database can store, so admin editing needs an allowlisted iconName->component map on the storefront. Split it out as its own Phase 5.
- FIX: Added the missing storefront endpoint inventory table mapping /api/storefront/v1/* to the exact commented axios calls, marking /footer and /pages/:slug as net-new (footerApi has no commented axios version).
- FIX: Added a committed testing scope, including a contract test asserting every public response is a type-identical field superset of the committed seed snapshots — the mechanism that keeps the Phase 3 promise true over time.
- FIX: Fixed the api.niyabast.com typo and the 'no gateway' framing on the order detail page (render as 'payment not collected', and store ISO dates rather than the storefront's toLocaleString('en-IN') string).

**Open assumptions**

- The user controls DNS for niyabags.com and can alias api.niyabags.com onto the admin's Vercel project. If not, the storefront calls admin.niyabags.com directly at cutover — functional, cosmetically poor, and it makes the cookie discipline in 1.6 even more important.
- Postgres is Neon (default) or Supabase. Neon ap-southeast-1 + bom1 functions is the committed default; confirm if you would rather co-locate on Supabase ap-south-1 in Mumbai and accept a connection pooler.
- Product images move to Vercel Blob. No object storage exists today. Confirm the blob provider before the media/upload work starts, since it determines whether blobUrl values are portable later.
- Product ids stay string-shaped (handbag-001) rather than becoming cuids, so existing localStorage niya_cart and niyaWishlist keys survive cutover. New products get ids in the same <subcategory>-NNN format.
- Admin auth is credentials-based (email + password, Argon2id). No OAuth or SSO was specified. Confirm whether a Google provider is wanted for the single operator, since it removes password handling entirely.
- Existing localStorage niyaUsers records hold plaintext passwords and will NOT be migrated as credentials; customers re-register at Phase 4. Needs explicit confirmation because it means every existing device-local account is discarded.
- The Phase 3 and Phase 5 storefront changes will eventually be authorised as separate work in the storefront repo. If the storefront is permanently frozen, the admin remains a system of record with zero customer-visible effect — please agree to that now rather than at Phase 3.
- Variant names ('Black', 'Brown') are treated as frozen identifiers after cutover because ShopPage colour filtering and wishlist keys depend on them. Confirm that renaming a colour is acceptable as a rare, warned operation rather than a routine edit.
- The order status vocabulary beyond the single existing 'ORDER PLACED' value is owned by the Orders section of this blueprint; this section only reserves routes and states today's one-value reality.
- orderCount, rating and reviewCount stay operator-editable editorial fields (they are hardcoded seed values that getBestSellerProducts sorts by). Confirm that 'best sellers' being editorially controlled until Phase 4 is acceptable.

**Risks**

- The central tension is unresolved by design: nothing built in Phases 0-2 reaches a customer. If the user expects visible storefront change from admin edits before Phase 3 is authorised, this plan will read as failure regardless of quality. Get explicit agreement on the phase boundary before build starts.
- Phase 3 is no longer purely mechanical. Two components (BrandCraftsmanship, CustomerReviews) call sync adapters without await, and TrustBadges needs an icon map. Any promise of a 'src/api-only' cutover is false and should not be repeated to stakeholders.
- Single-deployable coupling: one bad admin deploy degrades the post-cutover storefront's data source. The mitigation is a git revert of the storefront's src/api commit back to static data — that requires the storefront's data files to remain in the repo, which someone will eventually be tempted to delete as dead code. Add a comment in those files saying why they stay.
- Contract drift: the public API and the frozen storefront shapes will diverge the first time someone adds a field carelessly (a null becoming 0, an id becoming a string). The seed-snapshot contract test is the only thing preventing it; if that test is skipped under deadline, Phase 3 becomes a refactor.
- Image path fidelity is fragile. Filenames contain spaces and parentheses, present raw in products.js and percent-encoded in homeData.js. A seeder that normalises inconsistently produces silently broken images only visible after cutover, on the storefront, in production.
- Variant-id minting changes cart dedupe behaviour. Today the key collapses to productId because selectedVariant?.id is always undefined; once real ids exist, a returning customer's localStorage cart contains legacy entries keyed by bare productId alongside new variant-keyed ones. The storefront cart merge behaviour at Phase 3 has not been designed and belongs in the Orders/Cart section.
- Two roles plus one operator means the ADMIN account is a single point of total compromise, with no second pair of eyes. The audit log records damage; it does not prevent it. Consider requiring a second confirmation on destructive bulk actions and hard-blocking deletion of the last ADMIN.
- Credentials auth with JWT sessions means no server-side session revocation. A stolen token stays valid until expiry. The 8-hour max age bounds it; if that is unacceptable, database-backed sessions require dropping the Credentials provider or adding a token-version check on every request.
- Cross-site cookies at Phase 4 (SameSite=None; Secure between niyabags.com and api.niyabags.com) will collide with browser third-party cookie restrictions. Customer auth may need a same-site path on the storefront domain instead, which changes the deployment topology — worth deciding before Phase 4 rather than during it.
- The Vercel + Neon cross-region hop (bom1 to Singapore) is untested at this stage. If p95 admin latency disappoints, the fix is a Supabase Mumbai migration, which means re-doing the pooling configuration rather than flipping a setting.
- Scope creep risk in Content: eight home sections, seven per-slug page schemas and a footer editor are the largest surface in this blueprint, and all of it is inert until Phase 3. If time is short, build Products, Collections and Sale first — they are the parts an operator can validate against real intent.

---

## Feature/Module Catalog and Navigation Information Architecture

### 0. The rule this section obeys

Every module ships inside the standalone `admin_panel/` Next.js App Router app **and inside the API that app owns**. Nothing here reaches the live storefront on day one: `e-commerce_frontend-main/src/data/*.js` are static arrays compiled into the Vite bundle, and the admin has no write access to them.

A draft of this section claimed the cutover is "confined to `src/api/*.js`". Reading the repo shows that is false. The real cutover has three cost classes, and every module below is planned against them:

| Class | Cost | Surfaces (verified) |
|---|---|---|
| **A — adapter only** | Repoint one function body; call sites already `await`. | Products & categories (`productApi.js`), hero banners, promo banners, announcements, campaign, reels payload, footer, all footer pages, 404 bags |
| **B — adapter + component edit** | The consumer calls the adapter **synchronously during render**, so making it async breaks it. | `BrandCraftsmanship.jsx:5` → `const data = getCraftsmanship();` and `CustomerReviews.jsx:5` → `const reviews = getReviews();` |
| **C — new storefront code** | No adapter and no consumer exists at all. | Trust badges (hardcoded in `TrustBadges.jsx`); orders (`MyOrders.jsx` imports no API and reads `localStorage["niyaOrders"]`; `src/api/orderApi.js` does not exist — `OrderPage.jsx:18` imports it in a comment); reels `isActive` (`ReelsSection.jsx:23` filters on `reel?.video` and ignores the flag); cart variant identity (`CartContext.jsx`) |

Three further corrections that change the plan:

1. **`src/api/contentApi.js` is dead code.** It is fully commented out *and nothing imports it*. The live adapter for all seven home-content sections is **`src/api/homeApi.js`** — real, uncommented, returning static objects, and not in the `api.js` barrel. `homeApi.js` is the cutover target; `contentApi.js` is a decoy.
2. **`footerPagesData` has eight keys, not seven, and none of them is `legal`:** `about`, `our-story`, `contact`, `shipping-returns`, `size-guide`, `faq`, `privacy-policy`, `terms-of-use`. `LegalPage.jsx:10` derives the slug from `location.pathname`, so `/privacy-policy` and `/terms-of-use` are two real records. `SizeCarePage.jsx:13` hardcodes `getFooterPage("size-guide")`, so **`/care-guide` silently renders size-guide content and no `care-guide` record exists anywhere.**
3. **Orders and customers have no source of data until cutover.** Checkout writes to `localStorage["niyaOrders"]` on the shopper's own device; that data is unreachable by any server, ever. An Orders module that only lists what checkout sends would be an empty screen for months. This is the single largest hole in the draft and is fixed in §1.1 by making **manual order and customer entry a NOW capability** — which matches how this store actually takes COD orders today (phone, Instagram, WhatsApp) and makes the admin useful on day one rather than at cutover.

---

### (a) Module catalog

#### 1.1 NOW — the v1 surface

| # | Module | Scope | Why NOW |
|---|---|---|---|
| 1 | **Auth & access** | Auth.js v5 Credentials + JWT session carrying `role`. Exactly `ADMIN` and `USER`. **The entire panel is ADMIN-only** — there is no partial-access surface. | Gate |
| 2 | **Dashboard** | Five tiles, all sourced from the admin's own DB: orders needing action, orders today, COD vs ONLINE split, revenue 7/30d, low-stock variants. A sixth tile is the **Cutover status** strip (module 13). | Gate |
| 3 | **Products** | CRUD over the real product entity plus the fields static data lacks: `sku`, `status` (DRAFT/PUBLISHED/ARCHIVED), `stock`, `tags[]`, `metaTitle`, `metaDescription`, `costPrice`, `weightGrams`, `position`, `updatedAt`, `hsnCode`. Preserves every existing field verbatim, including the **denormalised `orderCount`, `rating`, `reviewCount`, `createdAt`** (see 1.4 — the storefront's Best Sellers and New Arrivals facets are computed from these, so the admin must keep them authoritative or those facets break at cutover). | Gate |
| 4 | **Variants** (tab in the product editor) | Per-variant `id` (cuid), `colorName`, `colorHex`, `sku`, `stock`, `images[]`, `position`. Server-minted stable ids are a **necessary precondition** for fixing the cart — but not sufficient; see 1.4. | Gate |
| 5 | **Merchandising** | `isFeatured`, `isOnSale` + `salePrice` + `discountPercentage`. These two flags — and only these two — map cleanly to storefront behaviour (`ShopPage.jsx:210,213` and `/sale`). | Gate |
| 6 | **Media library** | Upload to Vercel Blob, return CDN URLs, alt text, dimensions, per-image reuse count. Existing images are `/products/bags/handbags/WhatsApp Image 2026-08-17 at 5.37.34 PM.jpeg` — spaces in filenames, served from the storefront's own `public/`. The admin **cannot and must not write there**; new images get CDN URLs, legacy `public/` paths are stored as-is and pass through untouched until someone re-uploads them. |
| 7 | **Orders** | List, detail, status transitions, COD confirmation call log, packing slip / invoice print, internal note, **and manual order creation**. The admin *defines* the status vocabulary because the storefront ships exactly one literal: `"ORDER PLACED"`. | Gate + only real data source pre-cutover |
| 8 | **Customers** | Directory: profile, addresses, order history, lifetime value, COD refusal count. Manual create (a phone order creates a customer). One-time importer for a pasted `localStorage["niyaUsers"]` export — that array holds **plaintext passwords** and has **no `role` field**; imported rows land as `USER` with a forced password reset and **no hash is ever carried across**. | Gate |
| 9 | **Storefront content** | Hero banners, promo banners (already `page` × `position` targeted), announcements, campaign, craftsmanship, reels, testimonials, trust badges, 404 bags, category tiles. See 1.3. | The user's headline ask |
| 10 | **Pages** | The eight real `footerPagesData` slugs, normalised onto a block model. Each page's shape is ad hoc today. Includes creating the missing `care-guide` record. | Gate |
| 11 | **Navigation & footer** | `footerData`: brand blurb, four social links, ABOUT / CUSTOMER CARE sections, customer-service block, legal links, copyright. | Gate |
| 12 | **Settings** | Store identity, free-shipping threshold, flat shipping fee, COD toggle + COD review ceiling, low-stock threshold, GSTIN + `gstRatePercent` (**invoice display only** — `OrderPage.jsx` has no tax line and computes `subtotal + shippingFee`, so a tax *calculation* setting would be fiction pre-cutover), controlled colour vocabulary, public-API tokens. **Real contradiction this resolves:** `TrustBadges.jsx` hardcodes "Free Shipping — Orders over ₹10,000" while `OrderPage.jsx:77` computes `subtotal >= 2000 \|\| subtotal === 0 ? 0 : 100`. Two numbers, two files. One setting owns both after cutover. | Gate |
| 13 | **Cutover console** | A read-only screen listing every storefront surface, its class (A/B/C), the admin endpoint that would feed it, and whether that endpoint is live. The honest answer to "is the admin controlling my site yet?" lives on one page instead of in tribal memory. | Owns the central tension |
| 14 | **Public content API** | The read API the storefront will eventually call: versioned, token-authenticated, returning **the exact shapes the existing adapters already return**, so class-A cutover is a body swap and not a refactor. Built and testable now, consumed by nobody. | Makes cutover mechanical |
| 15 | **Activity log** | Append-only `actor`, `action`, `entityType`, `entityId`, `before`, `after`, `at`. Scoped to a fixed entity list (product, variant, order, content block, page, settings), not universal instrumentation. | Content publishing mutates a live shop with no git history behind it |
| 16 | **Notifications** | In-app bell only. See (e). | Gate |
| 17 | **Command menu + search** | See (c) and (f). | Gate |

#### 1.2 NEXT — real, but not week one

| # | Module | Why deferred, in one line |
|---|---|---|
| 18 | Inventory screen (bulk adjust, movement ledger) | The `stock` *field* is NOW on the variant; at ~40 products a filtered product table is the screen. |
| 19 | Returns / RMA | `TrustBadges` promises "30-day returns" with no mechanism; needs a real order history first. |
| 20 | Category / Collection as a first-class entity | `getCategories()` derives tiles by grouping on `gender + "-" + subcategory` (`products.js:1766`) with the image taken from the first matching product. A NOW **category-tile settings screen** (title, image, position, per gender+subcategory pair) returns that exact shape and is enough; slug/description/SEO on a real `Category` row earns its place only when the storefront gets category landing pages, which it does not have. |
| 21 | Reviews moderation | `reviewsData` is three hardcoded testimonials with no rating, date, or product link, while products carry denormalised `rating`/`reviewCount`. NOW is admin-authored testimonials (module 9); customer-submitted reviews need a storefront form that does not exist. |
| 22 | Discounts & coupons | `OrderPage` has no coupon field — a code the storefront cannot accept is a dead feature. Per-product sale pricing already powers `/sale`. |
| 23 | Transactional email (Resend + React Email) | Written against real order data, after orders exist. |
| 24 | Analytics | Revenue by subcategory, COD refusal rate, sell-through per variant. Needs 60+ days of real orders before it says anything true. |

#### 1.3 LATER — scaffold or stub only

| # | Module | Decision |
|---|---|---|
| 25 | Payments & refunds | No gateway exists anywhere; `"ONLINE"` is a radio button that does nothing. Put `payment { method, status, providerRef }` on Order so Razorpay is additive later. **Build no UI.** |
| 26 | CSV import/export | At 40 SKUs the form is faster. Earns its place at ~300 SKUs or at accountant handoff. Order CSV export moves to NEXT the day the store files GST returns from the panel. |
| 27 | Webhooks / outbound events | One consumer (the storefront revalidation hook) does not justify an event bus. Direct call at cutover; bus if a second consumer appears. |
| 28 | Full-text search vendor | See (f). |

#### 1.4 Corrections to claims a naive plan would make

Four things that look true and are not. Each one changes a module's scope:

- **Variant ids alone do not fix the cart.** `CartContext.getVariantKey` does key on `productId + "-" + selectedVariant?.id`, which is always `undefined` today. But `addToCart` (`CartContext.jsx:74–108`) also has a `hasExisting` branch that matches on **bare `productId`** and, when it hits, *filters the existing line out and replaces it*. So adding a second colour does not merge the lines — it **destroys the first one**. Minting stable variant ids is necessary and belongs in the data model NOW, but the fix is inside `CartContext.jsx`: class C, forbidden today, and explicitly **not** part of the `src/api/*.js` cutover. The admin plan states this and does not take credit for it.
- **The four "Availability" checkboxes are not four flags.** `featured` → `isFeatured` and `sale` → `isOnSale` are flags. `new-arrivals` is a **30-day `createdAt` window computed in `ShopPage.jsx:219–224`**. `best-sellers` is **the top 8 by `orderCount`** from `getBestSellerProducts`. Adding `isBestSeller` / `isNewArrival` override booleans would change storefront semantics and require a `ShopPage` edit — so those overrides are **LATER, post-cutover**. What the admin owes instead is keeping `createdAt` and `orderCount` accurate, which is a data obligation, not a feature. (Also worth noting: that filter group is labelled "Availability" and contains zero stock logic, because stock does not exist in the storefront at all.)
- **The colour-facet bug is case, not whitespace.** `ShopPage.jsx:106–116` already calls `v.name.trim()`, so a trailing space cannot create a phantom chip. What it does not do is normalise case: the `Set` is keyed on raw case while the match at `ShopPage.jsx:202–207` lowercases both sides. So `"Black"` and `"black"` produce **two chips that return identical results**, forever, with no way to merge them from the storefront. That is what the controlled colour vocabulary in Settings prevents — ten rows of config, one permanent facet defect avoided.
- **`notFoundApi.js` is "live" but not working.** It really does issue HTTP, but against the `contentApi` axios instance, which points at the mockoon base `http://localhost:3001/api` — dead in production. It is class A (the call site awaits), but nobody should record it as a surface that currently functions.

#### 1.5 Explicit exclusions

| Excluded | Why not, for this store |
|---|---|
| Multi-warehouse | One seller, one stock pool; location adds a join to every stock read for zero benefit. |
| Multi-vendor / marketplace | Niya Bags sells only its own goods; no vendor entity exists or is planned. |
| B2B / tiered pricing | No wholesale channel; `price` and `salePrice` are the entire pricing model. |
| Subscriptions, loyalty, gift cards, store credit | Handbags are one-off purchases; a points ledger needs an expiry policy and a storefront redemption UI, for a shop with no repeat-purchase data yet. |
| Full tax engine | India-only, single GST band on handbags. `gstRatePercent` + `hsnCode` + GSTIN on the invoice is the whole requirement. |
| Carrier / rate-shopping APIs | Shipping is flat ₹100 with a free threshold. Manual AWB and courier-name fields on Order cover today; Shiprocket is a post-volume decision. |
| Abandoned-cart recovery | The cart is `localStorage["niya_cart"]`, device-local and anonymous. `cartApi.js` issues real HTTP but `CartContext` **never calls it** — there is nothing server-side to recover. |
| Server-side wishlist admin | `localStorage["niyaWishlist"]` is an anonymous array of `productId-color` strings with no user link. Nothing to report on. |
| Historical order import from shoppers' devices | `localStorage["niyaOrders"]` lives on each customer's browser and is unreachable by any server. Pre-cutover history is genuinely lost; manual entry is the only path. State it, do not paper over it. |
| POS, live chat, A/B testing, i18n | No storefront surface, no second locale (INR / en-IN only), no traffic volume to test against. |
| Third role (manager/editor) | Hard constraint. Every check still routes through one `can(session, action)` helper, so a future third role is a data change, not a refactor. |

#### 1.6 Content module → storefront target (the cutover contract)

| Admin module | Storefront source | Live consumer today | Class |
|---|---|---|---|
| Hero banners | `homeData.heroBannersData` | `homeApi.getHeroBanners()` ← `HeroBanner.jsx:24` (awaits) | A |
| Promo banners | `promoBannersData`, already `home\|shop\|wishlist` × `after-hero\|after-products` | `homeApi.getPromoBanners()` ← `PromoBanner.jsx:20–22` (awaits, filters `isActive`) | A |
| Announcements | `announcementsData` | `homeApi.getAnnouncements()` ← `AnnouncementBar.jsx:12` | A |
| Campaign spotlight | `campaignData` | `homeApi.getCampaign()` ← `CampaignSpotlight.jsx:16` | A |
| Craftsmanship | `craftsmanshipData` (`title` holds a literal `\n`; the editor must preserve line breaks) | `homeApi.getCraftsmanship()` ← **`BrandCraftsmanship.jsx:5`, called synchronously** | **B** |
| Testimonials | `reviewsData` | `homeApi.getReviews()` ← **`CustomerReviews.jsx:5`, called synchronously** | **B** |
| Reels | `reelsData` (mixed local `.mp4` and external Pexels URLs) | `homeApi.getReels()` ← `ReelsSection.jsx:23`, which filters on `reel?.video` and **ignores `isActive`** | A for content, **C** for the toggle |
| Category tiles | derived in `products.js:1766` from `gender + "-" + subcategory` | `productApi.getCategories()` ← `CategorySection.jsx` | A |
| Footer + 8 pages | `footerData`, `footerPagesData` | `footerApi.getFooter()` / `getFooterPage(slug)` — real adapters, **not in the `api.js` barrel** | A |
| 404 bags | none — already HTTP, to a dead mockoon host | `notFoundApi.getNotFoundBags()` | A |
| **Trust badges** | **`TrustBadges.jsx` itself — no data file, four benefits hardcoded in JSX** | none | **C** |
| **Orders** | `localStorage["niyaOrders"]` | none — `MyOrders.jsx` imports no API | **C** |

So exactly **five surfaces need storefront code** at cutover — trust badges, orders, the reels `isActive` toggle, and the two synchronous content call sites — and everything else is a body swap. That list is the Cutover console's checklist (module 13), and no module claims to reach the storefront before its row turns green.

---

### (b) Navigation IA

The obvious proposal — a flat `Dashboard / Products / Orders / Customers / Content / Settings` list — fails here for one specific reason. This store's admin work has two rhythms. **Sales work is reactive and daily**: a COD order lands, confirm it by phone, pack it. **Catalog and storefront work is deliberate and weekly**: shoot a bag, write copy, swap the hero. Flattening them parks a badge-bearing, time-critical item beside a leisurely one and trains the operator to scan past both. Group by rhythm and pin the reactive group directly under Dashboard.

```
TOPBAR ────────────────────────────────────────────────────
  [☰]  Niya Bags   [ Search orders, products…   ⌘K ]
                     … [Cutover 0/12] [↗ Store] [🔔 3] [◐] [SG ▾]

SIDEBAR  (240px expanded / 64px rail / Sheet on mobile)
  ▸ Dashboard                     LayoutDashboard
  ── SALES ────────────────────────────────────
  ▸ Orders                        ShoppingBag     badge: needs action
  ▸ Customers                     Users
  ▸ Returns             [NEXT]    Undo2           badge: open
  ── CATALOG ──────────────────────────────────
  ▸ Products                      Package
  ▸ Media                         Images
  ▸ Inventory           [NEXT]    Boxes           badge: low stock
  ── STOREFRONT ───────────────────────────────
  ▸ Home sections                 LayoutTemplate  dot: unpublished
  ▸ Banners & announcements       Megaphone
  ▸ Reels                         Clapperboard
  ▸ Testimonials                  Quote
  ▸ Pages                         FileText
  ▸ Navigation & footer           PanelBottomClose
  ▸ Cutover                       PlugZap         pill: 0/12 live
  ── SYSTEM ───────────────────────────────────
  ▸ Activity log                  History
  ▸ Analytics           [NEXT]    ChartLine
  ═══ pinned bottom ═══════════════════════════
  ▸ Settings                      Settings2
```

Cutover sits at the bottom of STOREFRONT on purpose: it is the last thing you read after editing content, and it answers "did that reach the site?" without the operator having to remember the answer.

**Route table** (all under the `(dashboard)` route group; group parentheses do **not** appear in URLs — see the middleware note below)

| Item | Route(s) | Notes |
|---|---|---|
| Dashboard | `/` | |
| Orders | `/orders`, `/orders/new`, `/orders/[orderId]` | `orderId` is the human `NIYA-…` code, not a cuid. `/orders/new` is the manual phone-order form. |
| Customers | `/customers`, `/customers/new`, `/customers/[id]` | |
| Products | `/products`, `/products/new`, `/products/[id]` | Editor uses **tabs, not sub-routes**: General · Variants · Media · Pricing · SEO · Organisation. One form, one dirty state, breadcrumb depth stays at 3. |
| Media | `/media` | |
| Home sections | `/content/home` | Tabs: Hero · Category tiles · Featured · Campaign · Craftsmanship · Trust badges · Testimonials |
| Banners & announcements | `/content/banners` | Filtered by `page` × `position`; announcements are a second tab |
| Reels | `/content/reels` | |
| Testimonials | `/content/testimonials` | |
| Pages | `/pages`, `/pages/[slug]` | 8 real slugs + the missing `care-guide` record |
| Navigation & footer | `/navigation` | |
| Cutover | `/cutover` | Read-only surface × class × endpoint-live table |
| Activity log | `/activity` | |
| Settings | `/settings/store`, `/settings/shipping`, `/settings/tax`, `/settings/colors`, `/settings/api-tokens`, `/settings/team` | |
| Search | `/search?q=` | see (f) |

**Access control.** There are two roles, and `USER` has **no** admin surface at all — so the guard is one rule, not a per-screen matrix. Middleware matches on **real path prefixes** (`/`, `/orders/:path*`, `/products/:path*`, … plus a catch-all excluding `/login`, `/api/auth`, `_next`, and static assets) — a matcher written against `/(dashboard)` would never fire, because App Router group parentheses are stripped from the URL. The `(dashboard)` server layout re-reads the session as defence in depth. The only screen with an *extra* guard is `/settings/team`, and that guard is not about role: it prevents an admin demoting or deleting the last remaining `ADMIN`.

**Badges.** One endpoint, `GET /api/admin/nav-counts`, returns `{ ordersNeedingAction, lowStock, returnsOpen, contentDrafts }`, cached 30s, revalidated by `router.refresh()` after any mutation.

- Orders badge counts orders whose status is in the pending set — "needs a human", not "total orders". A count that never reaches zero is decoration.
- Inventory badge counts variants at `stock <= settings.lowStockThreshold`; `stock = 0` renders `destructive`, the rest `secondary`; the number is the union.
- The Storefront group shows a **dot, not a number**, when unpublished drafts exist. The count is not actionable; the existence is.
- `tabular-nums`, capped at `99+`.

**Collapsed state.** 64px icon rail; group labels collapse to a `Separator`; badges become a 6px corner dot; labels move into a right-side `Tooltip`. Built on shadcn `sidebar`, with the open/closed flag in a `niya_admin_sidebar` cookie **read in the server layout**, so SSR renders the correct width. A `localStorage`-driven sidebar flashes wide-then-narrow on every navigation — the most visible polish failure in Next.js admin panels. Below `md`, the sidebar is a `Sheet` and the rail does not exist. Toggle: `⌘/Ctrl+B`.

**Topbar vs sidebar.** Sidebar = destinations. Topbar = session and environment. The topbar carries: the search trigger (a real input ≥ `lg`, an icon below), the **cutover pill** reading `Cutover 0/12` and linking to `/cutover` — a permanent, honest reminder that the panel is not yet driving the site — an external link to the live storefront, the bell, the theme toggle (the storefront already has dark mode via `ThemeContext`; the admin matches), and the user menu. **No store switcher**: there is one store, and a switcher for one item is a lie about the product's shape.

---

### (c) Command menu (⌘K)

shadcn `Command` (`cmdk`) inside a `CommandDialog`, opened by a single `keydown` listener in the app shell that ignores events originating in an input, textarea, or `contenteditable` — so `⌘K` never steals focus from a description field. No hotkey library: one listener and one context are less code than the dependency.

**Scope, committed.** v1 is a **client-side static registry of roughly 40 entries** — every sidebar route, every product-editor tab, every settings screen, plus the action verbs below. Zero network, instant filtering, and genuinely sufficient because at 40 products navigation dominates.

**The one exception, and it is the important one.** A COD store's most common admin task is *"a customer is on the phone about an order and all I have is the number they are calling from."* So ⌘K accepts a `#` prefix that routes to the server order lookup in (f) — debounced 200ms, `AbortController`-cancelled, minimum 3 characters — and also recognises a bare pasted `NIYA-…` code or a 10-digit number without the prefix. That single path is worth more day to day than the entire analytics module. Full federated entity search inside the palette is **NEXT**, and when it arrives its results append **below** the static commands so muscle memory built in v1 never breaks; a palette that reorders itself as results stream in is worse than one that never had search.

**Groups, fixed order:** Recents (last 5, `localStorage`) → Actions → Navigation → Orders (`#` results) → Settings.

**Action verbs (v1):** New product · New order · New customer · Upload media · New page · Publish home changes · Toggle theme · Toggle sidebar · Copy current page link · Sign out. Two are contextual: **Advance order status** on `/orders/[orderId]`, **View on storefront** on `/products/[id]` (deep-links `/product/:id`). Contextual verbs are contributed by the route through a `useCommandRegistry()` context, so pages register and unregister their own actions instead of a global switch statement growing forever.

**Keyboard shortcuts** — a short list that a single operator will actually retain:

| Keys | Action | Scope |
|---|---|---|
| `⌘K` / `Ctrl+K` | Command menu | Global |
| `⌘B` | Toggle sidebar | Global |
| `⌘S` | Save (with `preventDefault`) | Editor pages |
| `/` | Focus the table filter | List pages |
| `Esc` | Close dialog / sheet / palette | Global |

Deliberately cut: `g`-then-key chords, `j`/`k` row navigation, a shortcut cheat-sheet dialog, and `>`/`@`/`/` scoping prefixes. Vim-style navigation is a feature for teams of twenty on a screen they live in eight hours a day; here it is surface area nobody will learn, and every unlearned shortcut is a bug report waiting to happen.

---

### (d) Breadcrumbs and the page header

**Breadcrumbs** render in the page header, not the topbar — a topbar breadcrumb competes with search for the same horizontal band. Segments derive from the URL through a static label map; dynamic segments resolve **server-side in the page itself**, so `/products/clx8k2` paints `Products / Classic Handbag` on first render with no id flicker and no client fetch. The last crumb is `BreadcrumbPage`, truncated at 32 characters with the full title in a `title` attribute. **Depth is capped at three by design** — no route in this IA is deeper — so there is no ellipsis-collapse rule; adding one would be dead code for a case that cannot occur.

**Page header — one component, five slots.**

```
[breadcrumb]
[Title  ·  StatusPill]                 [Secondary ▾]  [Primary]
[one-line description, muted, max ~90ch]
[optional tabs row]
```

| Page | Title | Status pill | Primary | Secondary (`DropdownMenu`) |
|---|---|---|---|---|
| `/products` | Products | — | New product | Export (LATER) |
| `/products/[id]` | product title | Draft / Published / Archived | Save changes | View on storefront, Duplicate, Archive, Delete |
| `/orders` | Orders | — | New order (phone/WhatsApp) | Export CSV |
| `/orders/[orderId]` | `NIYA-1723…` | order status | Advance status — label changes with state: Confirm → Mark packed → Mark shipped → Mark delivered | Print invoice, Add note, Log COD call, Cancel order |
| `/customers/[id]` | customer name | — | Save | Create order for customer |
| `/content/home` | Home sections | Published / Unpublished changes | Publish changes | Preview, Discard changes |
| `/pages/[slug]` | page title | Published / Draft | Save | Revert to last published |
| `/cutover` | Cutover | `n/12 live` | — (read-only) | — |
| `/settings/*` | section name | — | Save | — |

Two rules matter more than the layout. **Exactly one primary action per page** — if a screen seems to need two, it is two screens. And on any dirty form the action cluster detaches into a sticky bottom bar reading "Unsaved changes · Discard · Save", paired with a `beforeunload` guard and route-change interception. Content publishing is destructive to a live shop; losing thirty minutes of hero copy to a stray back-swipe is exactly the failure this prevents.

One honesty rule the header enforces: on every storefront-content screen, the "Publish changes" button's helper text reads what publishing actually does today — *"Saves and publishes to the admin API. This surface is not yet read by the storefront (class A — adapter swap pending)."* The wording is generated from that surface's row in the Cutover console, so it cannot drift out of date, and the day the row flips the copy flips with it.

---

### (e) Notifications and alerts

**Event catalogue — only events an operator of *this* store would act on.**

| Event key | Severity | Trigger | Link |
|---|---|---|---|
| `order.placed` | info | Any new order, manual or API | `/orders/[orderId]` |
| `order.cod_high_value` | warning | `paymentMethod = COD` and `totalAmount >= settings.codReviewThreshold` | `/orders/[orderId]` |
| `order.unconfirmed_24h` | warning | Still unconfirmed 24h after creation (Vercel Cron) | `/orders/[orderId]` |
| `order.cancelled` | info | Status → cancelled | `/orders/[orderId]` |
| `inventory.low_stock` | warning | Variant crosses `stock <= lowStockThreshold` downward; once per variant per 24h | `/products/[id]` |
| `inventory.out_of_stock` | critical | Variant hits 0 while its product is PUBLISHED | `/products/[id]` |
| `product.price_anomaly` | warning | Saved with `isOnSale && (salePrice >= price \|\| salePrice <= 0)` — the storefront renders a strikethrough that would read as a price *increase* | `/products/[id]` |
| `product.missing_media` | info | PUBLISHED with a variant holding zero images | `/products/[id]` |
| `content.published` | info | Any content publish; carries the actor | `/activity` |

Cut from the draft, with reasons: `content.revalidate_failed` (there is no revalidation webhook and no storefront consumer — alerting on a pipeline that does not exist is theatre; it arrives with the cutover, not before), `system.storefront_api_error` (same — the public API has no traffic in v1; Vercel's own logging covers a service with one consumer and that consumer is nobody), `auth.admin_login_new_device` (device fingerprinting is real infrastructure — a store table, a hashing scheme, a false-positive story — for a panel with one to three named humans who all know each other), and `customer.registered` (a daily digest of signups that cannot happen pre-cutover).

Severity drives colour and grouping only: `critical` red with a persistent `Alert` on the dashboard, `warning` amber, `info` neutral. **Nothing but `critical` interrupts.**

**Shape sketch**

```
Notification {
  id, type, severity: 'info'|'warning'|'critical',
  title, body,
  entityType: 'ORDER'|'PRODUCT'|'VARIANT'|'CONTENT',
  entityId, href,
  dedupeKey,            // "low_stock:var_x9:2026-09-04" — unique index
  createdAt, expiresAt
}
NotificationRead { notificationId, adminUserId, readAt }   // composite PK
```

Read state lives in a join table rather than a `read` boolean, because a second admin must not clear the first admin's bell — and with two roles and up to three admins that is a two-column table, not an architecture. `dedupeKey` under a unique index is what stops the low-stock alert firing on every cart decrement.

**Bell UI.** Topbar `Button` + `Popover`, 380px, unread count on a `Badge` (dot-only past 9). Tabs All / Unread. Rows show a severity dot, title, relative time (`date-fns`, `en-IN`), and a click that marks read and navigates. "Mark all as read" in the header; `Separator`-grouped Today / Earlier; an inbox empty state. A full `/notifications` page is **NEXT**, when volume warrants it.

**Polling, not realtime — committed.** 45-second `refetchInterval` via TanStack Query, paused on `document.hidden`, refetched on window focus, so an idle tab costs nothing. Rationale specific to this store: one to three admins, an order cadence in the tens per day, and Vercel functions where SSE holds an execution open and bills for it. Pusher/Ably would add a vendor, a key, and a reconnect state machine to save perhaps twenty seconds on a COD order that gets phone-confirmed within the hour. Revisit at a sustained 200+ orders/day; every read already routes through one hook, so swapping the transport touches one file.

**Generation.** Notifications are emitted server-side **inside the same transaction as the state change** — never fire-and-forget from a client mutation, or a failed navigation loses the alert. Cron-derived events hit a token-protected route. **Channels: in-app only in v1.** Email arrives with module 23 and reuses the same rows via a `channels: ('IN_APP'|'EMAIL')[]` column, not a parallel system.

---

### (f) Global admin search

Same engine, two surfaces, and the distinction is intent. **⌘K is jump-to-thing**: fast, keyboard, top 5 per type, closes on selection. **`/search?q=` is find-things**: a full page with type tabs, pagination, filters, and a shareable URL, reached by pressing Enter on the palette's "See all results" row or by clicking the topbar input.

**Backend: Postgres, and no extension on day one.** With ~40 products, 9 pages and an orders table starting at zero rows, v1 is plain `ILIKE` over indexed columns plus two purpose-built indexes: `orderCode` and `phoneNormalized`. Sub-millisecond, no extension, no sync job. `pg_trgm` (one extension, one GIN index on `title`/`sku`) is added **when the orders table passes ~5,000 rows** — a one-line migration, deliberately not paid for in advance. A `tsvector` over product descriptions and page bodies is **LATER**: nobody searches a 30-word handbag description. Algolia or Meilisearch would add an index to keep in sync, a sync-failure mode, and a monthly bill to solve a problem this dataset will not have for years; the threshold to reconsider is 5,000+ products or a *customer-facing* search needing typo tolerance and ranking rules — and note that the storefront's own search (`SearchOverlay.jsx`, client-side substring over the local array) is not in this project's scope either way.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/admin/search?q=&types=&limit=&cursor=` | Federated; `types` ⊆ `product,order,customer,page,media` |
| `GET` | `/api/admin/nav-counts` | Sidebar badges |
| `GET` | `/api/admin/notifications?cursor=&unread=` | Bell feed |
| `POST` | `/api/admin/notifications/read` | `{ ids[] }` or `{ all: true }` |

Deliberately not built: a server-side per-admin recent-queries endpoint. Recents live in `localStorage`; syncing one operator's last five searches across their own two devices is not a problem worth a table.

**Matching rules per type**

| Type | Matched fields | Ranked by |
|---|---|---|
| Order | `orderCode` (`NIYA-…`, prefix), `phoneNormalized`, email, customer name, `pinCode` | exact code > phone > name, then `createdAt` desc |
| Product | `title`, `sku`, `slug`, `tags`, variant `colorName`, variant `sku` | exact SKU > title prefix > substring |
| Customer | name, email, `phoneNormalized` | exact contact > name prefix |
| Page | `title`, `slug` | prefix |
| Media | `filename`, `altText` | substring — the escape hatch for legacy `WhatsApp Image 2026-08-17 at 5.37.34 PM.jpeg` filenames that nobody will ever recall by name |

Order is listed first on purpose: it is the query that runs twenty times a day.

**Response shape**

```
SearchResult {
  type: 'product'|'order'|'customer'|'page'|'media'
  id, title                 // "Classic Handbag"
  subtitle                  // "handbags · ₹2,999 · 12 in stock"
  badge?                    // "Draft" | "COD" | "Out of stock"
  thumbnail?, href, score
}
```

Every result carries one shape, so the palette row and the `/search` card render from a single component.

**Phone normalisation is a write-time decision, not a query-time one.** Strip `+91`, spaces, hyphens and leading zeros into a `phoneNormalized` column on both Order and Customer as the row is written, indexed. That turns "someone is calling about their order" into a one-second lookup instead of a scroll through the orders table, and it cannot be retrofitted cheaply once thousands of rows exist. Note the storefront's checkout does not validate phone format at all (`OrderPage` only checks non-empty), so normalisation must tolerate whatever arrives — including a number that is not ten digits — and store the raw value alongside for display on the invoice.

Authorisation runs server-side in the handler and never trusts the client `types` list; a `USER` session is rejected by middleware before the handler is reached, and the handler re-checks anyway.

**Decisions**

- FIX: Corrected the section's central premise. The draft claimed cutover is 'confined to src/api/*.js'; the repo disproves it. Added a three-class cutover model (A adapter-only / B adapter+component / C new code) and identified the five surfaces that genuinely need storefront code: TrustBadges.jsx (hardcoded JSX), MyOrders.jsx (imports no API, reads localStorage), ReelsSection.jsx:23 (filters on reel?.video, ignores isActive), and the two synchronous call sites BrandCraftsmanship.jsx:5 and CustomerReviews.jsx:5.
- FIX: Retargeted the entire content-cutover contract from contentApi.js to homeApi.js. Verified nothing in src/ imports contentApi.js - it is dead code. The live adapter for all seven home sections is homeApi.js (real, uncommented, not in the api.js barrel). The draft's 'dormant consumer' column pointed at the wrong file for every content row.
- FIX: Corrected footerPagesData from 'seven slugs including legal' to the actual eight keys (about, our-story, contact, shipping-returns, size-guide, faq, privacy-policy, terms-of-use). There is no 'legal' key; LegalPage.jsx:10 derives the slug from pathname so privacy-policy and terms-of-use are two real records. Added that SizeCarePage.jsx:13 hardcodes getFooterPage('size-guide'), so /care-guide renders size-guide content and no care-guide record exists - now a NOW deliverable.
- FIX: Demoted the draft's boldest claim. Variant ids alone do NOT fix the cart: CartContext.jsx:74-108 addToCart has a hasExisting branch matching on bare productId that filters out and REPLACES the existing line, so a second colour destroys the first rather than merging. Variant ids are a necessary precondition; the fix lives in CartContext.jsx (class C, forbidden now, not part of the src/api cutover). The rewrite says so and takes no credit for it.
- FIX: Killed the 'merchandising maps 1:1 to the four Availability checkboxes' claim. Only featured (isFeatured) and sale (isOnSale) are flags. new-arrivals is a 30-day createdAt window computed in ShopPage.jsx:219-224; best-sellers is top-8 by orderCount via getBestSellerProducts. Moved isBestSeller/isNewArrival overrides to LATER (they would require a ShopPage edit) and replaced them with a data obligation: the admin must keep createdAt, orderCount, rating and reviewCount authoritative or those facets break at cutover.
- FIX: Corrected the colour-vocabulary rationale. ShopPage.jsx:111 already calls v.name.trim(), so the draft's 'Black ' trailing-space example is impossible. The real defect is case: the Set is keyed on raw case while matching at ShopPage.jsx:202-207 lowercases, so 'Black' and 'black' yield two chips returning identical results. Kept the module, folded it into Settings rather than standing it up as its own numbered module.
- FIX: Added the largest missing capability - manual order and customer creation as NOW. Checkout writes to localStorage on the shopper's device, so pre-cutover the admin has zero order data; the draft's Orders module would have been an empty screen for months, and its 'orders originate at checkout, so no create button' rule made that permanent. Manual entry matches how this store actually takes COD orders (phone/Instagram/WhatsApp) and makes the panel useful on day one.
- FIX: Added two missing NOW modules the brief implies but the draft never named: a Cutover console (/cutover, a read-only surface x class x endpoint-live table, with a topbar pill) and the Public content API that returns the exact shapes the existing adapters already return, so class-A cutover is a body swap. Header helper text on every content screen is generated from that surface's cutover row so the honesty cannot drift.
- FIX: Corrected a real Next.js error. The draft said middleware 'denies USER at the edge for every /(dashboard) route' - App Router group parentheses are stripped from URLs, so that matcher never fires. Replaced with real path prefixes plus a catch-all, and a session re-read in the (dashboard) server layout.
- FIX: Resolved an internal contradiction. With exactly two roles and USER having no admin surface, calling /settings/team 'ADMIN-only, a second guard' is meaningless - everything is ADMIN-only. Re-specified that guard as last-admin protection (no self-demotion, no deleting the final ADMIN).
- FIX: Cut the command menu from ~45 commands with four scoping prefixes, react-hotkeys-hook, g-chords, j/k row nav and a cheat-sheet dialog down to ~40 static entries and five shortcuts - but KEPT and elevated the one server-backed path that matters for a COD store: '#' / bare NIYA- / 10-digit order-and-phone lookup. Dropped the hotkey dependency for a single keydown listener.
- FIX: Cut three notification events that alert on infrastructure that does not exist (content.revalidate_failed - no webhook; system.storefront_api_error - the public API has no consumer in v1) or that require new infrastructure for 1-3 known humans (auth.admin_login_new_device needs device fingerprinting), plus customer.registered (no signups can reach the admin pre-cutover). Kept the NotificationRead join table and dedupeKey unique index - both are cheap and correct.
- FIX: Downgraded search from pg_trgm + tsvector on day one to plain ILIKE plus two purpose-built indexes (orderCode, phoneNormalized), with pg_trgm as a named one-line migration at ~5,000 orders and tsvector as LATER. Reordered the match table to put Order first, since that is the query that runs twenty times a day. Cut the server-side recent-queries endpoint - localStorage covers it.
- FIX: Demoted Category/Collection from a NOW top-level entity with slug/description/SEO to a NOW category-tile settings screen (title, image, position per gender+subcategory) returning the exact shape getCategories() emits, with the full entity at NEXT. The storefront has no category landing pages, so slug and SEO would have no consumer.
- FIX: Made GST honest. OrderPage computes subtotal + shippingFee with no tax line at all, so a gstRatePercent that drives calculation is fiction pre-cutover. Scoped it to invoice display plus hsnCode on product and GSTIN in settings.
- FIX: Corrected every cited line number and expression against the source: OrderPage.jsx:18 (not :20) for the createOrder comment; OrderPage.jsx:77 (not :82) and the actual expression 'subtotal >= 2000 || subtotal === 0 ? 0 : 100'; the colour facet is built at ShopPage.jsx:106-116, not :509 (which is the render loop).
- FIX: Corrected notFoundApi from 'live now' to live-but-broken - it issues real HTTP against the contentApi instance, which points at the mockoon base http://localhost:3001/api and is dead in production.
- FIX: Removed the breadcrumb ellipsis-collapse rule, which contradicted the same paragraph's three-segment depth cap - it was a code path that could never execute.
- FIX: Added an explicit exclusion for importing historical orders: localStorage['niyaOrders'] lives on each customer's browser and is unreachable by any server. Pre-cutover order history is genuinely lost and manual entry is the only path.
- FIX: Added mobile navigation (Sheet below md, no rail) and phone-normalisation tolerance, since OrderPage only checks phone non-empty and never validates format - normalisation must accept malformed input and keep the raw value for the invoice.
- Kept from the draft, because they are right: grouping the sidebar by work rhythm with badged reactive items pinned high; product editor as in-page tabs rather than sub-routes; the sidebar cookie read in the server layout to avoid an SSR width flash; exactly one primary action per page with a sticky save bar on dirty forms; the Settings-owned free-shipping threshold resolving TrustBadges (Rs 10,000) against OrderPage (2000); polling at 45s over SSE/websockets; per-admin read state via a join table; payments as fields-only scaffold; and no store switcher.

**Open assumptions**

- The order status vocabulary is invented by the admin because the storefront ships exactly one literal, 'ORDER PLACED'. This section only assumes a 'needs action' subset exists for the Orders badge; the exact enum belongs to the data-model section. Note MyOrders.jsx:97 renders order.status raw, so whatever strings are chosen must be human-readable, not machine constants, if they ever reach that screen.
- Manual order entry is assumed to be wanted. It is the only way the Orders, Customers, Dashboard and Analytics modules hold real data before cutover, and it matches a store that takes COD orders over phone and Instagram - but if the user does not in fact take off-site orders, Orders and Customers become empty shells until cutover and should be re-sequenced to NEXT.
- Default thresholds - lowStockThreshold, codReviewThreshold, the 24h unconfirmed-order timer, the free-shipping threshold (2000 or 10,000 - the two live values disagree and the user must pick one) - are placeholders pending real fulfilment capacity.
- Existing niyaUsers accounts are imported only if the user can hand over a JSON export from a browser that holds them; localStorage is per-device, so this may recover nothing. Imported rows land as USER with a forced password reset and no plaintext password is carried across.
- Media moves to Vercel Blob. Legacy /public paths containing spaces are stored verbatim and pass through untouched; they are only replaced when someone re-uploads that image. The admin never writes into the storefront's public/ folder.
- Admin headcount is 1-3, which is what justifies polling over realtime, ILIKE over a search vendor, and cutting device-fingerprint alerting.
- The reels isActive toggle is assumed to be wanted as an admin control even though ReelsSection.jsx currently ignores it. If the user does not care, that row drops from class C to nothing and the cutover list shrinks to four surfaces.
- GSTIN, HSN codes and the GST band for handbags are assumed to exist and be supplied by the user; none appear anywhere in the repo.

**Risks**

- The cart-collapse defect is the worst bug in the product and this admin cannot fix it. CartContext.addToCart replaces the existing line when a second variant of the same product is added. Until CartContext.jsx is edited - which the user currently forbids - a customer physically cannot buy two colours of the same bag. Every day of delay is lost revenue that no admin feature offsets, and it should be raised as a separate ask rather than buried in the cutover checklist.
- Class-B surfaces are a silent trap. BrandCraftsmanship.jsx and CustomerReviews.jsx call their adapters synchronously during render. Repointing homeApi.js to axios without touching those two components does not throw a clear error - it renders a Promise, producing blank or crashed sections. Whoever performs the cutover must have these two files on the checklist or the homepage breaks in a way that looks like an API problem.
- The public content API's response shapes are load-bearing and fragile. Class-A cutover is only mechanical if the API returns exactly what the static data returns, including the literal newline inside craftsmanshipData.title, the promoBanners page/position/isActive triple, and getCategories' { gender, name, filter, image, count }. Any field renamed for elegance converts a class-A row into a class-B or C one. This needs contract tests written against the current static objects before the storefront is ever repointed.
- orderCount is a denormalised field that drives the storefront's Best Sellers facet, and nothing currently increments it. If the admin does not update orderCount as orders are fulfilled, Best Sellers freezes at whatever the seed data said, permanently. Same exposure for rating and reviewCount, which no module in this plan writes to until reviews land at NEXT.
- Product ids are human-readable slugs ('handbag-001') and routes use /product/:id. If the admin mints cuids for new products, the storefront's URLs and any existing links diverge in format. The data model must decide whether to keep the legacy id as the primary key or carry both, and the 'View on storefront' action depends on that answer.
- The dashboard's revenue and COD tiles will read zero or near-zero for months if manual order entry is not adopted, which reads as a broken panel to the user and invites a request to 'connect it to the real site' before the cutover work is scoped.
- The Cutover console is honest but also a permanent visible reminder that the panel does not yet control the site. If the user reads that pill as a defect rather than a status, there will be pressure to short-circuit the cutover and edit the storefront early, which is exactly the constraint this design exists to protect.
- Free-shipping threshold: the two live values (Rs 10,000 in TrustBadges, Rs 2,000 in OrderPage) mean one of them has been wrong in production for some time. Whichever the user picks, customers may have been quoted the other. Worth confirming before the setting is written, not after.
- Auth.js v5 Credentials with a JWT session is fine for 1-3 admins but has no session revocation. If an admin laptop is lost, the only remedy is rotating the secret and signing everyone out. Acceptable at this scale; it stops being acceptable the moment headcount or turnover rises.
- notFoundApi already issues real HTTP to a hardcoded localhost mockoon URL in the deployed storefront. That is a live failing request today, unrelated to this project, and someone should be told rather than discovering it during cutover testing and attributing it to the admin.

---

## Authentication, Authorization, Security & Audit Logs

### 0. Starting position, stated honestly (verified against the repo)

There is no authentication in this system today.

`src/api/authApi.js` is a localStorage shim. `signupUser(userData)` spreads the raw form object into `{ id: crypto.randomUUID(), ...userData }` and pushes it into the `niyaUsers` array. The form (`src/components/account/SignUpForm.jsx`) submits `{ name, email, phone, password, avatar }` — so **the plaintext password is persisted verbatim in `localStorage`**. `loginUser` string-compares `item.password === password`. `updateProfile` merges `EditProfile.jsx`'s fields — `fullName, email, phone, gender, dateOfBirth, address, city, state, pincode, avatar` — into both `niyaUsers` and `niyaCurrentUser`. That is a full customer PII record sitting unencrypted in a browser.

Grep result, stated precisely: the token `role` appears **nowhere in any storefront component**. The only `role=` string under `src/` is inside `src/assets/react.svg`, the unused Vite boilerplate logo. There is no user table, no role concept, no server session, no password hash, and no server that could hold one.

So this section is not "harden the existing auth" — it is **build the first real identity system this store has ever had**, entirely inside `admin_panel/`, with **zero changes to `e-commerce_frontend-main/`**.

`admin_panel` owns identity. The storefront's commented-out axios block at the bottom of `authApi.js` (`POST /login`, `/register`, `GET|PUT /profile`, `POST /logout` against the `authApi` instance, base `http://localhost:3001/api/auth`, `withCredentials: true`) is a **future** consumer, not a current one. Nothing in this section reaches the storefront. See "The cutover boundary" at the end.

One consequence shapes several tables below: **in v1 there are zero `USER` rows.** The `USER` enum member exists so that cutover is a data event and not a schema migration. Until cutover, the only identities that exist are 1–3 `ADMIN` rows created by CLI and invite.

---

### (a) Auth architecture

#### Provider choice

| Option | Fit for Niya Bags | Verdict |
|---|---|---|
| **Credentials (email + password)** | Admin population is 1–3 people (owner + ops). The same `User` table must later serve storefront customers, who sign up with email + phone. No Google Workspace domain in evidence. | **COMMIT: v1 = Credentials only** |
| Google OAuth | Removes password storage, but adds an IdP dependency for a 2-person team and cannot authenticate the customer side later. | **[LATER]** — ADMIN-only, hard `ADMIN_OAUTH_ALLOWLIST`, never auto-provisioning |
| Magic link / email OTP | Requires a transactional email provider that does not exist, and makes login depend on inbox latency during a live order incident. | Rejected for v1 |

**COMMIT: Auth.js v5 (`next-auth@5`), config in `auth.ts` / `auth.config.ts`.**

**COMMIT: no `@auth/prisma-adapter` in v1.** This corrects a reflex. Under Credentials + JWT the adapter does nothing — it exists to persist OAuth `Account` links and database `Session` rows, and we have neither. Installing it would add three unused tables (`Account`, `Session`, `VerificationToken`) that a reader would mistake for the live session store, right next to the `AdminSession` table that actually is one. The adapter arrives with Google OAuth in [LATER], as one migration.

#### Session strategy — the important decision

The requirement is **instant revocation**. Pure JWT sessions cannot do it: a stolen or post-demotion token stays valid until `exp`. Database sessions can — but Auth.js v5 does not support `strategy: "database"` alongside the Credentials provider; it forces JWT. That is a documented framework constraint, not a preference.

**COMMIT: JWT transport + a first-party server-side session registry (`AdminSession`), reconciled on every privileged request.**

The JWT carries an opaque `sid`. The `AdminSession` row is the authority on whether that `sid` is alive. Revoking is one `UPDATE ... SET revokedAt = now()`, effective on the target's next request. **The JWT is a transport; the database is the decision.**

```ts
// JWT claim shape — encrypted JWE cookie (Auth.js default A256CBC-HS512)
type AdminJWT = {
  sub: string               // User.id
  role: 'ADMIN' | 'USER'    // CACHE ONLY — never an authorization decision
  sid: string               // AdminSession.id — the revocation handle
  sv:  number               // User.sessionVersion — mass-revoke counter
  iat: number
  exp: number
}
```

The `AdminSession` read runs **once per request**, deduped by React `cache()` inside `requireAdmin()`. It is deliberately **not** cached across requests: a 60-second cross-request cache would make "revoke session" a lie for 60 seconds, which is the one thing this whole design exists to prevent. At this traffic volume the cost is one indexed primary-key lookup per request.

#### Split config (mandatory, not stylistic)

| File | Runtime | Contains | Consumed by |
|---|---|---|---|
| `auth.config.ts` | Edge-safe | Cookie names/flags, `pages`, the `authorized` callback, **`providers: []`** | `middleware.ts` |
| `auth.ts` | Node | Credentials provider, argon2id verify, `jwt` / `session` callbacks, `AdminSession` writes | Server Components, Server Actions, Route Handlers |

Argon2 is a native addon and Prisma needs TCP; neither runs on the Edge. Middleware imports only `auth.config.ts` and therefore never touches the database.

#### Cookies

| Cookie | Production name | Flags | Lifetime |
|---|---|---|---|
| Session | `__Host-niya_admin.session-token` | `HttpOnly; Secure; SameSite=Lax; Path=/`, **no `Domain`** | 12h absolute |
| CSRF | `__Host-niya_admin.csrf-token` | `HttpOnly; Secure; SameSite=Lax; Path=/` | session |
| Callback URL | `__Host-niya_admin.callback-url` | `HttpOnly; Secure; SameSite=Lax; Path=/` | session |
| MFA challenge **[LATER]** | `__Host-niya_admin.mfa` | `HttpOnly; Secure; SameSite=Strict; **Path=/**` | 5 min |

Two corrections that matter and are easy to get wrong:

- **`__Host-` requires `Path=/`.** A `__Host-` cookie scoped to `Path=/login` is rejected outright by every browser. The MFA cookie is therefore `Path=/` with a 5-minute TTL and a challenge id bound to it, not a path-scoped cookie.
- **`__Host-` requires `Secure`, and Safari does not accept `Secure` cookies over `http://localhost`.** So cookie names and `useSecureCookies` are environment-derived: prefixed + Secure when `AUTH_URL` is `https:`, unprefixed and non-Secure in local dev. Committing to this now avoids the classic "works in Chrome, silently no-session in Safari" dev day.

Why `__Host-` specifically: the prefix forbids the `Domain` attribute, pinning the cookie to `admin.niyabags.com` exactly. An abandoned CNAME on a sibling subdomain, or a preview deploy on `*.vercel.app`, then cannot write or read the admin session. The admin lives on a different origin from the storefront, so there is **no `.niyabags.com` scoping and no cookie sharing with the storefront** — that is the isolation design, not a limitation.

`SameSite=Lax`, not `Strict`: Lax already withholds the cookie on cross-site POST, which is what a Server Action invocation is, while keeping "click the link, you are still signed in" working. Strict buys nothing here and costs UX.

#### Expiry, idleness, rotation

| Control | Value | Rationale |
|---|---|---|
| **Absolute** session expiry | **12h, non-extending** | An admin session outliving one workday is pure risk. Absolute means absolute — it is **not** rolling. |
| Idle timeout | **30 min** | `AdminSession.lastSeenAt`; `requireAdmin()` rejects if staler. Read every request; **written** at most once per 60s, so the effective cutoff is 30–31 min. |
| JWT `updateAge` | 15 min | Re-mints the cookie inside the 12h window; refreshes the `role`/`sv` cache. Never extends `exp`. |
| `sid` rotation | On every login, and on password change | One `sid` per sign-in, so the active-sessions list means something. |
| Mass revoke | Password change, role change, disable, "sign out everywhere" | `User.sessionVersion++`; every JWT with an older `sv` fails at `requireAdmin()`. |
| Logout | Revokes the `AdminSession` row, **then** clears the cookie | Clearing a cookie alone leaves a valid `sid`; a captured cookie would still work. Order matters. |
| Re-auth (password re-prompt) | 10 min freshness | Required for: password change, session revoke, invite creation, role change, account disable. **Not** for ordinary settings writes — see (g). |

**Session-expired UX.** Never a silent redirect that discards typed work. A Server Action that fails the guard returns a typed `SESSION_EXPIRED` result; the client shows a shadcn `<AlertDialog>` with an inline re-auth `<Dialog>`. **On successful re-auth the form is re-enabled with its payload intact and the admin presses save again — there is no silent auto-retry.** Auto-replaying a mutation across a session boundary is how you get a double-published product or a duplicated order-status change; the one extra click is the correct trade. Full-page navigations get `redirect('/login?next=…&reason=expired')` plus a `sonner` toast on arrival.

---

### (b) Authorization

#### Role model

| Role | Meaning | Grants |
|---|---|---|
| `ADMIN` | Store operator | Full admin panel |
| `USER` | Customer (none exist until cutover) | **Nothing on the admin origin** |

A Prisma `enum Role`, default `USER`. No manager/editor/moderator, no permission table, no RBAC matrix. For a single-brand store with ~40 products run by one to three people, a permission matrix is over-engineering that rots into `if (user.email === '…')` checks within a year. If a genuine third role ever appears, the migration is one enum member plus a `can(ctx, action)` helper — the layered guards below are already the seam.

**The database is the source of truth. The `role` claim in the JWT is a cache and may be up to 15 minutes stale.**

1. JWT `role` is read by **middleware only**, to choose a redirect target cheaply. It is a UX hint.
2. Every real decision reads `role` from the `AdminSession → User` join that `requireAdmin()` already performs.
3. Demotion or disable writes `sessionVersion++`; `requireAdmin()` compares `jwt.sv` against `user.sessionVersion`, so a mismatch is an immediate hard fail on the **next request** — not in 15 minutes.

#### Layered enforcement

| Layer | Where | Runtime | Enforces | Bypassable? |
|---|---|---|---|---|
| 1. Middleware | `middleware.ts` | Edge | Cookie present, JWE decrypts, `role === 'ADMIN'` → else redirect. Also mints the CSP nonce. | **Yes** — treat as UX + defence in depth only |
| 2. Layout guard | `app/(admin)/layout.tsx` | Node | `await requireAdmin()` | No, but covers rendering only |
| 3. Server Action | every action, via the single `adminAction` client | Node | `requireAdmin()` + rate limit + Zod + audit | No |
| 4. Route Handler | every `app/api/**/route.ts` | Node | `requireAdmin()` or HMAC, first statement | No |
| 5. Data Access Layer | `lib/dal/**`, `import 'server-only'` | Node | Asserts a validated `AdminCtx` is present in request scope; the only module permitted to import `prisma` | No — final backstop |

Layer 5 **asserts**, it does not re-query. Re-running the session query in every DAL function would double the DB round-trips per request for zero added safety, since the context object it checks can only have been produced by `requireAdmin()`. A DAL call reached without one throws — which is a programming error, caught in dev, not a runtime auth path.

**Middleware alone is not authorization.** Concretely, for this app:

- It runs on a **stale, DB-free** token. A demoted admin still presents `role: 'ADMIN'` there.
- **Server Actions POST to the page's own URL.** A coverage gap does not leak a read — it leaves a *mutation* endpoint open.
- Next.js middleware has a known authorization-bypass class (**CVE-2025-29927**, the `x-middleware-subrequest` header) in which a crafted request skips middleware entirely. Anything guarded only by middleware was fully exposed.

**Resolving the matcher tension.** The draft version of this design warned that matcher-driven middleware silently misses new routes, then also required a per-request CSP nonce — which needs middleware on every HTML response. Both are solved the same way: the matcher is **default-deny**, `/((?!_next/static|_next/image|favicon\.ico).*)`, so every route including future ones is covered and the nonce is always available. There is no regex to remember to edit. This costs static optimization on matched routes, which is free here — every admin page is authenticated and dynamic by definition.

#### `requireAdmin()`

```ts
// lib/auth/guard.ts — 'server-only'
type AdminCtx = {
  userId: string; email: string; sessionId: string
  ip: string; userAgent: string; mustChangePassword: boolean
}

requireAdmin(): Promise<AdminCtx>
// 1. auth() → decode JWE cookie; absent → redirect('/login?next=…')
// 2. cache()'d query: AdminSession JOIN User ON sid
// 3. reject if: session missing | revokedAt != null | expiresAt < now
//             | lastSeenAt older than 30m | user.sessionVersion !== jwt.sv
//             | user.role !== 'ADMIN'      | user.disabledAt != null
// 4. touch lastSeenAt (throttled 60s); return AdminCtx
```

`mustChangePassword` is returned rather than thrown on, because it is not an auth failure: the `(admin)` layout redirects to `/settings/security?force=1`, and every other admin route and every non-password Server Action refuses while the flag is set. Without that enforcement the seed script's flag would be decorative.

**Every mutation funnels through one client.** `adminAction` (a single `next-safe-action` instance) runs:

`requireAdmin()` → rate limit on `userId + actionName` → Zod `.parse` → **open a Prisma transaction** → handler → **write the `AuditLog` row inside that same transaction** → commit → `revalidatePath`/`revalidateTag`.

Writing the audit row *inside* the transaction is the architectural point: **an admin cannot make a change that is not logged**, because the change and its log entry commit or roll back together. It is not something a developer can forget to call.

Enforced by lint (`no-restricted-imports`): `@/lib/prisma` is importable only from `lib/dal/**`, and `createSafeActionClient` only from `lib/actions/client.ts`.

---

### (c) `/login`, `/unauthorized`, redirects

| Route | Access | Behaviour |
|---|---|---|
| `/login` | Public | Email + password. Session already valid + ADMIN → `redirect('/')`. |
| `/login/2fa` **[LATER]** | MFA cookie only | `input-otp` 6-digit |
| `/unauthorized` | Authenticated, no longer ADMIN | "This account no longer has admin access." Buttons: *Sign out*, *Go to niyabags.com* |
| `/api/auth/[...nextauth]` | Public | Auth.js internals |
| everything else | ADMIN | The 5-layer stack |

**HTTP status, stated honestly.** An App Router page renders `200` unless you use Next's `forbidden()` interrupt, which is still behind the `authInterrupts` flag. **COMMIT: `/unauthorized` is a normal 200 HTML page.** The status code on a page a human reads is cosmetic; chasing a 403 there in exchange for an experimental flag is a bad trade. **Route Handlers and Server Action results return real `401`/`403` JSON** — that is where a status code has a consumer.

**What a non-ADMIN sees.** The `signIn` callback rejects non-ADMIN accounts **after** password verification and **before** any session cookie is minted, with error code `NOT_ADMIN`. The admin origin therefore never holds a customer session — nothing to steal, nothing to escalate. Because the message appears only post-verification, it leaks nothing to anyone who does not already hold the password; a wrong password always returns the generic `CredentialsSignin`. In v1 this branch is unreachable (no `USER` rows exist); it is written now so cutover does not require touching the auth callback. `/unauthorized` therefore exists for exactly one live case: **an ADMIN demoted or disabled mid-session.**

**Open-redirect protection** on `?next=`, one `safeNext()` helper used by `/login`, the callback-url cookie, and every `redirect()`:

1. Decode **once**; reject if the result still contains `%` (double-encoding).
2. Require a single leading slash: `^/[A-Za-z0-9/_-]`.
3. Reject `//`, `/\`, `\\`, any `:` before the first `/`, any `@`, any control character or newline.
4. Reject unless the path's first segment is in `ADMIN_ROUTE_ROOTS`.
5. Any failure → `/`, silently.

`ADMIN_ROUTE_ROOTS` is **one exported constant that the sidebar navigation also renders from**, so adding a route to the nav adds it to the allowlist and the two cannot drift. A hand-maintained second list in the redirect helper is exactly the kind of thing that rots. We deliberately do **not** use `new URL(next, base)` and compare origins — URL parsers have too many edge cases, and prefix-allowlisting is cheap when the admin has roughly 25 routes.

---

### (d) Credential hygiene, recovery, and abuse control

**COMMIT: argon2id via `@node-rs/argon2`**, OWASP baseline `m = 19456 KiB, t = 2, p = 1`, 16-byte salt. Chosen over bcrypt because bcrypt silently truncates at 72 bytes and is cheap on GPUs; argon2id's memory cost is the entire point. Parameters live in the encoded hash, so they can be raised later and the hash upgraded transparently on the next successful login. Cost: a native addon means Node runtime only — which is *why* the `auth.config.ts` / `auth.ts` split in (a) is mandatory rather than stylistic.

#### The plaintext hazard — and why there is no migration

`niyaUsers` holds plaintext passwords. Three facts make this decisive:

1. It is **not a database**. It exists per browser, per device. There is no server-side copy to import and no way to enumerate or contact those accounts.
2. Every one of those passwords was readable by any XSS on the storefront, any browser extension, and anyone holding the device. Treat them as **already compromised**.
3. People reuse passwords. Importing them moves a compromised secret into a system that then vouches for it.

**Policy — COMMIT:**

- **Never import `niyaUsers`.** No importer endpoint is built. An endpoint that accepts a client-supplied plaintext password "for migration" is a trivially abusable account-takeover API.
- The admin panel is seeded with **exactly one ADMIN** via `pnpm admin:seed` — a Node script reading `SEED_ADMIN_EMAIL` and a one-time password **from stdin**, never from an env var that lands in Vercel's dashboard or shell history — with `mustChangePassword = true`.
- Further admins are created by an existing ADMIN via a **single-use, 24h, hashed-at-rest invite token**. There is no open registration on the admin domain, ever.
- At cutover, customers **re-register**. There are ~40 products, no real order history, and the storefront's `niyaOrders` is device-local anyway. Losing device-local fake accounts costs nothing; inheriting compromised credentials costs everything.
- `authApi.js` is **not touched now**. It keeps its localStorage behaviour until cutover.

#### Break-glass recovery (the draft's biggest gap)

With no email provider, "forgot password" cannot be a link. With exactly one admin, a lockout with no escape is a business outage. **COMMIT: two operator CLIs**, run locally against `DATABASE_URL`, never exposed over HTTP:

| Command | Effect | Audit |
|---|---|---|
| `pnpm admin:reset-password` | Prompts for email + new password on stdin; argon2id re-hash; `sessionVersion++`; revokes all sessions | `PASSWORD_CHANGED`, `actorEmail = "SYSTEM:CLI"` |
| `pnpm admin:unlock` | Clears `lockedUntil` and `failedLoginCount` | `LOCKOUT` cleared, `actorEmail = "SYSTEM:CLI"` |

These run as the migration Postgres role. Whoever holds `DATABASE_URL` can already do anything, so this adds no privilege — it just makes the recovery path deliberate, auditable, and documented instead of improvised at 2am. Email-based reset becomes possible in [LATER] once a transactional provider exists.

#### Rate limiting & lockout

**COMMIT: v1 uses Postgres only. No Redis.** Upstash was reflexive over-engineering here: a second paid infrastructure dependency, a second set of secrets, and a second failure mode, to throttle a login page used by one person. The objection to Postgres counters is "a write per request" — but we only ever write on *authentication attempts*, not on every request, and a `LoginAttempt` row is a few dozen bytes.

`LoginAttempt { id, ipHash, emailHash, outcome, createdAt }`, indexed on `(ipHash, createdAt)` and `(emailHash, createdAt)`; counts are windowed queries; rows older than 24h are deleted by the same job. Redis moves to **[LATER]**, triggered by either a real credential-stuffing incident or the storefront cutover putting customer login on the same service.

| Surface | Key | Limit | On breach |
|---|---|---|---|
| `POST /api/auth/callback/credentials` | client IP | 10 / 10 min sliding | 429 + `Retry-After` |
| same | `sha256(email)` | 5 / 15 min | 429, response identical either way |
| Failed logins per account | `User.failedLoginCount` | **5** | Lock **15 min** (`lockedUntil`), fixed |
| Password change / re-auth | `userId` | 5 / 10 min | 429 |
| Mutating Server Actions | `userId + actionName` | 60 / min | 429 (a runaway-loop guard, not a security control) |
| Upload signing | `userId` | 30 / hour | 429 |

**Lockout is capped at 15 minutes with no exponential escalation** — a correction. Escalating an account lock to 24h in a shop whose *only* admin needs to change an order status is a self-inflicted denial of service, and the attacker who triggers it pays nothing. Fifteen minutes plus `admin:unlock` is the right shape.

Client IP comes from `ipAddress()` in `@vercel/functions`, never a raw `x-forwarded-for` split, which is attacker-controllable. Login is **response-time-equalised** — an unknown email still runs an argon2 verify against a fixed dummy hash — so timing does not enumerate accounts.

**TOTP 2FA — [LATER], not v1.** `otpauth` + `qrcode`, secret encrypted at rest with an app key, 8 single-use recovery codes stored argon2-hashed, enrolment behind re-auth, ±1 step drift, replay prevented by storing the last accepted step. Deferred because v1 has one admin and no email delivery for recovery, and shipping 2FA without a recovery path is a lockout generator. **The columns (`totpSecret`, `totpEnabledAt`, `recoveryCodes`) ship in the v1 schema** so enabling it later is a feature flag, not a migration event.

---

### (e) Input validation, uploads, XSS, CSRF, headers

#### Zod at every trust boundary

| Boundary | Schema location | Note |
|---|---|---|
| Server Action input | `lib/validation/*.schema.ts`, wired through `adminAction` | The same schema drives `react-hook-form` + `zodResolver`; client validation is UX, the server parse is the control |
| Route Handler body/query | `safeParse` at the top of the handler | 422 + field errors |
| `searchParams` in pages | One schema per page | Filters (`subcategory[]`, `minPrice`, `sortBy`, `cursor`) feed Prisma `where`/`orderBy` — an unvalidated `sortBy` is an orderBy injection |
| `env` at boot | `lib/env.ts`, parsed once; bare `process.env` banned by lint | Fails the build, not the first request |
| Webhook payloads **[LATER]** | Verify HMAC **before** parsing | |
| DB → response serializer | Output DTO schemas | Stops `passwordHash` from riding along on a careless `include` |

That last row is load-bearing. The `Order` entity mirrors the storefront's payload — `shippingDetails { fullName, email, phone, address, city, state, pinCode }` — real PII under India's DPDP Act 2023. An explicit output DTO is what keeps a convenience `include` from shipping a customer's full address into a list endpoint.

**A repo-grounded rule:** `EditProfile.jsx` collects `avatar` as a **free-text URL field**. Post-cutover that is an arbitrary attacker-chosen URL attached to a customer record. Admin screens **never** fetch a customer-supplied URL server-side (SSRF) and never render one as an image source; the customers list renders initials. The CSP `img-src` below already blocks it by construction — this states the intent so nobody "fixes" the CSP later to make avatars work.

#### File uploads

Product images, hero banners, promo banners, campaign and craftsmanship imagery, and reel videos are all admin-uploaded.

**A correction the draft got structurally wrong:** an 8 MB image or a 40 MB video **cannot pass through a Server Action or Route Handler on Vercel** — Server Actions default to a 1 MB body limit and the platform request-body ceiling is ~4.5 MB. So server-side sniffing "at ingest" of a 40 MB upload is not a thing that can happen. The pipeline must be direct-to-storage:

| # | Step | Where |
|---|---|---|
| 1 | Admin requests an upload token; server checks `requireAdmin()`, the declared MIME against the allowlist, and the declared size against the cap | Server Action |
| 2 | Browser uploads **directly to object storage** with that short-lived token; bytes never touch the app server | Client → storage |
| 3 | Storage fires an upload-completed callback; the app fetches the object **server-side** and sniffs **magic bytes** with `file-type` over the first 4100 bytes. Declared MIME and file extension are both ignored when they disagree. | Route Handler (HMAC-authenticated) |
| 4 | **Every image is re-encoded with `sharp`** to WebP/AVIF at bounded dimensions, and the original is deleted | Same handler |
| 5 | A `Media` row is created only after 3 and 4 pass. Anything that fails is deleted from storage and never becomes a `Media` row — so a rejected file is unreferenced and unreachable. | Same handler |

Caps: **8 MB images, 40 MB video** (reels are mp4 today). MIME allowlist: `image/jpeg`, `image/png`, `image/webp`, `image/avif`, `video/mp4`.

Step 4 is the highest-value step in the pipeline: re-encoding strips EXIF/GPS from the photographer's originals and destroys polyglot payloads (the GIFAR / JPEG-with-appended-HTML class), because the output bytes are freshly generated rather than passed through. Storage keys are randomised (`nanoid`); the original filename is kept only as a display label — no path traversal, no `.html` served from the asset host. Assets are served from a **separate origin** with `X-Content-Type-Options: nosniff` and `Content-Disposition: attachment` for anything non-image.

**SVG: REJECTED.** Every image in this store is a photograph — product shots, hero banners, lifestyle imagery. SVG is an XML document that can execute script; accepting it buys nothing. A vector logo, if ever needed, is hand-committed to the repo.

**Video: documented accepted risk.** v1 accepts mp4 with a strict magic-byte sniff and a size cap, with **no re-encode** — ffmpeg on serverless for a store with four reels is not justifiable. The residual risk is bounded by the separate origin plus `nosniff`. Transcoding via a provider is **[LATER]** if reels ever become a real content type.

#### XSS — where sanitization happens

Rich text is the top XSS surface in this application, because the admin's entire purpose is authoring content that will one day render on the storefront.

Blast-radius reduction comes first, and it is a schema policy rather than a filter:

| Content | Storage type | HTML? |
|---|---|---|
| `heroBanner.title/subtitle/buttonText`, `announcement.text`, `promoBanner.title/alt`, `campaign.*`, `craftsmanship.eyebrow/title/stats[].label`, `review.name/location/text`, `trustBadge.*`, product `title` | **Plain text** | **No** |
| `craftsmanship.description[]`, product `description` | Plain text, array of paragraphs | **No** |
| Footer static pages (`about`, `our-story`, `shipping-returns`, `size-guide`, `legal`) and FAQ `answers` | Sanitized HTML | **Yes**, narrow allowlist |

This mirrors the storefront's actual shapes: `craftsmanshipData` is genuinely `{ eyebrow, title, description: string[], stats: [{value,label}] }`, and `homeData.js` stores `"The Art of\nCraftsmanship"` as a plain string with a newline escape — not markup. Keeping these structured means **the large majority of CMS fields can never carry markup at all**, which is worth more than any sanitizer.

Sanitization points, exactly two:

1. **On write, server-side, inside the mutation wrapper**, before persistence. `isomorphic-dompurify`, allowlist `p, h2, h3, strong, em, ul, ol, li, a, br`; on `<a>`, `href` limited to `https:` / `mailto:` / relative, forced `rel="noopener noreferrer nofollow"`; **no** `style`, `class`, `id`, `on*`, `<iframe>`, `<script>`, `<form>`. The clean HTML is what lands in the database.
2. **On read, at the response serializer**, re-sanitized. Defence in depth for rows written before the policy tightened, inserted by a seed script, or edited directly in SQL.

Plain-text fields are additionally rejected at the Zod layer if they contain `<`. Admin preview panes render sanitized HTML inside a `sandbox` iframe **without** `allow-scripts`, so a sanitizer bypass cannot reach the admin's own session.

#### CSRF

- **Server Actions:** Next.js performs an Origin/Host comparison on action POSTs, and `SameSite=Lax` independently withholds the cookie cross-site. `serverActions.allowedOrigins` is set explicitly to the admin host so a proxy misconfiguration fails closed rather than open.
- **Route Handlers get none of that automatically.** A cookie-authenticated `POST /api/*` is a textbook CSRF sink. **Policy: no state-changing Route Handler is authenticated by cookie.** Mutations are Server Actions. The handlers that must exist — upload-completed callback, future payment/shipping webhooks, cron — authenticate by HMAC or a short-lived signed token and explicitly reject cookie-only auth.
- Auth.js's own endpoints keep their double-submit CSRF token cookie.

#### Secrets

| Var | Scope | Notes |
|---|---|---|
| `AUTH_SECRET` | Server | 32 bytes random, **distinct per environment**; rotating it invalidates every session — that is the break-glass |
| `DATABASE_URL` | Server | Pooled app role; migrations run under a *separate* Postgres role |
| `BLOB_READ_WRITE_TOKEN` | Server | |
| `UPLOAD_CALLBACK_SECRET` | Server | HMAC for the upload-completed handler |
| `SEED_ADMIN_EMAIL` | Server, dev/preview only | The password is never an env var |
| `NEXT_PUBLIC_STOREFRONT_URL` | **Public** | The only genuinely public value |

Rule learned from this very repo: the storefront's `VITE_API_BASE_URL` is baked into the client bundle by construction — `import.meta.env.VITE_API_BASE_URL || "https://shieldnest.theglamstreet.in/api"` is visible to anyone who opens devtools. `NEXT_PUBLIC_*` behaves identically. **Nothing secret ever carries that prefix**, enforced by a lint rule matching `NEXT_PUBLIC_.*(SECRET|TOKEN|KEY|PASSWORD)`.

#### Headers, CSP, and caching

Base headers in `next.config.ts`; the per-request nonce is injected by middleware (which runs on every HTML route — see (b)).

| Header | Value |
|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'nonce-{n}' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: https://<asset-host>; media-src 'self' https://<asset-host>; connect-src 'self' https://<asset-host>; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` — **no `preload`** |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` |
| `X-Frame-Options` | `DENY` (legacy backstop to `frame-ancestors`) |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cache-Control` on all `(admin)` responses | `private, no-store` |

Four notes, three of them corrections:

- **`preload` is dropped.** HSTS preload is an apex-domain decision that applies to **every** subdomain, including the storefront's. Submitting `niyabags.com` to the preload list from the admin's config would impose HSTS on a codebase this project is forbidden to touch. `includeSubDomains` on the admin host is the correct scope.
- **`data:` is removed from `img-src`.** `blob:` covers local upload previews; `data:` mainly widens the surface for injected markup.
- **`no-store` on admin responses** keeps customer PII (order lists, shipping addresses) out of any intermediary or browser disk cache. The draft omitted this entirely.
- `style-src 'unsafe-inline'` is a knowing concession — Next.js and Tailwind v4 emit inline `<style>`. The mitigation is that all CMS-authored HTML is sanitized with `style` and `class` stripped, so there is no attacker-controlled style to exploit. `object-src 'none'` and `base-uri 'none'` are the two directives that actually stop injected-markup escalation, and `frame-ancestors 'none'` matters because the admin has one-click destructive actions (publish, archive, order-status change) that clickjacking would target.

---

### (f) Audit log

| Field | Type | Purpose |
|---|---|---|
| `id` | `cuid` | |
| `createdAt` | `DateTime` | |
| `actorId` | `String?` | null only for `SYSTEM` (cron, seed, CLI) |
| `actorEmail` | `String` | Denormalised — survives user deletion |
| `action` | `AuditAction` enum | |
| `entity` | `AuditEntity` enum | |
| `entityId` | `String?` | |
| `entityLabel` | `String?` | `"Noir Tote Bag"`, `"NIYA-1736…"` — readable after the row is gone |
| `diff` | `Json?` | `{ field: { from, to } }`, redacted and capped |
| `summary` | `String?` | `"Price ₹2999 → ₹2499"` |
| `ip`, `userAgent` | `String?` | |
| `sessionId` | `String?` | Ties the entry to a revocable `AdminSession` |
| `requestId` | `String?` | Correlates with structured `pino` logs |

Indexes: `(createdAt desc)`, `(entity, entityId, createdAt desc)`, `(actorId, createdAt desc)`.

**`AuditEntity`:** `PRODUCT`, `PRODUCT_VARIANT`, `ORDER`, `USER`, `HERO_BANNER`, `PROMO_BANNER`, `ANNOUNCEMENT`, `REEL`, `CAMPAIGN`, `CRAFTSMANSHIP`, `TRUST_BADGE`, `REVIEW`, `FOOTER_SECTION`, `FOOTER_LINK`, `FOOTER_PAGE`, `MEDIA`, `SETTINGS`, `SESSION`, `AUTH`.

There is **one** `USER` entity, not a `USER`/`CUSTOMER` pair. There is one table and one role enum; splitting the audit entity would imply a distinction the data model does not have. A role change is `USER` + `ROLE_CHANGED`.

`TRUST_BADGE` is included deliberately: `src/components/home/TrustBadges.jsx` (59 lines) has **no data file** — its content is hardcoded in the component. It becomes a real CMS entity in the admin and is audited like any other, and it is one of the clearest examples of content the admin can manage that the storefront cannot yet read.

**`AuditAction`:** `CREATE`, `UPDATE`, `DELETE`, `PUBLISH`, `UNPUBLISH`, `ARCHIVE`, `RESTORE`, `REORDER`, `BULK_UPDATE`, `ORDER_STATUS_CHANGE`, `ORDER_EXPORT`, `MEDIA_UPLOAD`, `MEDIA_DELETE`, `LOGIN_SUCCESS`, `LOGIN_FAILED`, `LOGOUT`, `LOCKOUT`, `PASSWORD_CHANGED`, `ROLE_CHANGED`, `SESSION_REVOKED`, `INVITE_SENT`, `INVITE_ACCEPTED`, `SETTINGS_UPDATED`.

Honesty note on `ORDER_*`: the admin's `Order` table is **empty until cutover**. Today's orders are `localStorage["niyaOrders"]`, device-local, with the single status string `"ORDER PLACED"`. These enum members exist so the audit vocabulary does not need a migration on the day orders become real.

**What is and is not logged.** Every mutation is logged — structurally, because the audit write shares the mutation's transaction. Reads are **not** logged; a list view would drown the table. One exception: **`ORDER_EXPORT`**, logged with the row count and a snapshot of the filters, because that is the action that moves customer PII — name, phone, full address, pin code — out of the system, and under DPDP that is the one read worth a record.

Auth events (`LOGIN_FAILED`, `LOCKOUT`) are written outside any transaction, best-effort, and never block the response.

**Diffs without leaking secrets.** The diff is computed in the wrapper from the Zod-parsed input against the pre-image, then passed through two filters:

1. **Recursive key-name denylist**, `/password|passwordHash|secret|token|totp|recoveryCode|salt|apiKey|sessionToken/i`. Matches become `"[redacted]"` — the *fact* of the change is recorded, never the value. A CI test walks the Prisma DMMF and asserts every field matching that regex is covered, so adding a new secret column fails the build instead of leaking quietly.
2. **8 KB cap per diff.** Long values (a footer page body, a product description) collapse to `{ from: {len, sha256}, to: {len, sha256} }`. The text is not lost — CMS entities carry their own `ContentVersion` history, which is where "what did the About page say last Tuesday" is answered. The audit log answers *who changed what, when*, and stays small and fast.

`ip` is personal data and inherits the retention below rather than living forever.

**Immutability**, enforced in three places:

- **Application:** there is no update or delete Server Action, Route Handler, or DAL function for `AuditLog`. The only write path is `create` inside the wrapper.
- **Database:** the application's Postgres role is granted `SELECT, INSERT` on `audit_log` only — no `UPDATE`, no `DELETE`. Migrations and CLIs run as a separate owner role. A fully compromised application, with arbitrary SQL, still cannot rewrite history. This is one statement in one migration and is the highest-leverage line in the section.
- **Purge:** when retention deletion eventually runs, it runs as the migration role and audits itself as a `SYSTEM` actor.
- **[LATER]:** a `prevHash`/`rowHash` chain for tamper *evidence* — worth building only once there is more than one admin to distinguish between.

**Retention.** Mutation entries **400 days** (a full year of seasonal comparison plus a quarter); auth events **90 days**. Sizing: ~40 products, a handful of CMS blocks and low order volume produce on the order of a few thousand rows a year. **The purge job and the NDJSON cold-export are therefore [LATER], not v1** — there is nothing to purge for 400 days, and building a cron job now to delete rows that will not exist for over a year is exactly the kind of speculative machinery this store cannot justify. The retention *policy* is written down and the DB grants that make it safe exist from day one; the job is scheduled in month 13.

**Admin UI — `/audit`.** shadcn `data-table` (TanStack Table) with **server-side keyset pagination on `(createdAt, id)`** — offset pagination on an append-only table double-shows rows as new entries land. Facets via `command` inside `popover`: Actor, Action, Entity, date range (`calendar` in range mode), free text on `entityLabel`. A row opens a `sheet` with a side-by-side before/after diff, redactions rendered as visible `[redacted]` chips, plus IP, user agent, and a link to the affected entity. A standing `alert`: "Audit entries cannot be edited or deleted." Every entity detail page carries an **Activity** tab — the same table prefiltered to `entity + entityId`.

---

### (g) Admin settings & profile security

#### Password change — `/settings/security`

1. **Re-auth:** the current password is required in the same form, not a session-age check alone.
2. **New password:** Zod `min 12`, checked against a small denylist (`niya`, `niyabags`, the account's own email local-part). **No composition rules** — NIST deprecated them; length plus a breach check is what works. HaveIBeenPwned k-anonymity range check is **[LATER]** (it is one outbound HTTPS call with no secret, so it is a small addition, deferred only to keep v1's external dependencies at zero).
3. Argon2id re-hash → `sessionVersion++` → **revoke every `AdminSession` except the current one** → re-mint the current cookie with a fresh `sid`.
4. `AuditLog { action: PASSWORD_CHANGED, diff: null }` — the null diff is deliberate; there is nothing about a password safe to record.
5. Confirmation email **[LATER]**, when a transactional provider exists.

#### Active sessions & revoke

The `AdminSession` registry from (a) is what makes this screen real rather than decorative.

| Column | Source |
|---|---|
| Device / browser | `userAgent` parsed **at creation** and stored parsed, not re-parsed on read |
| IP + approximate location | `ipAddress()` at creation; city-level only |
| Signed in | `createdAt` |
| Last active | `lastSeenAt` |
| Current | `sid === jwt.sid` → `<Badge>This device</Badge>` |
| Action | `Revoke` (`alert-dialog` confirm); "Sign out all other devices" bumps `sessionVersion` |

Revocation takes effect on the target's very next request, because `requireAdmin()` re-reads the row every request with no cross-request cache. Each revoke writes `SESSION_REVOKED`. Revoke and "sign out everywhere" both require re-auth within 10 minutes.

#### Store settings — what is safe to expose

| Setting | Type | Grounded in |
|---|---|---|
| Free-shipping threshold | INR int, default **2000** | `OrderPage.jsx:82` — `subtotal >= 2000 \|\| subtotal === 0 ? 0 : 100` |
| Flat shipping fee | INR int, default **100** | same line |
| Zero-subtotal shipping | bool, default true, **read-only** | The `subtotal === 0` branch on that same line; surfaced so the rule is visible, not editable |
| COD enabled | bool | COD is the only method that works |
| Online payment enabled | bool, **disabled and locked**, with an inline explanation | The `ONLINE` radio exists in `OrderPage.jsx`, but **no payment gateway is integrated anywhere in this repo**. The toggle must not imply one exists |
| Order status vocabulary | Ordered list, seeded with the single value `ORDER PLACED` | The storefront's only status string today |
| Announcement bar on/off | bool | `AnnouncementBar` |
| Support email | email, Zod-validated | `footerData.customerService.email` = `support@niyabags.com` |
| Social links | `{ platform enum, url }`, `https:` only | `footerData.socialLinks` (4 entries) |
| Currency / locale | **read-only display**, `INR` / `en-IN` | Changing it would silently reprice ~40 products |
| Low-stock threshold | int, **hidden until inventory exists** | There is no `stock` field on any product today |

**Never exposed as a setting:** any raw HTML or script box (analytics is a **GA4 measurement ID validated by `^G-[A-Z0-9]{4,12}$`**, never a script blob — a script blob is a self-service stored-XSS feature); any URL fetched server-side (SSRF); `AUTH_SECRET`, `DATABASE_URL`, storage tokens; role assignment (that lives on the user detail page, audited as `ROLE_CHANGED`, behind re-auth); redirect or CORS origin lists; any flag that disables auth or audit logging.

Settings writes are audited as `SETTINGS_UPDATED` with a full field-level diff. They do **not** require re-auth — a correction to the draft. Re-auth is reserved for the five genuinely dangerous operations (password change, session revoke, invite creation, role change, account disable). Prompting for a password to change a shipping threshold trains the operator to type their password reflexively, which is the opposite of what re-auth is for.

---

### Security-relevant folder tree (`admin_panel/`)

```
admin_panel/
├─ middleware.ts                     # edge: coarse redirect + CSP nonce; default-deny matcher
├─ auth.ts                           # Node: Credentials, argon2id, jwt/session callbacks
├─ auth.config.ts                    # edge-safe: cookies, pages, authorized cb, providers: []
├─ app/
│  ├─ (auth)/login/page.tsx
│  ├─ (auth)/login/2fa/page.tsx      # [LATER]
│  ├─ unauthorized/page.tsx          # demoted/disabled mid-session only
│  ├─ (admin)/layout.tsx             # await requireAdmin() + mustChangePassword gate
│  ├─ (admin)/audit/page.tsx
│  ├─ (admin)/settings/security/page.tsx
│  ├─ api/auth/[...nextauth]/route.ts
│  └─ api/uploads/completed/route.ts # HMAC-authenticated; sniff + sharp re-encode
├─ lib/
│  ├─ auth/guard.ts                  # requireAdmin() — 'server-only'
│  ├─ auth/password.ts               # argon2id hash/verify + dummy-verify equaliser
│  ├─ auth/sessions.ts               # AdminSession registry, revoke, sessionVersion
│  ├─ auth/safe-next.ts              # open-redirect allowlist over ADMIN_ROUTE_ROOTS
│  ├─ auth/rate-limit.ts             # Postgres LoginAttempt windows
│  ├─ actions/client.ts              # the single adminAction funnel
│  ├─ audit/{write,diff,redact}.ts   # diff + denylist + 8KB cap
│  ├─ security/{sanitize,upload-validate}.ts
│  ├─ validation/*.schema.ts         # shared client + server Zod
│  ├─ routes.ts                      # ADMIN_ROUTE_ROOTS — nav and safeNext read this
│  ├─ dal/**                         # the ONLY module allowed to import prisma
│  └─ env.ts                         # parsed once at boot
├─ scripts/{seed-admin,reset-password,unlock}.ts   # stdin only, never over HTTP
└─ prisma/schema.prisma              # User, AdminSession, Invite, LoginAttempt,
                                     # AuditLog, ContentVersion
```

---

### The cutover boundary (restated, because it constrains auth)

**Nothing in this section reaches the storefront.** `e-commerce_frontend-main/` is untouched: `authApi.js` keeps its localStorage behaviour, the cart keeps using `niya_cart`, orders keep landing in `niyaOrders`, and home content keeps coming from `src/data/homeData.js`. An admin can create the perfect hero banner in this panel today and **no storefront visitor will ever see it**, because `homeApi.js` returns a static object from a local file. That is true of every screen described above, and no part of this design pretends otherwise.

Cutover is a **later, separate, mechanical step confined to `src/api/*.js`**, whose axios versions are already written and merely commented out. Two auth-specific facts constrain it, and both are decisions for that day rather than this build:

1. **The admin's `__Host-` cookie cannot be reused.** The prefix forbids `Domain`, and the two apps live on different origins. Customer auth needs its own cookie on the storefront's origin.
2. **The storefront's `authApi` axios instance already sets `withCredentials: true`** against a cross-origin base (`http://localhost:3001/api/auth` today). Cross-site cookie auth in that shape requires `SameSite=None; Secure`, which is materially weaker than what the admin uses. The better option is a **same-origin proxy through the storefront's own `vercel.json` rewrite** — the file already exists and already contains a rewrite — so the customer API is same-origin and the cookie can be `SameSite=Lax`. That is a one-line change **in the storefront**, made at cutover, not now.

Until then, the admin's API is consumed by exactly one client: the admin panel itself.

---

### What was deliberately not built (and why)

| Cut | Reason |
|---|---|
| `@auth/prisma-adapter` in v1 | Does nothing under Credentials + JWT; adds three misleading unused tables |
| Upstash Redis | A second paid dependency and secret set to throttle a login page used by one person; Postgres counters suffice at this volume |
| Exponential lockout to 24h | Self-DoS for a single-admin store; 15 min + CLI unlock is correct |
| Audit purge cron + NDJSON cold export in v1 | Retention is 400 days; there is nothing to purge until month 13 |
| RBAC matrix / permission table | Two roles, three people. It would rot into email checks |
| Re-auth on ordinary settings writes | Trains reflexive password entry, which defeats re-auth |
| 2FA in v1 | No email means no recovery path; 2FA without recovery is a lockout generator. Columns ship now |
| Server-side video transcoding | Four reels. Bounded by separate origin + `nosniff`; documented accepted risk |
| Auto-retry of a mutation after re-auth | Risks double-publishing or duplicating an order-status change |


**Decisions**

- FIX (hallucination): Corrected the signup payload. Verified src/components/account/SignUpForm.jsx submits `{name, email, phone, password, avatar}` and authApi.js stores `{id: crypto.randomUUID(), ...userData}` — the draft omitted both `avatar` and the generated id.
- FIX (hallucination): Corrected the `role` grep claim. The draft said 'zero occurrences outside aria-* attributes', implying aria roles exist in components. Verified: the only `role=` string under src/ is inside src/assets/react.svg, the unused Vite boilerplate logo. No component contains it.
- FIX (hallucination): Corrected the OrderPage.jsx:82 quote. The real line is `subtotal >= 2000 || subtotal === 0 ? 0 : 100` — the draft dropped the zero-subtotal branch. Added it to the settings table as a read-only surfaced rule.
- FIX (broken spec — browser will reject it): The draft's MFA cookie was `__Host-niya_admin.mfa` with `Path=/login`. The `__Host-` prefix REQUIRES `Path=/`; that cookie would be discarded by every browser. Changed to Path=/ with a 5-minute TTL.
- FIX (broken in dev): Added env-conditional cookie naming. `__Host-` requires `Secure`, and Safari refuses Secure cookies over http://localhost, so the prefixed name is production-only and `useSecureCookies` is derived from the AUTH_URL protocol.
- FIX (internal contradiction): The draft's cookie table said '12h absolute, rolling'. An absolute expiry cannot roll. Committed to 12h absolute non-extending, with the 30-min idle timeout as the separate control, and noted `updateAge` re-mints without extending `exp`.
- FIX (architecturally impossible): The draft's upload pipeline implied server-side magic-byte sniffing of 8MB images and 40MB video 'at ingest'. Server Actions default to a 1MB body and Vercel caps request bodies near 4.5MB — those bytes cannot pass through the app. Rewrote as direct-to-storage upload with a signed token, then an HMAC-authenticated upload-completed handler that fetches, sniffs, and sharp-re-encodes server-side, creating the Media row only on success.
- FIX (internal contradiction): The draft attacked matcher-driven middleware as an unguarded-route risk while also requiring a per-request CSP nonce, which needs middleware everywhere. Resolved both with a default-deny matcher `/((?!_next/static|_next/image|favicon.ico).*)`, and noted the only cost (loss of static optimization) is free on an all-dynamic authenticated app.
- FIX (over-engineering, removed a whole dependency): Dropped Upstash Redis from v1. Rate limiting is a Postgres `LoginAttempt` table written only on auth attempts, not per request. Redis demoted to [LATER] with named triggers (a real stuffing incident, or customer login arriving at cutover).
- FIX (over-engineering): Dropped `@auth/prisma-adapter` from v1. Under Credentials + JWT it does nothing but add unused Account/Session/VerificationToken tables sitting next to the AdminSession table that is the real session store. It arrives with Google OAuth.
- FIX (self-DoS): Capped account lockout at a flat 15 minutes and removed the exponential escalation to 24h. Locking out the only admin for a day during a live order is worse than the attack it prevents.
- FIX (major gap): Added a break-glass recovery path. With no email provider and one admin, the draft had no way back from a forgotten password or a lockout. Committed to `pnpm admin:reset-password` and `pnpm admin:unlock`, stdin-only, run as the migration Postgres role, audited as SYSTEM:CLI.
- FIX (dangling flag): The draft set `mustChangePassword = true` at seed and never said what enforced it. `requireAdmin()` now returns the flag, the (admin) layout redirects to /settings/security?force=1, and every other route and non-password action refuses while it is set.
- FIX (missing): Logout now revokes the AdminSession row before clearing the cookie. Clearing the cookie alone leaves a live `sid`, defeating the entire registry design.
- FIX (correctness hazard): Removed the draft's 'pending action is retried once with the same payload' after re-auth. Silent replay across a session boundary can double-publish a product or duplicate an order-status change. The form is re-enabled with its payload and the admin re-submits.
- FIX (would break the storefront): Removed `preload` from HSTS. Preload is an apex-domain decision that applies to every subdomain including the storefront's — imposing it from the admin config touches a codebase this project is forbidden to modify. Kept includeSubDomains scoped to the admin host.
- FIX (missing header): Added `Cache-Control: private, no-store` on all (admin) responses so order lists and shipping addresses never land in an intermediary or on-disk cache.
- FIX (CSP): Removed `data:` from img-src (blob: already covers upload previews) and added the asset host to connect-src, which direct-to-storage uploads require and the draft omitted.
- FIX (sandbox too permissive): The draft's preview iframe used `sandbox="allow-same-origin"`. Changed to a sandbox without allow-scripts — allow-same-origin without dropping scripts is close to no sandbox at all.
- FIX (duplicated work, not added safety): Layer 5 (DAL) now asserts that a validated AdminCtx exists in request scope rather than 're-asserting the session'. Re-querying in every DAL call doubles DB round-trips for no gain, since the context can only have come from requireAdmin().
- FIX (internal contradiction): The route table said /unauthorized serves 'authenticated non-ADMIN', but the signIn callback rejects non-ADMINs before any cookie is minted, so that state cannot exist. Made both consistent: /unauthorized is for a demoted or disabled ADMIN mid-session only.
- FIX (under-specified + wrong): The draft claimed /unauthorized returns HTTP 403. An App Router page returns 200 unless you use the experimental `forbidden()` interrupt. Committed to a 200 HTML page for humans and real 401/403 JSON from Route Handlers and action results, and said why.
- FIX (under-specified): The middleware row never said where it redirects. Specified: no cookie → /login, cookie decoding to non-ADMIN → /unauthorized.
- FIX (list rot): The open-redirect prefix allowlist is now a single exported ADMIN_ROUTE_ROOTS constant that the sidebar nav also renders from, so a new route cannot be in the nav but missing from the allowlist.
- FIX (data-model contradiction): Collapsed the draft's separate CUSTOMER and USER audit entities into one USER entity. There is one User table and one role enum; two audit entities would imply a split the schema does not have.
- FIX (over-engineering): Demoted the audit purge cron and monthly NDJSON cold export to [LATER, month 13]. Retention is 400 days, so a v1 job would delete rows that will not exist for over a year. The policy and the SELECT+INSERT-only grants ship now.
- FIX (over-engineering / trains bad habits): Removed the re-auth requirement on ordinary settings writes. Re-auth is now scoped to the five dangerous operations (password change, session revoke, invite creation, role change, account disable).
- FIX (honesty, new): Added an explicit statement that a perfect hero banner created in the admin today will never reach a storefront visitor, because homeApi.js returns a static object from src/data/homeData.js — plus a note that the Order table is empty until cutover, so ORDER_* audit actions are forward-looking vocabulary.
- FIX (honesty, new + grounded): Documented that the storefront's authApi axios instance already sets withCredentials:true against a cross-origin base, so cutover would require SameSite=None;Secure unless routed through the storefront's existing vercel.json rewrite as a same-origin proxy — a one-line storefront change made at cutover, not now.
- FIX (missing, grounded in the repo): Added a rule that customer-supplied `avatar` URLs (a free-text type=url field in EditProfile.jsx) are never fetched server-side (SSRF) and never rendered as an image source; the customers list renders initials. Noted the CSP already blocks it, so nobody 'fixes' img-src later to make avatars work.
- FIX (missing PII detail): Recorded the full profile shape EditProfile.jsx writes to localStorage (gender, dateOfBirth, address, pincode, avatar), since that is the DPDP-relevant customer record the admin will inherit at cutover — the draft only mentioned the password.
- FIX (code creep): Compressed the AuditLog Prisma model into a field table, keeping only the two short type sketches (AdminJWT claims, requireAdmin contract) that carry load.
- FIX (missing summary): Added a 'What was deliberately not built' table so every cut and deferral is defensible in one place rather than implied.

**Open assumptions**

- Postgres + Prisma is the datastore (decided in the data-model section). The AdminSession registry, the LoginAttempt rate-limit table, and the append-only GRANT strategy all assume a real relational DB the project controls — none of them survive a headless-CMS backend.
- The admin deploys to Vercel on its own domain (e.g. admin.niyabags.com) over HTTPS, separate from the storefront's Vercel project. `__Host-` cookies and HSTS assume TLS everywhere except localhost.
- The Postgres provider allows creating a second role and issuing per-table GRANTs. Neon, Supabase, and self-hosted Postgres all do; if the chosen provider exposes only one role, the DB-level audit immutability guarantee downgrades to application-level only and should be flagged as such rather than quietly dropped.
- No transactional email provider exists, which is why password-reset-by-email, 2FA recovery, and login-notification email are [LATER] and why the CLI break-glass exists. If the user adds Resend or SES, email reset and 2FA both become v1-able.
- Object storage (Vercel Blob or S3-compatible) is available on an origin separate from the admin app, supports short-lived client upload tokens, and can fire an upload-completed callback. Without the callback, step 3-4 of the upload pipeline moves to a queued job and the Media row is created in a pending state.
- The admin population is 1-3 people. Past roughly ten admins, or on the appearance of a genuine third role, the flat ADMIN|USER enum should be revisited deliberately rather than worked around with email checks.
- pnpm is the package manager for admin_panel (the storefront ships only a package-lock.json, so this is a fresh choice, not an inherited one).
- The storefront and admin eventually share one User table. If customer auth is instead built as a separate service, the 'never import plaintext credentials' policy still holds, but the sessionVersion / role plumbing needs a second implementation and the two systems need an agreed identity claim.

**Risks**

- Single admin, single point of failure. The whole recovery story rests on someone holding DATABASE_URL and being able to run a CLI. If the owner is the only person with both, an incapacitated owner is a locked store. Mitigation the user must decide on: a second ADMIN created by invite on day one.
- Postgres-based rate limiting is a deliberate simplification that will not hold under a real distributed credential-stuffing attack — windowed counts are read-then-write and can race under concurrency. It is right for one-admin traffic; the [LATER] Redis trigger must actually be watched, not forgotten.
- Per-request AdminSession reads are the price of instant revocation. At this volume they are free, but any future move to a high-traffic customer-facing API on the same guard would need a short-TTL cache, which reintroduces a revocation window. That trade must be made consciously at cutover, not inherited.
- The Auth.js v5 constraint (no database strategy with Credentials) is a framework behaviour that could change or break across minor versions. Pin next-auth exactly and treat an upgrade as a change requiring a revocation test, not a routine dependency bump.
- CVE-2025-29927 is a class, not a one-off. The design does not depend on middleware for authorization, which contains this specific bug, but it does depend on middleware for the CSP nonce — a future middleware-bypass bug would degrade CSP to no-nonce on affected requests. Keeping object-src/base-uri 'none' in the static base headers limits that blast radius.
- The 40MB mp4 path has no re-encode. A malformed or malicious mp4 is stored and served, mitigated only by a separate origin plus nosniff. This is an accepted risk that becomes unacceptable the moment reels are ever embedded on an origin that shares a session with anything.
- Audit-log immutability via GRANTs is only as strong as the deployment discipline that keeps the app on the restricted role. A hurried 'the migration failed, let me just use the owner URL' moment in Vercel env vars silently removes the guarantee, with no error and no signal. Worth an automated startup assertion that the app role cannot DELETE from audit_log.
- The storefront cutover is the real risk to this design, not the admin build. The moment src/api/*.js is repointed, customer auth arrives, cross-origin cookie decisions get made under time pressure, and the isolation described here (separate origin, __Host-, no cookie sharing) is exactly what a rushed cutover erodes. That decision deserves its own written design before anyone uncomments an axios call.
- DPDP Act 2023 obligations (notice, consent, breach reporting, erasure) are addressed here only through data-handling controls — output DTOs, ORDER_EXPORT logging, retention. Actual legal compliance including a breach-notification process and an erasure workflow is out of scope for this section and currently unowned.
- ContentVersion is referenced as the answer to 'the audit diff is capped, where is the full text' but is specified in the data-model section. If that table is descoped there, the 8KB diff cap silently becomes data loss rather than a pointer.

---

## API Architecture and Endpoint Catalog

> **Scope.** Everything below is built in `admin_panel/` and deployed as its own Vercel project. Nothing in `e-commerce_frontend-main/` is edited by this work. The storefront reads static local JS files today, so **no endpoint here changes what a customer sees until a later, separate cutover** (section (i)), which is mostly — but not entirely — confined to `src/api/*.js`.

---

### (a) Audit: the nine storefront API modules

None of `src/api/` is reusable *by* the admin — they are browser-side axios/localStorage adapters bundled by Vite; the admin is a separate Next app with a server session and direct DB access. What they *are* is a **binding contract**: they pin the URLs, params and JSON shapes the public API must emit so cutover is uncommenting, not rewriting.

| Module | What it is today (verified) | Real HTTP? | Public endpoint that must replace it | Admin surface |
|---|---|---|---|---|
| `axiosClient.js` | 4 instances over 2 bases: `VITE_API_BASE_URL` (default `https://shieldnest.theglamstreet.in/api`) and `VITE_MOCKOON_API_BASE_URL` (default `http://localhost:3001`) | n/a | defines the two origins we serve | none |
| `authApi.js` | localStorage fake auth; `niyaUsers` holds **plaintext passwords**, `niyaCurrentUser` is the "session" | No | `POST {mockoon}/api/auth/login`, `/register`, `/logout`; `GET`+`PUT /api/auth/profile` (paths fixed by the commented block; instance sets `withCredentials: true`) | `/api/admin/customers/*` |
| `productApi.js` | async re-export of `src/data/products.js` helpers | No | `GET {api}/products` + `?featured`/`?bestSeller`/`?newArrival`/`?search`/`?subcategory`/`?minPrice`/`?maxPrice`; `/products/:id`; `/products/:id/suggestions`; `/categories` | products, variants, categories, inventory |
| `homeApi.js` | returns `homeData.js` statics; **no commented axios version**, only a commented `import` | No | the 7 content paths at the **mockoon root** | `/api/admin/content/*` |
| `contentApi.js` | **entirely commented out** — pure intent, zero live code | No | same 7 paths **plus** `/not-found-bags`, at the mockoon **root** (no `/api` prefix) | `/api/admin/content/*` |
| `footerApi.js` | returns `footerData.js`; **no commented axios version**; **absent from the `api.js` barrel** | No | `GET {api}/footer`, `GET {api}/pages/:slug` | footer, pages, faqs |
| `cartApi.js` | **live HTTP code**: `GET /`, `POST /add {product,quantity}`, `DELETE /remove/:productId`, `DELETE /clear` on `${api}/cart` — but **`CartContext` never imports it**; the cart is localStorage `niya_cart` | Yes | **not built** — see below | none |
| `notFoundApi.js` | **live HTTP code**: `GET /not-found-bags` on the mockoon root | Yes | `/not-found-bags` root alias → `[{id, image}]` | `/api/admin/content/not-found-bags` |
| `api.js` | barrel: axiosClient, authApi, cartApi, productApi, contentApi (**not** footerApi, **not** homeApi) | n/a | n/a | none |

**Only `cartApi.js` and `notFoundApi.js` contain live HTTP**, and both point at servers that do not exist. Everything else is static passthrough or commented intent.

**Decision: we do not build `/api/v1/cart/*`.** `cartApi.js` is dead code — `CartContext.jsx` reads/writes `localStorage["niya_cart"]` and never imports it. Serving those four routes would produce an API with no caller; making them *useful* means rewriting `CartContext`, which is forbidden. Same for wishlist (`niyaWishlist`, device-local strings). Server-side cart/wishlist is **[LATER]**, gated on a storefront rewrite.

#### Cutover hazards found by reading the consumers (record now, fix at cutover)

1. **Two consumers call content getters synchronously.** `BrandCraftsmanship.jsx:5` (`const data = getCraftsmanship()`) and `CustomerReviews.jsx:5` (`const reviews = getReviews()`) — no `await`, no `useEffect`. Turning those into axios calls returns a Promise into JSX and renders nothing. Every other consumer (`HeroBanner`, `PromoBanner`, `ReelsSection`, `AnnouncementBar`, `CampaignSpotlight`, `CategorySection`, `Footer`, `NotFoundPage`) already awaits inside `useEffect` and is a clean swap.
2. **Route collision on `/api/auth`.** `authApi` resolves to `${mockoonBase}/api/auth`. Auth.js defaults to `/api/auth/[...nextauth]`. **Decision: mount Auth.js at `/api/admin/auth/[...nextauth]` via `basePath`**, freeing `/api/auth/*` for the storefront's customer endpoints in the same app.
3. **`contentApi`/`notFoundApi` hit the mockoon base at the ROOT** (`${base}/hero-banners`), not under `/api`. We serve 8 root-level rewrites so those files need *zero* code edits — only the env var moves.
4. **`FooterPage.jsx` imports `getFooterPage` from `../../api/api`, which does not export it** (footerApi is not in the barrel). It is dead code — not referenced by `AppRoutes.jsx`. Do not design around it. The live pages (`AboutPage`, `ContactPage`, `FAQPage`, `SizeCarePage`, `LegalPage`, `OurStoryPage`, `ShippingReturnsPage`) import from `../../api/footerApi` directly and work.
5. **`/care-guide` is not a page slug.** `AppRoutes.jsx` maps both `/size-guide` and `/care-guide` to `SizeCarePage`, which hardcodes `getFooterPage("size-guide")`. `LegalPage` derives its slug from `location.pathname` (`privacy-policy` | `terms-of-use`). The pages API is therefore called with exactly **8 slugs**: `about`, `our-story`, `contact`, `shipping-returns`, `size-guide`, `faq`, `privacy-policy`, `terms-of-use`.
6. **Checkout is anonymous.** `OrderPage.jsx` calls `useAuth()` only to *prefill* the form (`if (user) setFormData(...)`); it never redirects or blocks. `POST /api/v1/orders` **must accept unauthenticated requests** or checkout breaks for every guest.
7. **No customer account can be migrated.** Passwords live as plaintext inside each *device's* `localStorage.niyaUsers` — unreachable by any server. At cutover, existing "accounts" cannot be imported; customers re-register. Plan the copy for that, not a migration script.

**Cutover ledger**

| Ready to uncomment | Must be written fresh |
|---|---|
| `productApi.js` (full axios block), `authApi.js` (full axios block), `contentApi.js` (whole file) | `homeApi.js` (delete; re-export `contentApi` — function names are already identical), `footerApi.js` (no axios version exists), `orderApi.js` (**does not exist**; `OrderPage.jsx:20` has the commented import and `:144` the commented `// await createOrder(orderPayload);`) |

---

### (b) API layering: public read API vs admin API

**Two namespaces, one Next.js app, one Prisma schema, one deploy.**

| Surface | Base path | Consumer | Auth | Caching | CORS |
|---|---|---|---|---|---|
| Public read | `/api/v1/*` + 8 root aliases | Vite storefront (browser) | anonymous | tagged Data Cache + `Cache-Control: public, s-maxage=60, stale-while-revalidate=604800`, `Vary: Origin` | exact-origin allowlist |
| Public write | `POST /api/v1/orders` | Vite storefront | **anonymous** (see hazard 6); optional customer cookie only enriches the order | `no-store` | allowlist |
| Customer auth | `/api/auth/*` | Vite storefront | customer session cookie, `credentials: true` | `no-store` | allowlist + `Access-Control-Allow-Credentials` |
| Admin | `/api/admin/*` | admin panel only | Auth.js session, role `ADMIN` | `no-store`, `Vary: Cookie` | **no CORS headers** — same-origin only |

**Why one app.** With 39 products and one operator, a split API service buys nothing and costs a second deploy, a second env matrix, and schema drift between two Prisma clients. Keeping the read path beside the write path means a product edit and its cache invalidation ship in the same release.

**Cache invalidation, stated correctly.** `revalidateTag` invalidates the framework **Data Cache**; it does **not** purge a CDN entry created by a hand-set `s-maxage`. So each `/api/v1` GET builds its payload inside a **tagged cached function** (`products`, `content:hero-banners`, `page:faq`, `footer`, `categories`), and admin mutations call `revalidateTag` **after** the DB transaction commits — invalidation is post-commit and best-effort, not transactional. The response then carries a deliberately **short `s-maxage` (60s)** so the worst-case customer-visible staleness is one minute, and a **7-day `stale-while-revalidate`** so the storefront keeps serving the last good payload through an origin blip. That is the honest availability story: admin downtime degrades to stale content, not a blank storefront.

**Cross-origin cookies, committed.** `authApi` sets `withCredentials: true`, so the customer session cookie crosses `niyabags.com` → API origin. Decision: alias the API as `api.niyabags.com` (same registrable domain as the storefront) and issue the **customer** cookie with `Domain=.niyabags.com; SameSite=Lax; Secure; HttpOnly`. The **admin** cookie is host-only on `admin.niyabags.com`, `SameSite=Lax`, never shared with the parent domain, so a storefront XSS cannot reach an admin session. If the storefront ever lives on a different registrable domain, the customer cookie becomes `SameSite=None; Secure` and CORS must echo the exact origin (never `*` with credentials).

**Versioning.** `/api/v1` is **frozen to the legacy shapes** in (h) — a compatibility surface whose job is to make the commented-out axios code correct on the first try. Additive fields only; no renames, no removals. A rebuilt storefront gets `/api/v2` with clean shapes (ISO dates, real enums, `stock`, `sku`) and both run. **`/api/admin/*` is unversioned** — it ships in the same artifact as its only client.

**Contract guard.** Because `/api/v1` is frozen and its consumer cannot be tested from this repo, ship a **snapshot contract test** per public endpoint asserting the exact key set and value formats (`createdAt` is `"YYYY-MM-DD"`, products come back as a bare array, `pages/:slug` returns `null` not 404). It is the only thing preventing silent shape drift.

---

### (c) Admin surface catalog

**Legend.** **RH** = ships as an HTTP Route Handler. **SA** = ships as a Server Action only; the path is the *service identity* (`lib/services/*`), not a URL. **SU** = requires re-authentication. `A` = Auth.js session with role `ADMIN` (the only two roles are `ADMIN` and `USER`). **[LATER]** = deliberately not built now, with reason.

The draft this replaces mirrored ~90 endpoints as HTTP routes *and* claimed forms would use Server Actions — both cannot be true. **Rule: reads ship as RH** (TanStack Query needs cancellable, cacheable URLs), **mutations ship as SA** unless a non-browser caller, a file body, or a specific content type demands a route.

```
admin_panel/src/app/api/
├── admin/
│   ├── auth/[...nextauth]/route.ts   ← Auth.js, basePath /api/admin/auth
│   ├── me/route.ts
│   ├── products/  variants/  categories/  inventory/
│   ├── orders/  customers/  reviews/
│   ├── content/  pages/  faqs/  footer/
│   ├── media/  notifications/  analytics/  settings/  audit-logs/
│   └── cron/nightly/route.ts         ← Vercel Cron, CRON_SECRET header
└── v1/
    ├── products/  categories/  content/  pages/  footer/  orders/
    └── (root rewrites → content: /hero-banners, /promo-banners, /announcements,
         /campaign, /reels, /craftsmanship, /reviews, /not-found-bags)
```

#### Products

Default catalogue order is **user-visible**: `ShopPage`'s default `sortBy === ""` returns `0` from its comparator (a no-op sort) and `getSuggestedProducts` returns "the first 6 others in array order". So `/api/v1/products` must return a **deterministic order**, which makes `position` a correctness requirement, not merchandising polish.

| Method | Path | Purpose | Body / Query | Returns | Impl | Auth |
|---|---|---|---|---|---|---|
| GET | `/api/admin/products` | DataTable list | `page,pageSize,sort,order,q,status,subcategory,gender,isFeatured,isOnSale,stockState` | `{data: AdminProduct[], meta}` | RH | A |
| POST | `/api/admin/products` | create as `DRAFT` | product + nested variants | `{data}` 201 | SA | A |
| GET | `/api/admin/products/:id` | edit-form load | — | `{data}` incl. `version` | RH | A |
| PATCH | `/api/admin/products/:id` | partial update | fields + `expectedVersion` | `{data}` / 409 | SA | A |
| DELETE | `/api/admin/products/:id` | soft archive (never hard-delete — order lines reference it) | — | `{data:{id,status:"ARCHIVED"}}` | SA | A |
| POST | `/api/admin/products/:id/duplicate` | clone with variants, new slug/sku | — | `{data}` 201 | SA | A |
| POST | `/api/admin/products/:id/publish` \| `/unpublish` | `DRAFT`↔`PUBLISHED`, then `revalidateTag('products')` | — | `{data}` | SA | A |
| PATCH | `/api/admin/products/bulk` | set fields on many, incl. the sale fields | `{ids[], patch:{status?,isFeatured?,subcategory?,isOnSale?,salePrice?,discountPercentage?}}` | `{data:{updated, failed[]}}` | SA | A |
| POST | `/api/admin/products/sale/revert` | restore `price`/`salePrice` from the snapshot the last bulk sale wrote | `{batchId}` | `{data:{reverted:n}}` | SA | A |
| POST | `/api/admin/products/reorder` | set `position` (drives default storefront order) | `{items:[{id,position}]}` | `{data}` | SA | A |
| GET | `/api/admin/products/export` | CSV of catalogue | list filters | `text/csv` | RH | A |
| — | CSV **import** | **[LATER]** — 39 products; the seed job (assumption 4) covers first load, and a dry-run/commit importer is a week of validation UI for a store that adds a few SKUs a month | | | | |

Per-product history is **not** a separate endpoint — it is `GET /api/admin/audit-logs?entity=Product&entityId=:id`.

#### Variants

Variants in `products.js` have **no `id`, only `name`** — the root of the `CartContext` dedupe bug (see (h)). Every variant gets a stable server id.

| Method | Path | Purpose | Body / Query | Returns | Impl | Auth |
|---|---|---|---|---|---|---|
| GET | `/api/admin/products/:id/variants` | list | — | `{data: Variant[]}` | RH | A |
| POST | `/api/admin/products/:id/variants` | add colourway | `{name, colorHex, sku, stock, mediaIds[]}` | `{data}` 201 | SA | A |
| PATCH | `/api/admin/variants/:variantId` | rename / recolour / re-sku | partial + `expectedVersion` | `{data}` | SA | A |
| DELETE | `/api/admin/variants/:variantId` | remove | — | 204, or **409 if it is the last variant** (the product shape requires ≥1) | SA | A |
| PUT | `/api/admin/variants/:variantId/images` | replace the ordered image list | `{mediaIds: string[]}` | `{data}` | SA | A |
| POST | `/api/admin/products/:id/variants/reorder` | swatch order | `{items:[{id,position}]}` | `{data}` | SA | A |

`colorHex` exists because `ShopPage` has a colour filter keyed on `variant.name`; the hex is admin-only swatch chrome until v2 and is **not** emitted on `/api/v1`.

#### Categories

Today a category **is not an entity** — `getCategories()` groups products by `gender + "-" + subcategory`, takes `image` from the first matching product's `variants[0].images[0]` (no product has a top-level `images`/`thumbnail` field, so that branch never fires), and counts every product regardless of status. The admin promotes it to a real entity; `/api/v1/categories` keeps projecting the derived facet shape.

| Method | Path | Purpose | Body / Query | Returns | Impl | Auth |
|---|---|---|---|---|---|---|
| GET | `/api/admin/categories` | list with live counts | `gender,q` | `{data: Category[]}` | RH | A |
| POST | `/api/admin/categories` | create | `{slug,name,gender,description,bannerMediaId,metaTitle,metaDescription,position}` | `{data}` 201 | SA | A |
| PATCH | `/api/admin/categories/:id` | update | partial + `expectedVersion` | `{data}` | SA | A |
| DELETE | `/api/admin/categories/:id` | delete | — | 204, or **409 with `productCount`** if in use | SA | A |
| POST | `/api/admin/categories/reorder` | grid order — array order *is* the rendered order in `CategorySection` | `{items:[{id,position}]}` | `{data}` | SA | A |
| GET | `/api/admin/categories/:id/products` | assignment view | list query | `{data, meta}` | RH | A |

`gender` is constrained to lowercase `"women" | "men"` because `CategorySection` does a strict `category.gender === gender` compare against its `"women"` default. `description`, `bannerMediaId` and the SEO fields have **no storefront surface today** — they are stored, exposed on v2, and honestly listed in (i) as invisible until a storefront change.

#### Inventory

Stock does not exist in the current product shape, and **nothing on the storefront renders it** — `ShopPage`'s `availabilityFilter` is `sale | featured | best-sellers | new-arrivals`, not stock. Stock is therefore an **internal ops number** (does the operator have the bag) until v2. It lives on the **variant**, and every change writes an immutable ledger row, because a stock number without a movement log is unauditable when a COD order is disputed.

| Method | Path | Purpose | Body / Query | Returns | Impl | Auth |
|---|---|---|---|---|---|---|
| GET | `/api/admin/inventory` | variant stock grid; `stockState=low` is also the dashboard widget and the low-stock notification query | `page,pageSize,q,stockState=in\|low\|out,subcategory` | `{data: InventoryRow[], meta}` | RH | A |
| PATCH | `/api/admin/inventory/:variantId` | set or adjust | `{mode:"set"\|"adjust", value, reason, note}` | `{data:{variantId, stock}}` | SA | A |
| GET | `/api/admin/inventory/movements` | ledger | `variantId,from,to,reason,page,pageSize` | `{data: Movement[], meta}` | RH | A |
| — | bulk stock-take | **[LATER]** — 39 products × ~2 variants is a grid you edit inline; a bulk-adjust upload is unjustified | | | | |

#### Orders

The storefront's entire status vocabulary is one string. `MyOrders.jsx:97` and `OrderReceipt.jsx:200` both render `{order.status || "ORDER PLACED"}` as **free text with no switch**, so richer values display correctly without a code change.

Internal enum: `PENDING, CONFIRMED, PACKED, SHIPPED, OUT_FOR_DELIVERY, DELIVERED, CANCELLED, RETURN_REQUESTED, RETURNED, REFUNDED`. Payment: `method: COD | ONLINE`, `paymentStatus: PENDING | PAID | FAILED | REFUNDED`. **No payment gateway exists anywhere in this codebase** — `ONLINE` is a radio button only, so `PAID` is always set by hand and `refund` **records** a refund; it never calls a provider.

| Method | Path | Purpose | Body / Query | Returns | Impl | Auth |
|---|---|---|---|---|---|---|
| GET | `/api/admin/orders` | order queue | `page,pageSize,sort,order,q(orderId/phone/email),status,paymentMethod,paymentStatus,from,to,minTotal,maxTotal` | `{data: OrderSummary[], meta}` | RH | A |
| GET | `/api/admin/orders/:id` | detail + items + timeline | — | `{data: OrderDetail}` | RH | A |
| PATCH | `/api/admin/orders/:id/status` | advance lifecycle | `{status, note}` | `{data}` / 409 on illegal transition | SA | A |
| PATCH | `/api/admin/orders/:id/shipping` | courier + AWB | `{courier, awb, trackingUrl, dispatchedAt}` | `{data}` | SA | A |
| PATCH | `/api/admin/orders/:id/payment` | mark COD collected / ONLINE paid | `{paymentStatus, reference, collectedAt}` | `{data}` | SA | A |
| POST | `/api/admin/orders/:id/cancel` | cancel + optional restock | `{reason, restock:boolean}` | `{data}` | SA | A |
| POST | `/api/admin/orders/:id/refund` | **record** a refund | `{amount, mode, reference, note}` | `{data}` | SA | A |
| POST | `/api/admin/orders/:id/notes` | internal note | `{body}` | `{data: Note}` 201 | SA | A |
| POST | `/api/admin/orders/bulk-status` | pack/dispatch a batch | `{ids[], status, note}` | `{data:{updated, failed:[{id,error}]}}` | SA | A |
| GET | `/api/admin/orders/export` | CSV courier manifest | list filters | `text/csv` | RH | A |

The printable invoice is a **Server Component page** (`/orders/[id]/invoice`) rendered for print, not an API row — nothing else consumes that payload.

**Why admin order mutations need no idempotency store.** Status transitions are declared as a target state, so replaying `status=SHIPPED` is a no-op; payment and refund rows are unique on `(orderId, reference)`, so a double submit collides on the index. The idempotency store exists for exactly one route — public order create (see (e)).

#### Customers

Exactly two roles: `ADMIN`, `USER`. A `USER` session on any `/api/admin/*` route is a flat 403.

| Method | Path | Purpose | Body / Query | Returns | Impl | Auth |
|---|---|---|---|---|---|---|
| GET | `/api/admin/customers` | list | `page,pageSize,q,role,status,hasOrders,from,to` | `{data, meta}` | RH | A |
| GET | `/api/admin/customers/:id` | profile + orders + lifetime value + addresses | — | `{data: CustomerDetail}` | RH | A |
| PATCH | `/api/admin/customers/:id` | edit name/phone/internal notes | partial | `{data}` | SA | A |
| POST | `/api/admin/customers/:id/role` | grant/revoke `ADMIN` | `{role:"ADMIN"\|"USER"}` | `{data}` | SA | **A+SU** |
| POST | `/api/admin/customers/:id/block` | block sign-in | `{blocked:boolean, reason}` | `{data}` | SA | A |
| POST | `/api/admin/customers/:id/anonymize` | DPDP Act 2023 erasure — scrub PII, keep order rows for accounting | `{confirmEmail}` | `{data:{id, anonymizedAt}}` | SA | **A+SU** |

Because checkout is anonymous, most `Customer` rows are **order-derived contacts** (name/phone/email from `shippingDetails`) with no login. The model must allow `passwordHash = null`.

**Step-up (`SU`) is deliberately limited to two actions** — privilege grant and irreversible erasure. The draft required it on ten routes; for a single-operator store that is friction without a threat model. Everything else destructive uses a typed confirmation in the UI plus the audit log.

#### Reviews and testimonials

`reviewsData` is three curated testimonials — `{name, location, text}`, **no rating, no product link, no date**. They are marketing copy. Separately, **no storefront surface submits a review**: `ProductDetails` renders hardcoded `rating`/`reviewCount` numbers and there is no review form anywhere. So `PRODUCT_REVIEW` rows *cannot exist* until a storefront change.

**Decision:** model both types now (`type: TESTIMONIAL | PRODUCT_REVIEW`), ship only the testimonial editor. The moderation queue is **[LATER]**, unlocked by a storefront review form.

| Method | Path | Purpose | Body / Query | Returns | Impl | Auth |
|---|---|---|---|---|---|---|
| GET | `/api/admin/reviews` | list (v1: testimonials only) | `page,pageSize,type,status,productId,q` | `{data, meta}` | RH | A |
| POST | `/api/admin/reviews` | author a testimonial | `{type:"TESTIMONIAL", name, location, text, position}` | `{data}` 201 | SA | A |
| PATCH | `/api/admin/reviews/:id` | edit copy / publish | `{status?, text?, name?, location?}` | `{data}` | SA | A |
| DELETE | `/api/admin/reviews/:id` | remove | — | 204 | SA | A |
| POST | `/api/admin/reviews/reorder` | display order | `{items:[{id,position}]}` | `{data}` | SA | A |

Product `rating` and `reviewCount` stay **editable stored numbers** seeded from `products.js` (see the `orderCount` note in (h)) — turning them into derived aggregates on day one would zero out every product card.

#### Discounts

There is **no coupon, campaign, or discount-rule entity today**: `SalePage` filters `getAllProducts()` on `isOnSale`, and `OrderPage`'s payload has no coupon field. A checkout coupon code is therefore **out of scope** — it cannot work without editing the storefront.

**Decision: no `Discount` entity in v1.** A sale is `PATCH /api/admin/products/bulk` writing `isOnSale`/`salePrice`/`discountPercentage`, with a snapshot per batch and `POST /api/admin/products/sale/revert` to undo it. A scheduled rule engine with preview/apply/revert (`startsAt`/`endsAt`, scope targeting) is **[LATER]** — for one operator running a handful of sales a year, a bulk edit with an undo is the same outcome at a tenth of the surface, and scheduling needs a cron-driven materializer that only earns its keep once sales are frequent.

#### Content sections (homepage)

Modelled one-for-one against `homeData.js`. **Publish model, committed:** every content row carries `status: DRAFT | PUBLISHED`; the public projection emits **only** `PUBLISHED` rows and, for the shapes whose components filter on it (`promo-banners`, `reels`), emits `isActive: true` as a derived legacy field. There is no second `isActive` toggle in the admin — one concept, one control.

| Method | Path | Purpose | Body / Query | Impl | Auth |
|---|---|---|---|---|---|
| GET | `/api/admin/content/sections` | index: every section, publish state, last edit | — | RH | A |
| GET / POST | `/api/admin/content/hero-banners` | list / create | `{mediaId, title, subtitle, buttonText, buttonLink, position, status}` | RH / SA | A |
| PATCH / DELETE | `/api/admin/content/hero-banners/:id` | edit / remove | partial + `expectedVersion` | SA | A |
| GET / POST | `/api/admin/content/promo-banners` | already `page`+`position` targeted (`page: home\|shop\|wishlist`, `position: after-hero\|after-products`) — `PromoBanner.jsx` matches all three fields client-side | `{page, position, mediaId, title, alt, status}` | RH / SA | A |
| PATCH / DELETE | `/api/admin/content/promo-banners/:id` | edit / remove | — | SA | A |
| GET / POST | `/api/admin/content/announcements` | rotating bar strings (legacy shape is `{id, text}` only) | `{text, position, status}` | RH / SA | A |
| PATCH / DELETE | `/api/admin/content/announcements/:id` | edit / remove | — | SA | A |
| GET / POST | `/api/admin/content/reels` | video tiles — legacy data mixes a local `.mp4` and external Pexels URLs, so both must remain expressible | `{videoMediaId \| videoUrl, title, position, status}` | RH / SA | A |
| PATCH / DELETE | `/api/admin/content/reels/:id` | edit / remove | — | SA | A |
| GET / PUT | `/api/admin/content/campaign` | singleton `{eyebrow, title, description, image, buttonText, buttonLink}` | full doc + `expectedVersion` | RH / SA | A |
| GET / PUT | `/api/admin/content/craftsmanship` | singleton; `description` is exactly `string[2]`, `stats` exactly 3 × `{value,label}`, `title` contains a literal newline | full doc + `expectedVersion` | RH / SA | A |
| GET / POST / PATCH / DELETE | `/api/admin/content/not-found-bags` | 404 floating bags `{id, image}` | `{mediaId, position}` | RH / SA | A |
| POST | `/api/admin/content/:section/reorder` | ordering | `{items:[{id,position}]}` | SA | A |
| POST | `/api/admin/content/:section/publish` | draft → live, then `revalidateTag('content:'+section)` | `{ids?}` | SA | A |

**Cut: `POST /api/admin/content/preview-token`.** A signed preview token is meaningless here — previewing a draft requires a storefront route that can render unpublished content, and the storefront is a separate app we may not touch. The admin previews drafts **inside the admin** with section renderers that mirror the storefront components. **[LATER]** if the storefront ever gains a preview route.

**Trust badges are [LATER].** `TrustBadges.jsx` has no data file and no API call, and its `icon` field is a **`react-icons` component reference** (`FiBox`, `FiShield`, …), not a string. Admin-managed badges need (a) a new fetch in that component and (b) an allowlisted icon-key enum plus a client-side key→component map — both are storefront edits, so this cannot ship in this phase. Note the live badge text also contradicts the code: it advertises free shipping "Orders over ₹10,000" while `OrderPage.jsx:82` computes `subtotal >= 2000 ? 0 : 100`.

#### CMS pages, footer, FAQ

The 8 slugs each have a **different ad-hoc shape**. Do not force one schema: store `slug`, shared header fields (`eyebrow`, `title`, `intro`, `metaTitle`, `metaDescription`), and a validated `blocks: Block[]` body whose variants are exactly the shapes those 8 pages already use (rich text, ordered list, key/value table, FAQ list, contact card, section-with-anchor — `LegalPage` and `SizeCarePage` both scroll to `#hash` ids, so block anchors must be editable).

| Method | Path | Purpose | Body / Query | Impl | Auth |
|---|---|---|---|---|---|
| GET | `/api/admin/pages` | list all 8 + status | `q,status` | RH | A |
| POST | `/api/admin/pages` | new page (renders only via a new storefront route — see (i)) | `{slug, title, blocks[], ...seo}` | SA | A |
| GET | `/api/admin/pages/:slug` | editor load | `?version=` | RH | A |
| PATCH | `/api/admin/pages/:slug` | save draft | partial + `expectedVersion` | SA | A |
| POST | `/api/admin/pages/:slug/publish` | publish + snapshot + `revalidateTag('page:'+slug)` | — | SA | A |
| GET | `/api/admin/pages/:slug/versions` | last 10 publish snapshots | `page,pageSize` | RH | A |
| POST | `/api/admin/pages/:slug/revert/:versionId` | restore a snapshot | — | SA | A |
| DELETE | `/api/admin/pages/:slug` | delete — **409 for the 8 slugs routed in `AppRoutes.jsx`** | — | SA | A |
| GET / PUT | `/api/admin/footer` | singleton: `brand`, `socialLinks[]`, `sections[].links[]`, `customerService`, `legalLinks[]`, `copyright` | full doc + `expectedVersion` | RH / SA | A |
| GET / POST | `/api/admin/faqs` | Q&A rows (child of page `faq`, own array shape) | `{question, answer, position, status}` | RH / SA | A |
| PATCH / DELETE | `/api/admin/faqs/:id` | edit / remove | — | SA | A |
| POST | `/api/admin/faqs/reorder` | ordering | `{items:[{id,position}]}` | SA | A |

Version snapshots are written **on publish only** (not on every keystroke) — cheap, and enough to undo a bad edit to a legal page, which is the actual risk.

#### Media

| Method | Path | Purpose | Body / Query | Impl | Auth |
|---|---|---|---|---|---|
| POST | `/api/admin/media/upload-token` | issue a client-direct upload token (see (g)) | `{filename, contentType, size, folder}` | RH | A |
| POST | `/api/admin/media/upload-completed` | blob-store callback; writes the `Media` row | provider payload (signature-verified) | RH | provider |
| POST | `/api/admin/media` | register an **existing storefront path or external URL** without uploading (`/products/bags/...`, Unsplash, Pexels) | `{kind:"EXTERNAL_URL", url, alt, folder}` | SA | A |
| GET | `/api/admin/media` | library grid | `page,pageSize,q,kind=IMAGE\|VIDEO\|EXTERNAL_URL,folder,unusedOnly` | RH | A |
| PATCH | `/api/admin/media/:id` | alt text, folder, tags | partial | SA | A |
| GET | `/api/admin/media/:id/usage` | where it is referenced | — | RH | A |
| DELETE | `/api/admin/media/:id` | delete — **409 with references** unless `?force=true` | — | SA | A |

#### Notifications

In-app only, **polled**, not streamed. The draft's SSE endpoint is cut: a persistent `text/event-stream` on serverless functions costs a live function per open tab to serve one operator. Decision: **TanStack Query polls `GET /api/admin/notifications?unreadOnly=true` every 60s** while the tab is focused. No email/SMS provider exists in this project; if transactional email is added it is one adapter behind this table, not a new API shape.

| Method | Path | Purpose | Body / Query | Impl | Auth |
|---|---|---|---|---|---|
| GET | `/api/admin/notifications` | bell feed: new order, low stock, failed export | `page,pageSize,unreadOnly,type` | RH | A |
| POST | `/api/admin/notifications/:id/read` \| `/read-all` | mark read | — | SA | A |

#### Analytics

Every number is a SQL aggregate over our own tables. **No analytics provider, no event pipeline, no tracking script is assumed or added.**

| Method | Path | Purpose | Body / Query | Impl | Auth |
|---|---|---|---|---|---|
| GET | `/api/admin/analytics/overview` | KPI tiles: revenue, AOV, order count, COD share, **COD delivered vs cancelled/RTO rate** (the India-specific risk metric), new customers, orders-by-status counts | `from,to,compare=prev` | RH | A |
| GET | `/api/admin/analytics/revenue-series` | chart | `from,to,interval=day\|week\|month` | RH | A |
| GET | `/api/admin/analytics/top-products` | units and revenue by real order lines | `from,to,limit` | RH | A |

Trimmed from six endpoints to three: `orders-by-status` folds into `overview` (the dashboard renders them together anyway) and a generic analytics CSV export is **[LATER]** — the orders export already carries the raw rows.

#### Settings

`OrderPage.jsx:82` hardcodes `subtotal >= 2000 ? 0 : 100`; `TrustBadges.jsx` advertises "Orders over ₹10,000". **These already disagree in production.** Settings makes one row the source of truth — but, honestly, it changes nothing a customer sees until cutover, and the badge text is a component edit even then.

| Method | Path | Purpose | Impl | Auth |
|---|---|---|---|---|
| GET / PUT | `/api/admin/settings/store` | brand name, support email, currency `INR`, timezone `Asia/Kolkata` | RH / SA | A |
| GET / PUT | `/api/admin/settings/shipping` | `freeShippingThreshold` (2000), `flatFee` (100), COD-serviceable pin-code rules | RH / SA | A |
| GET / PUT | `/api/admin/settings/payments` | `codEnabled`, `codOrderCap`, `onlineEnabled` (**non-functional — no gateway exists**) | RH / SA | A |
| GET / PUT | `/api/admin/settings/seo` | default meta, OG image, robots | RH / SA | A |

Cut `settings/integrations` health — with one blob store and one database, "is the DB up" is answered by the page failing to load.

#### Audit and cron

Every mutation writes one `AuditLog` row **inside the same DB transaction** as the change: `{actorId, actorEmail, action, entity, entityId, before, after, ip, userAgent, requestId, createdAt}`. With two roles and potentially several people sharing `ADMIN`, this is the only way to answer "who changed the price".

| Method | Path | Purpose | Body / Query | Impl | Auth |
|---|---|---|---|---|---|
| GET | `/api/admin/audit-logs` | filterable feed | `cursor,limit,actorId,entity,entityId,action,from,to` | RH | A |
| GET | `/api/admin/audit-logs/:id` | full before/after diff | — | RH | A |
| GET | `/api/admin/me` | session bootstrap for the shell | — | RH | A |
| GET | `/api/admin/cron/nightly` | Vercel Cron: purge idempotency records >24h, recompute `orderCount`, raise low-stock notifications | `x-vercel-cron` + `CRON_SECRET` | RH | secret |

---

### (d) Shared list-query convention and pagination

One Zod schema parses every admin list endpoint so the shadcn/TanStack DataTable talks to all of them identically.

| Param | Type | Default | Notes |
|---|---|---|---|
| `page` | int ≥ 1 | 1 | 1-indexed |
| `pageSize` | int 1–100 | 20 | hard-capped server-side; `export` endpoints exist so nobody asks for 5000 |
| `sort` | enum per resource | resource default | **allowlisted column names only** — never interpolate a client string into `ORDER BY` |
| `order` | `asc` \| `desc` | `desc` | |
| `q` | string | — | resource-scoped columns (products: `title`, `slug`, `sku`; orders: `orderId`, `phone`, `email`) |
| filters | resource-specific | — | repeatable keys allowed (`?subcategory=tote&subcategory=sling`), mirroring `ShopPage`'s `searchParams.getAll("subcategory")` |

```ts
type ListResponse<T> = {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
};
```

**Offset vs cursor — committing to offset.** Cursor pagination wins on deep pages of huge tables and loses `total` and "jump to page 7". This store has 39 products, low-hundreds order volume, and a DataTable footer that shows "Page 3 of 12" and a row count — both need `total`. Offset skew is a real defect past roughly 100k rows, which this catalogue will not reach in years.

**Decision: offset/limit with `total` on every admin list endpoint.** One documented exception: `/api/admin/audit-logs` is append-only, unbounded, and read as an infinite feed — it uses opaque `cursor`/`nextCursor` on `(createdAt, id)` and omits `total`. The exception lives in the shared list helper so it cannot spread by accident.

---

### (e) Errors, validation, idempotency, concurrency

**One error envelope, every route, no exceptions:**

```ts
type ApiError = {
  error: {
    code: string;                             // VALIDATION_ERROR, NOT_FOUND, CONFLICT, ...
    message: string;                          // human, safe to toast via sonner
    fieldErrors?: Record<string, string[]>;   // dotted paths: "variants.0.name"
    details?: unknown;                        // { current } on 409; { references } on media delete
    requestId: string;                        // matches the AuditLog row and the pino log line
  };
};
```

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | malformed JSON, bad query param types |
| 401 | `UNAUTHENTICATED` | no session |
| 403 | `FORBIDDEN` / `STEP_UP_REQUIRED` | role `USER` on `/api/admin/*`; or step-up not satisfied |
| 404 | `NOT_FOUND` | unknown id, or a non-published resource on a public route |
| 409 | `CONFLICT` | stale `expectedVersion`, illegal order transition, delete of a referenced entity, duplicate `slug`/`sku` |
| 422 | `VALIDATION_ERROR` | Zod failure with `fieldErrors` |
| 429 | `RATE_LIMITED` | see limits below |
| 500 | `INTERNAL_ERROR` | never leaks a stack; `requestId` is the handle |

**Public routes are the exception to the envelope** — `/api/v1` responses are frozen legacy shapes (bare arrays, raw objects). Public *errors* still use the envelope, but the storefront's axios code only ever inspects `response.data` on success and `console.error`s on rejection, so error bodies there are for our logs, not its UI.

**Validation is field-keyed on purpose.** `fieldErrors` is `zod.flatten().fieldErrors` extended with dotted array paths, mapping straight onto `react-hook-form`'s `setError(path, {message})` — a server-rejected `variants.2.sku` highlights the third variant's input with no translation layer. Schemas live in `lib/validation/` and are imported by both the route handler/action and the form resolver, so client and server cannot drift.

**Rate limits (committed):** `POST /api/auth/login` and `/register` — 5/min per IP + 10/hour per email; `POST /api/v1/orders` — 10/hour per IP; all other `/api/v1` GETs — 120/min per IP (they are CDN-cached anyway); `/api/admin/*` — 300/min per session, purely as a runaway-client guard.

**Idempotency — one store, one caller.** Required on `POST /api/v1/orders` only. The client sends `Idempotency-Key: <uuid>`; the server stores `(key, route, requestHash) → {status, body}` for 24h and replays. This is not theoretical: COD checkout on a flaky Indian mobile connection is exactly where a double-tapped "Place Order" creates two orders, and the storefront's `NIYA-${Date.now()}` scheme would mint two distinct ids for one intent. A mismatched `requestHash` under the same key returns 409 `IDEMPOTENCY_KEY_REUSED`. **Note honestly:** today's `OrderPage` does not send this header — until cutover the guard is dormant, and at cutover the new `orderApi.js` must generate the key once per checkout attempt, not per retry.

**Optimistic concurrency.** Products, variants, categories, pages, footer and content singletons carry an **integer `version` column**, not `updatedAt` — timestamps break on clock skew across serverless instances and on drivers that truncate sub-millisecond precision, so two edits in the same millisecond silently overwrite. The client sends `expectedVersion`; the server does a conditional update and returns 409 with `details.current` (the full fresh record) so the UI can show a real "someone else changed this" diff instead of discarding the operator's work. Orders skip versioning — they use a transition table where `DELIVERED → PACKED` is rejected structurally.

---

### (f) Server Actions vs Route Handlers

| Condition | Use | Why |
|---|---|---|
| Consumer is the Vite storefront, cron, or any non-Next client | **Route Handler** | non-negotiable — see below |
| Admin form submit / mutation from an admin React component | **Server Action** (via `next-safe-action` for typed input, auth middleware and error mapping) | typed end-to-end, no fetch wrapper, `revalidateTag` in the same call |
| Needs a specific status, custom headers, or a non-JSON body (CSV, upload token, provider callback) | **Route Handler** | actions cannot set status codes or content types |
| Read for initial page render | **neither — direct service call in a Server Component** | an admin page must not HTTP-call its own origin to render |
| Client-side incremental read (DataTable paging, search-as-you-type, audit feed, notification poll) | **Route Handler** + TanStack Query | cacheable, cancellable, retryable; Server Actions serialize per session and are a poor fit for rapid refetches |

**Why the public API must be Route Handlers.** A Server Action is Next-internal RPC: invoked by POST to the *page's own route* with a framework-generated `Next-Action` id header, payload in React's serialization format, and an id that is a build-time hash changing on every deploy. An axios call from a Vite bundle cannot construct one, and if it could, the id would break on the next admin deploy. Every byte the storefront consumes is a Route Handler under `/api/v1`, `/api/auth`, or a root rewrite.

**Consequence, stated precisely (this is where the draft contradicted itself):** `/api/admin/*` is **not** a full HTTP mirror of the admin's capabilities. Reads ship as routes because TanStack Query needs URLs; mutations ship as Server Actions and appear in section (c) as *service identities*. Both call the same `lib/services/*` functions, where authorization, validation, the audit write and `revalidateTag` happen exactly once. If a future non-browser client needs a mutation over HTTP, the route is a five-line wrapper over the existing service function.

---

### (g) Media upload

| Approach | Pros | Cons |
|---|---|---|
| **Proxied** (browser → Next route → blob store) | server sees every byte; MIME sniffing and size checks before storage; one code path | **Vercel serverless request bodies cap at 4.5 MB** — `reelsData` ships `.mp4` files, so video upload is dead on arrival; every upload burns function duration and memory |
| **Client-direct** (browser → blob store, server issues a token) | no body-size ceiling; no function time moving bytes; parallel uploads | server never inspects the bytes; must constrain by content-type and size *in the token* |

**Decision: client-direct upload** via the blob SDK's browser `upload()` against `POST /api/admin/media/upload-token`. The decisive fact is `reelsData` — the homepage already ships a local `.mp4`, and a proxied upload physically cannot carry it. The token enforces `allowedContentTypes` (`image/jpeg|png|webp|avif`, `video/mp4|webm`) and per-kind `maximumSizeInBytes` (8 MB images, 100 MB video); the signed `upload-completed` callback writes the `Media` row server-side, so an abandoned upload never leaves a dangling record. The draft's async "quarantine and re-sniff" pass is **cut** — with one trusted operator uploading her own product photos, the token's content-type and size constraints plus the provider-reported metadata are proportionate; a malware pipeline is not.

**One non-obvious requirement:** `Media` must support `kind: EXTERNAL_URL`. The storefront's images are `/products/bags/...` paths inside its own `public/` folder plus external Unsplash/Pexels URLs, and **we may not touch that folder**. Registering a bare URL lets the admin catalogue and reuse every existing asset on day one without re-hosting — and it is what makes the seeded catalogue editable immediately. Consequence to accept: those paths resolve **relative to the storefront's own origin**, so an `EXTERNAL_URL` media row rendered inside the admin preview must be prefixed with the storefront base URL (`NEXT_PUBLIC_STOREFRONT_ORIGIN`), or the admin will show broken images while the storefront shows them fine.

---

### (h) Public read API: exact legacy shapes

`/api/v1` exists to make the commented-out axios blocks correct on the first try. Components destructure these payloads directly, so **field names, nesting and value formats are frozen**. Adding fields is safe; renaming is not.

| Storefront call | Public endpoint | Response | Mapping notes (verified in `src/data/products.js`) |
|---|---|---|---|
| `getAllProducts()` | `GET /products` | bare `Product[]` — **not** `{data}` | `ShopPage`, `SalePage`, `SearchOverlay` treat it as an array. Only `status === "PUBLISHED"`. **Order by `position` asc** — `ShopPage`'s default sort is a no-op comparator, so API order is display order |
| `getProductById(id)` | `GET /products/:id` | `Product` object | legacy matches on `id` via `String(...)` compare; accepting `slug` too is additive and safe |
| `getFeaturedProducts()` | `GET /products?featured=true` | `Product[]` | legacy `limit` defaults to `null` → **return all** featured |
| `getBestSellerProducts()` | `GET /products?bestSeller=true` | `Product[]` | legacy sorts **all** products by `orderCount` desc and slices 8 — reproduce exactly, including the default limit of 8 |
| `getNewArrivalProducts()` | `GET /products?newArrival=true` | `Product[]` | `createdAt` desc, limit 8 |
| `searchProducts(q)` | `GET /products?search=` | `Product[]` | legacy substring-matches `title`, `category`, `subcategory`, `description`; empty query returns everything |
| `getProductsByCategory(sub)` | `GET /products?subcategory=tote` | `Product[]` | repeatable param |
| `getProductsByPriceRange(min,max)` | `GET /products?minPrice=&maxPrice=` | `Product[]` | **compares on `price`, not `finalPrice`** — inclusive on both bounds |
| `getSuggestedProducts(id)` | `GET /products/:id/suggestions` | `Product[]` | legacy = first 6 others **in array order**; keep count 6 and order by `position` |
| `getCategories()` | `GET /categories` | `[{gender, name, filter, image, count}]` | **`filter` must equal the subcategory slug** (`CategorySection` builds `/shop?gender=…&subcategory=${filter}`, and `ShopPage` reads only `subcategory`). `gender` must be lowercase `"women"`/`"men"` — `CategorySection` compares strictly. `image` = category banner if set, else first published product's `variants[0].images[0]`. `count` = published products only |
| `getHeroBanners()` etc. | `/hero-banners`, `/promo-banners`, `/announcements`, `/campaign`, `/reels`, `/craftsmanship`, `/reviews` (root aliases) | exactly the `homeData.js` shapes | `craftsmanship.title` contains a literal `\n`; `description` is `string[2]`; `stats` is exactly 3 `{value,label}`. `promo-banners` must keep `page` + `position` + `isActive` — `PromoBanner.jsx` matches all three. `announcements` are `{id, text}` only. `reviews` are `{name, location, text}` — no rating field |
| `getNotFoundBags()` | `/not-found-bags` (root alias) | `[{id, image}]` | `NotFoundPage` reads only `bag.id`/`bag.image` and doubles the array itself |
| `getFooter()` | `GET /footer` | `{brand, socialLinks[], sections[], customerService, legalLinks[], copyright}` | ids stay in the legacy projection; `sections[].links[].path` are storefront paths |
| `getFooterPage(slug)` | `GET /pages/:slug` | the page's ad-hoc object, or **`null`** | legacy returns `null` for unknown slugs and every consumer does `if (result) setData(result)`. **Return `200` with `null`, not 404** — axios rejects a 404 into the `catch`, leaving those pages stuck on "Loading..." forever |
| `createOrder(payload)` | `POST /orders` | `{orderId, date, status, ...echo}` | anonymous; see below |

**Product shape emitted by `/api/v1/products`** — legacy fields verbatim, additive fields last:

```ts
{ id, slug, title, gender, category, subcategory,
  price, description, isOnSale, salePrice, discountPercentage,
  orderCount, rating, reviewCount,
  createdAt: "2026-08-10",                      // date-only string, NOT ISO datetime
  isFeatured,
  variants: [{ id, name, images: string[] }],   // id is NEW
  finalPrice,                                    // additive; components compute their own today
  // additive, ignored by today's storefront: sku, stock, inStock, status, position, tags,
  // metaTitle, metaDescription, updatedAt
}
```

**`variants[].id` is the highest-value single change in this document and it costs the storefront nothing.** `CartContext.getVariantKey` resolves `selectedVariant?.id || selectedVariant?._id || product.variantId || ""` and, when that is empty, falls back to the bare `productId` — so today every colourway of a bag collapses into one cart line. The moment the API supplies a real variant id, **that bug fixes itself with zero storefront edits**. One caveat to plan for: carts already sitting in `localStorage` were written under the collapsed key and will not retro-fix; they simply age out.

**`orderCount`, `rating`, `reviewCount` stay stored columns, not live aggregates.** They are seeded from `products.js` (e.g. `orderCount: 184`) and are what "best sellers" sorts on. Deriving `orderCount` purely from real order lines on day one would return an effectively empty best-seller row. Decision: `orderCount = seededOrderCount + real order lines`, materialized by the nightly cron and editable by the admin; it converges on truth as real orders accumulate without ever showing an empty homepage.

**Order create echoes the legacy fields.** `OrderPage` sends `{shippingDetails, items, subtotal, shippingFee, totalAmount, paymentMethod}` and then locally invents `orderId`, `date`, `status`. The API returns all three so the storefront can stop inventing them: `orderId` keeps the `NIYA-` prefix but is **server-sequenced**, `date` is returned as the same `toLocaleString("en-IN")` display string in the legacy field **and** as `createdAtIso` alongside it, and `status` is the display projection of the internal enum:

| Internal | Legacy `status` string |
|---|---|
| `PENDING`, `CONFIRMED` | `"ORDER PLACED"` |
| `PACKED` | `"PACKED"` |
| `SHIPPED`, `OUT_FOR_DELIVERY` | `"SHIPPED"` |
| `DELIVERED` | `"DELIVERED"` |
| `CANCELLED`, `RETURN_REQUESTED`, `RETURNED`, `REFUNDED` | `"CANCELLED"` |

`MyOrders.jsx:97` and `OrderReceipt.jsx:200` both render `{order.status || "ORDER PLACED"}` as free text with no branching, so richer values display safely. The projection exists so the one value they were built against still appears where it used to. **Server-side validation on create:** recompute `subtotal`, `shippingFee` (from `settings/shipping`) and `totalAmount` from current published prices and reject a mismatch — the client-sent totals are advisory, never authoritative.

---

### (i) The cutover, stated honestly

**What the admin can change today, and what it cannot.**

| Admin action | Reaches a customer today? |
|---|---|
| Anything at all | **No.** The storefront reads `src/data/*.js` at build time |
| Everything in (c) | Changes the admin's own database and its own UI, immediately and safely |
| Category description / banner / SEO, product `sku`, `stock`, `tags`, meta fields, `colorHex` | Stored now; **no storefront surface renders them even after cutover** — they land with `/api/v2` |
| Trust badges, draft preview, product reviews, coupons, server cart/wishlist | **Not buildable without editing the storefront.** Explicitly deferred |

**The cutover edit, complete:**

1. Set `VITE_API_BASE_URL=https://api.niyabags.com/api/v1` and `VITE_MOCKOON_API_BASE_URL=https://api.niyabags.com`.
2. Uncomment the axios blocks in `productApi.js`, `authApi.js`, `contentApi.js`; delete the localStorage bodies above them.
3. Delete `homeApi.js` and re-export `contentApi` (the exported function names are already identical).
4. Write axios versions of `footerApi.js` (`getFooter`, `getFooterPage`) — none exists.
5. Write `orderApi.js` with `createOrder` and uncomment `OrderPage.jsx:20` and `:144`, adding an `Idempotency-Key` per checkout attempt.
6. Add `footerApi` to the `api.js` barrel (which also repairs the dead `FooterPage.jsx` import).
7. Refactor `CustomerReviews.jsx` and `BrandCraftsmanship.jsx` from synchronous calls to `useEffect` + state.

**Where the draft was wrong, and the honest correction:** this is **not** entirely confined to `src/api/*.js`. Step 5 touches `OrderPage.jsx`, step 7 touches two components, and — importantly — **server-backed order history additionally requires editing `MyOrders.jsx`**, which reads `localStorage["niyaOrders"]` directly with no API layer to repoint. The minimal honest cutover keeps `OrderPage` writing `niyaOrders` locally *and* posting to the API, so order history keeps working unchanged while the admin starts receiving real orders; replacing `MyOrders` with a server read is a second, separate change. Cart and wishlist stay device-local in every scenario in this document.

Roughly a day of mechanical work in a repo we are not touching today — and every decision above exists to keep it a day rather than a rewrite.


**Decisions**

- FIX: Public checkout is now explicitly ANONYMOUS. Verified OrderPage.jsx calls useAuth() only to prefill the form and never gates or redirects; the draft's layering table required a customer JWT cookie on POST /api/v1/orders, which would have broken checkout for every guest.
- FIX: Corrected the price-range contract. products.js getProductsByPriceRange compares product.price, not finalPrice; the draft said 'compare on finalPrice', which would return a different product set than the storefront does today.
- FIX: Corrected the cache-invalidation mechanism. revalidateTag purges the framework Data Cache, NOT a hand-set s-maxage CDN entry, so the draft's design could never invalidate. Committed to tagged cached functions + a short 60s s-maxage + 7-day stale-while-revalidate, and added Vary: Origin.
- FIX: Removed the false claim that a product edit and its revalidateTag share 'the same transaction boundary'. Invalidation is post-commit and best-effort; the worst-case customer-visible staleness is now stated as one minute.
- FIX: Corrected the central honesty claim. The cutover is NOT confined to src/api/*.js: MyOrders.jsx reads localStorage 'niyaOrders' directly, so server-backed order history needs a component edit. Added the minimal dual-write cutover that avoids it.
- FIX: Added the customer-account migration reality the draft ignored: passwords are plaintext in per-device localStorage and unreachable by any server, so no accounts can be migrated at cutover.
- FIX: Committed a concrete cross-origin cookie policy (customer cookie Domain=.niyabass domain, SameSite=Lax/Secure; admin cookie host-only) because authApi sets withCredentials:true. The draft hand-waved this as 'allowlist, credentials: true'.
- FIX: Promoted `position` from merchandising nice-to-have to a correctness requirement. ShopPage's default sortBy '' returns 0 from its comparator and getSuggestedProducts takes 'first 6 in array order', so API order IS display order and must be deterministic.
- FIX: Corrected the /api/v1/categories contract with verified facts: image derives from the first product's variants[0].images[0] (no product has top-level images/thumbnail), gender must be lowercase because CategorySection compares strictly, and count must be published-only.
- FIX: Specified all three list-limit defaults. ?featured=true returns ALL featured (legacy limit defaults to null); bestSeller/newArrival default to 8. The draft only specified two.
- FIX: Resolved the draft's internal contradiction between '90 HTTP endpoints' and 'the admin never calls /api/admin/* from its own forms'. Added an Impl column: reads ship as Route Handlers, mutations ship as Server Actions with the path as service identity.
- FIX: Deleted /api/v1/cart/* from the build. cartApi.js is dead code (CartContext never imports it), so serving it produces an endpoint with no caller; making it useful requires a forbidden storefront rewrite.
- FIX: Cut the Discount entity, scheduling, preview/apply/revert rule engine to [LATER]; v1 is a bulk product patch on the existing isOnSale/salePrice/discountPercentage fields plus a snapshot-based revert.
- FIX: Cut the SSE notification stream (a live serverless function per open tab for one operator) and committed to 60s TanStack Query polling.
- FIX: Cut content preview-tokens entirely. Previewing drafts requires a storefront route that can render unpublished data; the storefront is a separate app we may not touch, so the draft's signed preview token was unimplementable. Preview happens inside the admin.
- FIX: Cut CSV import with dry-run, bulk stock-take, media quarantine re-scan, settings/integrations health, per-product audit endpoint, orders/:id/invoice endpoint, and customers/audit/analytics CSV exports; analytics trimmed 6 endpoints to 3.
- FIX: Trimmed step-up re-auth from ten routes to two (role grant, anonymize) - friction without a threat model for a single-operator store.
- FIX: Scoped the idempotency store to exactly one route (public order create). Admin order mutations dedupe naturally: transitions are declared as target states, and payment/refund rows are unique on (orderId, reference).
- FIX: Corrected the best-seller data source. The draft said orderCount comes 'from real order-line counts', which would return an empty best-seller row on day one; committed to seededOrderCount + real order lines, materialized nightly.
- FIX: Demoted product reviews to model-only. No storefront surface submits a review (ProductDetails renders hardcoded rating/reviewCount, no form exists), so a moderation queue would be permanently empty; testimonials only in v1.
- FIX: Unified the content publish model. The draft had both status DRAFT/PUBLISHED and a separate isActive toggle; committed to one status with isActive emitted as a derived legacy field only for promo-banners/reels, which filter on it.
- FIX: Corrected the trust-badge design. TrustBadges.jsx stores react-icons COMPONENT references, not strings, so admin ownership needs an allowlisted icon-key enum plus a client-side map - a storefront edit, hence [LATER].
- FIX: Corrected the page-slug list with the /care-guide nuance: AppRoutes maps /care-guide to SizeCarePage which hardcodes slug 'size-guide', so the pages API is called with exactly 8 slugs and care-guide is not one of them.
- FIX: Noted that EXTERNAL_URL media paths like /products/bags/... resolve against the storefront origin, so the admin preview needs NEXT_PUBLIC_STOREFRONT_ORIGIN or images break in the admin only.
- FIX: Added a snapshot contract test per /api/v1 endpoint - the only defense against silent shape drift on a frozen compatibility surface whose consumer cannot be tested from this repo.
- FIX: Added concrete rate limits, a Vercel Cron row (idempotency purge, orderCount recompute, low-stock alerts), GET /api/admin/me, and the signed media upload-completed callback the draft's flow implied but never listed.
- FIX: Added an explicit 'what the admin can and cannot change today' table so no stored-but-invisible field (category SEO, sku, stock, tags, colorHex) is mistaken for a live storefront control.
- FIX: Server-side recomputation of subtotal/shippingFee/totalAmount on order create; client-sent totals are advisory.
- FIX: Noted 39 products (verified count), not '~40', and that Idempotency-Key is dormant until the new orderApi.js sends it.

**Open assumptions**

- Postgres via Prisma. Nothing in the repo picks a database; the offset-pagination and integer-version decisions assume SQL with unique indexes.
- The public API is served from the same Vercel project as the admin, aliased to api.niyabags.com on the same registrable domain as the storefront. If the storefront lives on a different registrable domain, the customer cookie must become SameSite=None; Secure and CORS must echo the exact origin.
- Vercel Blob as the object store because deployment is on Vercel. Any S3-compatible store works with the same token design; only the token route and the completed-callback change.
- The 39 products in src/data/products.js are seeded into the database as the initial catalogue with generated sku, stock, position and variant ids, rather than re-entered by hand. Their existing image paths are registered as EXTERNAL_URL media.
- Server-side cart and wishlist are OUT OF SCOPE and cartApi.js is treated as dead code. Confirm you do not want a server cart before the storefront is rebuilt.
- Transactional email does not exist. Notifications are in-app only until an email provider is chosen; order confirmation emails are not part of this phase.
- Step-up re-auth on the two privileged actions assumes credentials-based admin sign-in. If admin sign-in is OAuth-only, step-up becomes a re-consent prompt.
- The storefront cutover is a separate, later, sanctioned change - and it will touch OrderPage.jsx, CustomerReviews.jsx and BrandCraftsmanship.jsx in addition to src/api/*.js. Confirm that is acceptable, or accept that orders and the two synchronous content sections stay local-only.
- Admin-authored testimonials replace the three hardcoded ones; you are not expecting real customer product reviews in this phase.
- 'Best sellers' keeps its seeded orderCount baseline rather than starting from zero real orders. If you prefer a truthful-but-empty best-seller row on day one, say so.

**Risks**

- The frozen /api/v1 surface cannot be integration-tested against its real consumer from this repo - the Vite app is untouched and still reads local files. The snapshot contract tests assert our side only; the first real proof is cutover day.
- Storefront availability becomes coupled to this project's origin after cutover. The 7-day stale-while-revalidate covers blips, but a cold CDN plus an origin outage means empty product grids. Extracting /api/v1 to its own project later is a folder move, but the deploy and env story doubles.
- revalidateTag plus a 60s s-maxage means a content edit can take up to a minute to appear. If the operator expects instant, the CDN cache must drop to s-maxage=0 with stale-while-revalidate only, trading origin load for immediacy.
- COD with no payment gateway means paymentStatus PAID is always a manual human claim. The refund endpoint records an intent, not a movement of money; reconciliation against a bank statement is out of band and can silently drift.
- The variant-id fix only applies to carts created after cutover. Existing localStorage carts keep the collapsed key, so a customer mid-purchase may see a colourway merge until their cart clears - unavoidable without touching CartContext.
- Order ids: the storefront mints NIYA-${Date.now()} today and the server will mint a sequenced NIYA- id after cutover. Any order placed before cutover exists only in one device's localStorage and can never be imported into the admin - the operator's order history starts empty on cutover day.
- Anonymous checkout means Customer rows are order-derived contacts keyed on phone/email. Deduplication is heuristic; the same buyer with two phone numbers is two customers, and lifetime-value figures inherit that error.
- The stored-but-invisible fields (category SEO, product sku/stock/tags, colorHex) invite the operator to believe she is editing the live site. This is a UX risk, not a technical one, and must be mitigated by explicit 'not yet visible on niyabags.com' labelling in the admin.
- One Vercel project serving both the admin UI and the public read API shares a rate-limit and function-concurrency budget. A traffic spike on /api/v1 can slow the admin, and vice versa.
- Root-level rewrites (/hero-banners, /reels, ...) permanently occupy top-level paths in the same project as the admin UI. Any future admin page named after one of those paths silently loses to the rewrite.

---

## Data Model and Entity Architecture

### 0. The frame: what this schema can and cannot reach today

This model lives entirely in `admin_panel/`. Nothing in it reaches the storefront.

The storefront's `src/api/*.js` are adapters over `src/data/*.js` static arrays. `productApi.js` re-exports local helpers, `homeApi.js` and `footerApi.js` return frozen objects, `contentApi.js` is 100% commented out. Until those files are repointed, an admin can publish a hero banner, reprice a bag and archive a product, and the live site renders exactly what it renders now. Every "legacy serializer" below exists for one purpose: to make that later, separate cutover a mechanical change confined to `src/api/`.

**One verified exception, and it is the cheapest possible first slice.** `notFoundApi.js` is real HTTP today: `contentApi.get("/not-found-bags")`, where `contentApi.baseURL = import.meta.env.VITE_MOCKOON_API_BASE_URL || "http://localhost:3001"`. In production that env var is unset, so the call hits `localhost:3001` and fails silently (`NotFoundPage.jsx` catches and renders zero bags). It consumes `[{ id, image }]` and nothing else.

> **Cutover pilot:** serving `GET /not-found-bags -> [{id, image}]` from the admin and setting `VITE_MOCKOON_API_BASE_URL` on the storefront's Vercel project makes one endpoint genuinely admin-controlled **with zero file changes inside `e-commerce_frontend-main/`** — an env var and a CORS header. Everything else needs the cutover PR.

### 1. Seven commitments

| # | Decision | Reason |
|---|---|---|
| 1 | **Postgres 17 on Neon + Prisma 6** | Migration history plus Prisma Studio give a solo dev a data escape hatch on day one, before any admin UI exists. |
| 2 | **Money = `Int` paise** | Prisma `Decimal` serialises to a *string*; the legacy contract requires `price: 2999` as a JSON **number**. Ceiling is **₹2.14 crore** per column (`Int` max 2,147,483,647 paise) — ample, and not the ₹21.4 crore an earlier draft claimed. |
| 3 | **Category is a real 2-level tree; `audience` is a Product enum** | Verified: every product is `category:"bags"` with one of five subcategories, and the split is 36 women / 3 men. A gender-rooted tree creates five near-empty men's branches. |
| 4 | **One shipping option axis (COLOUR), through a generic model with a *global* value vocabulary** | `ShopPage.jsx` filters by matching `selectedColors` against `variant.name` strings — colour labels are a public filter key, so they cannot be per-product free text. |
| 5 | **Three orthogonal status enums** plus a legacy string shim | COD India needs RTO; the storefront renders exactly one string today: `"ORDER PLACED"`. |
| 6 | **HomepageSection = ordered, typed, polymorphic rows with Zod-validated JSON payloads** | A new section type costs a registry entry, not a migration. |
| 7 | **Cut nine tables the draft proposed** | Payment, Shipment, Cart/CartItem, WishlistItem, Address, Faq, DiscountRedemption, Notification, Review are all `[LATER]` with named triggers. See §12. |

### 2. Database and ORM

**Postgres 17 on Neon, Prisma 6 with `driverAdapters` and `@prisma/adapter-neon`.**

Drizzle is better on cold-start bundle and raw-SQL fidelity, and for a high-QPS public API I would pick it. This is not that: it is an admin panel for a store with **39 products and zero orders**. What costs a solo developer time here is schema evolution and *seeing* the data. Prisma wins both. The admin's heaviest reads are deep includes (`Order -> OrderItem -> ProductVariant -> Product -> ProductImage -> Media`), where Prisma's typed `include` is strongest.

The Prisma-on-Vercel cold-start objection is answered by the Neon serverless adapter on request paths plus a pooled TCP `DIRECT_URL` for migrations. Neon over Supabase because we need none of Supabase's auth or storage (Auth.js v5 + Vercel Blob cover those), and Neon's branch-per-preview-deploy gives every migration PR its own database. **Pin Prisma to an exact version** — a floating minor has changed generated-client shapes before.

Supporting packages: `zod` (one schema set shared by the section registry, server actions and route handlers), `@t3-oss/env-nextjs` (fail the build on a missing `DATABASE_URL`), **`@node-rs/argon2`** (the pure-Rust binding; the classic `argon2` native module does not build reliably on Vercel's serverless runtime), `nanoid` for public ids.

**Email uniqueness:** Prisma does not model `citext` cleanly. Commit to lowercase-on-write in the repository layer plus a plain unique index — which matches the legacy `authApi.js`, which already compares `item.email?.toLowerCase()`.

```
admin_panel/src/server/
  db/prisma.ts              # singleton client + Neon adapter
  repositories/             # the ONLY place raw prisma is imported
  services/                 # transactions, invariants, audit writes
  serializers/
    legacy/                 # byte-compatible with src/data/*.js
    admin/                  # rich shapes for admin screens
  content/section-registry.ts
```

### 3. Cross-cutting conventions

| Convention | Commitment |
|---|---|
| Primary keys | `cuid()` strings. URL-safe, no sequence leakage of order volume. |
| Public identifiers | Catalog entities carry `publicId String @unique` — seeded to the legacy id (`"handbag-001"`), `nanoid(12)` for new rows. **The public read API emits `publicId` as `id`.** Verified necessity: `/product/:id` resolves via `getProductById` which matches on `product.id`, and `niyaWishlist` / `niya_cart` keys in live browsers are built from it. Changing a `publicId` breaks a bookmarked URL. |
| Timestamps | `createdAt`/`updatedAt` `timestamptz`, UTC in DB, rendered `Asia/Kolkata`. `publishedAt` is **separate** and editor-controlled — new-arrivals ordering is editorial, not row-insert order. |
| Soft delete | `deletedAt DateTime?` on **Product, ProductVariant, Category, Media, CmsPage, Discount, User** only. **Never** on Order / OrderItem / OrderEvent / StockMovement / AuditLog — append-only ledgers. |
| Soft-delete enforcement | Prisma has no global soft-delete filter. Every query goes through `src/server/repositories/*`, where a `scope()` helper injects `deletedAt: null`. Enforce with an ESLint `no-restricted-imports` rule banning `@/server/db/prisma` outside that directory. |
| Slug uniqueness | **Partial** unique indexes hand-written into migration SQL: `CREATE UNIQUE INDEX ... ON "Product"(slug) WHERE "deletedAt" IS NULL`. Prisma's `@@unique` cannot express a predicate. **Consequence the repository layer must absorb:** because the index is not declared in the Prisma schema, `findUnique({where:{slug}})` is unavailable — slug lookups use `findFirst` with the scope filter. All 39 legacy slugs and all 39 legacy ids verified unique, so the importer needs no de-duplication. |
| Money | `Int` paise (`priceMinor`, `subtotalMinor`). Divide by 100 **only in the legacy serializer**. |
| Ratings | `ratingTenths Int` (47 = 4.7), so JSON emits `4.7` as a number. |
| Enums | Postgres native enums. Adding a value is a cheap `ALTER TYPE`; removing is not — keep them tight. |

### 4. Identity and access

Two roles, exactly: `enum Role { ADMIN USER }`.

| Entity | Purpose | Key fields | Priority |
|---|---|---|---|
| **User** | Customers and the 1–2 admins. | `id`, `email` (unique, lowercased), `emailVerified`, `name`, `phone`, `passwordHash` (argon2id, nullable for OAuth-only), `role Role @default(USER)`, `image`, `defaultAddress Json?`, `lastLoginAt`, `deletedAt` | **REQUIRED NOW** |
| **Account** | Auth.js OAuth link rows. | Standard adapter shape: `provider`, `providerAccountId` (`@@unique`), tokens | **REQUIRED NOW** |
| **Session** | DB sessions. | `sessionToken @unique`, `userId`, `expires` | **REQUIRED NOW** |
| **VerificationToken** | Email verify / reset. | `identifier`, `token @unique`, `expires` | **REQUIRED NOW** |

Adopt the **full Auth.js v5 adapter schema even though the session strategy is JWT** — `Account` is needed the day Google sign-in lands, and switching strategies should never be a migration.

**No `Address` table in v1.** `OrderPage.jsx` renders a single flat shipping form prefilled from the auth user; there is no address-book UI anywhere in the storefront to feed a normalized table. v1 keeps `User.defaultAddress Json?` (last-used, Zod-validated) and snapshots the real address onto the Order. `[LATER]` trigger: an address-book screen ships in the storefront.

**Order-time addresses are snapshotted onto the Order as JSON, never FK'd** — a customer editing an address must not rewrite the shipping label on a delivered order.

**Do not import `localStorage["niyaUsers"]`.** Verified: `authApi.js` stores `password` in plaintext inside the user object and compares it directly. There is no hash to migrate, and importing it would move a plaintext credential store into a production database. Customers re-register; announce it at cutover.

### 5. Catalog

#### 5.1 Audience vs category — settled

`getCategories()` groups by `` `${gender}-${subcategory}` `` and returns `{gender, name, filter, image, count}`. Three options considered:

1. **Gender as top tree level.** Rejected: 36 women / 3 men means five near-empty men's branches, every category edit doubles, `?subcategory=sling` becomes ambiguous, and "unisex" is unrepresentable.
2. **Gender as a generic attribute row.** Rejected: it is queried on nearly every storefront screen and deserves an indexed column, not a join.
3. **Gender as an indexed enum on Product.** **COMMITTED.** `enum Audience { WOMEN MEN UNISEX }`.

`Category` is therefore a real tree keyed on product type only, and it already exists in the data: `Bags` (root) with five leaves — **minibags 14, sling 9, tote 7, handbags 6, wallet 3** (verified). Product FKs to a single leaf `categoryId`. A future unisex line costs one enum value, not a tree migration.

#### 5.2 Is size a real axis for handbags?

No — not now. In apparel, size is an axis because the same garment exists in six bodies. A handbag's "size" is its *silhouette*, which this store already models as category. A `Size` option would produce single-value option sets on all 39 products: pure ceremony.

But the axes that will appear are real: leather finish, hardware, and occasionally one style in Small/Large. The current data already leaks this — the seven distinct values are `Black 34, Brown 22, Beige 9, Tan 9, Pink 2, Gold 1, Coffee 1`, mixing hardware (`Gold`) and leather finish (`Coffee`) into "colour."

**Commit: build the generic option model now, ship exactly one axis (COLOUR).**

**With one correction the draft missed: the value vocabulary must be global, not per-product.** `ShopPage.jsx` builds its colour facet from every product's `variant.name` and filters with `productVariantNames.includes(c.toLowerCase())`. If each product owned its own free-text values, an admin typing "Jet Black" on one product silently splits the shop filter. So `OptionValue` is a **controlled, store-wide vocabulary** the admin picks from; adding a new colour is a deliberate act with its own screen.

#### 5.3 The variant-id question — the draft's headline claim is false

The draft asserted that emitting `variants[].id` "fixes a live cart bug with zero storefront code change." **I traced `CartContext.jsx` line by line and it does not.**

`getVariantKey` is indeed variant-aware. But `addToCart`'s `else` branch runs a second check:

- `hasExisting = prevItems.some(item => itemProductId === productId || String(item.id).startsWith(productId + "-"))`
- If true, it **filters out every line for that product** and appends the new one.

Since each cart line stores `_id = product.id`, `hasExisting` is true for *any* existing line of the same bag regardless of variant ids. So:

| | Add Black, then Brown |
|---|---|
| **Today (no variant ids)** | Keys collide -> quantity increments to 2 on the Black line. Wrong label, wrong basket. |
| **With `variants[].id` emitted** | Keys differ -> falls into `else` -> `hasExisting` true -> **Black is evicted**, Brown replaces it at qty 1. |

Both are wrong. Emitting ids **changes** the failure mode, it does not fix it. `isInCart` compounds this: it returns true when `itemProductId === targetProductId`, so the card toggle is product-level, not variant-level.

**Honest commitment:** stable variant ids are a *precondition* of the fix and are independently mandatory (OrderItem lines, inventory, server wishlist merge, the `?subcategory`/colour facets). But the fix itself is roughly ten lines inside `CartContext.jsx` — deleting the `hasExisting` eviction branch and tightening `isInCart` — and it **belongs in the cutover PR, not this one.** Nothing in `admin_panel/` can repair it. Ship variant ids; do not claim the cart is fixed.

#### 5.4 Catalog entities

| Entity | Purpose | Key fields | Priority |
|---|---|---|---|
| **Category** | Real tree, replaces the derived facet. | `id`, `publicId`, `slug` (partial unique), `name`, `parentId?`, `depth Int`, `position Int`, `description?`, `heroMediaId?`, `seoTitle?`, `seoDescription?`, `isActive`, `deletedAt` | **REQUIRED NOW** |
| **Product** | Catalog root. | `id`, `publicId`, `slug`, `title`, `description`, `audience Audience`, `categoryId`, `status ProductStatus`, `priceMinor Int`, `compareAtMinor Int?`, `costMinor Int?`, `saleStartsAt?`, `saleEndsAt?`, `isFeatured`, `position Int`, `orderCount Int`, `ratingTenths Int`, `reviewCount Int`, `ratingSource RatingSource`, `seoTitle?`, `seoDescription?`, `publishedAt?`, `deletedAt` | **REQUIRED NOW** |
| **OptionValue** | **Store-wide** controlled vocabulary. | `id`, `type OptionType`, `label` ("Black"), `slug`, `swatchHex?`, `position`, `@@unique([type, slug])` | **REQUIRED NOW** |
| **ProductOption** | Which axes a product uses. | `productId`, `type OptionType`, `position`, `@@unique([productId, type])` | **REQUIRED NOW** |
| **ProductVariant** | The **purchasable unit**; carries the stable id. | `id`, `publicId`, `productId`, `sku @unique`, `priceMinor Int?` (null = inherit), `compareAtMinor Int?`, `position`, `isActive`, `weightGrams Int?`, `deletedAt` | **REQUIRED NOW** |
| **VariantOptionValue** | Join: variant ↔ its value on each axis. | `variantId`, `optionValueId`, `@@unique([variantId, optionValueId])`; service-layer invariant: at most one value per `OptionType` per variant | **REQUIRED NOW** |
| **ProductImage** | Ordered slots for a variant (product-level when `variantId` is null). | `productId`, `variantId?`, `mediaId`, `position`, `alt?`, `@@unique([variantId, position])` | **REQUIRED NOW** |
| **Media** | Central asset table. | `id`, `provider MediaProvider`, `sourceUrl @unique` (decode-normalised), `storageKey?`, `checksum String? @unique`, `mimeType`, `width?`, `height?`, `sizeBytes?`, `blurDataUrl?`, `alt?`, `folder?`, `uploadedById?`, `deletedAt` | **REQUIRED NOW** |

`enum ProductStatus { DRAFT ACTIVE ARCHIVED }` · `enum OptionType { COLOUR MATERIAL HARDWARE SIZE }` · `enum RatingSource { SEEDED COMPUTED }` · `enum MediaProvider { VERCEL_BLOB LEGACY_PATH EXTERNAL_URL }`.

**Three corrections on `Media`, all verified against the data.**

1. **The dedupe key is `sourceUrl`, not `checksum`.** The draft made `checksum @unique` the dedupe mechanism, which contradicts its own `EXTERNAL_URL` provider: you cannot hash bytes you never fetch. Six assets are remote (2 Unsplash stills, 3 Pexels videos, 1 slidesdocs banner) and will never have a checksum at import. So `checksum` is **nullable**, unique when present, computed by the local extractor for files it can read on disk; `sourceUrl` is the always-present dedupe key.
2. **Normalise the URL before deduping.** Hero banner paths are percent-encoded (`WhatsApp%20Image%20...%281%29.jpeg`) while product paths are raw (`WhatsApp Image ... (1).jpeg`). Verified: `heroBannersData[1].image` and `handbag-001`'s Black image are **the same file under two different strings**. Without `decodeURIComponent` normalisation the importer creates duplicate Media rows.
3. **The 234 -> 39 collapse is real but the draft's explanation is wrong, and the true reason is a content-quality alarm.** The draft said "each variant repeats one file three times", which would give 78 unique files. Measured: **78 variants, 234 references, 39 distinct files.** Every variant does repeat one file three times *and* **21 of the 39 files are shared across different variants and different products** — one file is the "Black" image of seven different minibags and also serves as "Tan" and "Pink" elsewhere. The images do not depict the colours they are attached to. The importer preserves all 234 positions faithfully; the admin's product screen should surface a "reused image" badge so this is visible rather than inherited silently.

Legacy paths like `/products/bags/handbags/...jpeg` resolve **only on the storefront origin** (verified: all 39 exist under `public/products/`, none missing). They import as `provider: LEGACY_PATH` with the relative path preserved so the storefront keeps working unchanged. The admin renders them by prefixing `NEXT_PUBLIC_STOREFRONT_ORIGIN`, so the Media library is not a wall of broken thumbnails. A separate optional "rehost to Blob" job flips them to `VERCEL_BLOB`. **Do not block cutover on rehosting.**

`ratingSource` exists because today's `rating: 4.7` / `reviewCount: 64` are hardcoded numbers unconnected to any review — there is no review submission UI anywhere in the storefront. Seeding them preserves the UI; tagging them `SEEDED` means the admin can see exactly which products still display fabricated social proof.

#### 5.5 Legacy product contract

`GET /api/public/v1/products` must return the **exact** legacy array. One database, two serializers: `serializers/legacy/product.legacy.ts` and `serializers/admin/product.admin.ts`.

| Legacy field | Type | New source |
|---|---|---|
| `id` | string | `Product.publicId` (seeded `"handbag-001"`) |
| `slug` | string | `Product.slug` |
| `title` | string | `Product.title` |
| `gender` | `"women"\|"men"` | `Product.audience`, lowercased |
| `category` | `"bags"` | relation — `Category.parent.slug` |
| `subcategory` | string | relation — `Category.slug` (leaf) |
| `price` | number ₹ | computed — `(compareAtMinor ?? priceMinor) / 100` (the **list** price) |
| `salePrice` | number \| null | computed — on sale ? `priceMinor / 100` : `null` |
| `isOnSale` | bool | computed — `compareAtMinor != null && now ∈ [saleStartsAt, saleEndsAt]` |
| `discountPercentage` | number | computed — `round((compareAt − price) / compareAt × 100)` |
| `description` | string | `Product.description` |
| `orderCount` | number | `Product.orderCount` (denormalised counter) |
| `rating` | number | computed — `ratingTenths / 10` |
| `reviewCount` | number | `Product.reviewCount` |
| `createdAt` | `"2026-08-10"` | `Product.publishedAt` as `yyyy-MM-dd` — **not** row `createdAt` |
| `isFeatured` | bool | `Product.isFeatured` |
| `variants[].name` | string | relation — the variant's COLOUR `OptionValue.label`, **verbatim** (public filter key) |
| `variants[].images[]` | string[] | relation — `ProductImage -> Media`, ordered by `position` |
| `variants[].id` | — | **NEW, additive** — `ProductVariant.publicId`. Precondition for the cart fix, not the fix itself (§5.3). |

**Keep this payload lean.** `CartContext` spreads the entire product object into `localStorage["niya_cart"]`; padding the response with admin columns pushes real carts toward the 5 MB quota. SKU, stock, cost and SEO stay on the admin serializer only.

The other helpers, mapped precisely — and the four places where the draft's mapping silently changed behaviour:

| Legacy helper | Verified behaviour today | Query shape |
|---|---|---|
| `?featured` | `products.filter(isFeatured)` — **no limit**, returns all 16 | `isFeatured && status=ACTIVE`, unlimited |
| `?bestSeller` | sort `orderCount` desc, slice 8 | `orderBy orderCount desc limit 8` |
| `?newArrival` | sort `createdAt` desc, slice 8 | `orderBy publishedAt desc limit 8` |
| `?search` | substring over `title`, `category`, `subcategory`, `description` | `pg_trgm` GIN over the same four, joined |
| `?minPrice`/`?maxPrice` | filters on `p.price` — the **list** price, not the sale price | range on `(compareAtMinor ?? priceMinor)`. The draft said "effective price"; that is a silent behaviour change and is rejected for v1. |
| `/products/:id/suggestions` | `filter(id !== current).slice(0, 6)` — the first six in array order | same-category, same-audience, exclude self, **top up from the rest of the catalogue to always return exactly 6**. This is a *visible* behaviour change (different bags render) even though the shape is identical. Call it what it is. |
| `getCategories()` | `GROUP BY (gender, subcategory)`, `image` taken from the **first product in the group**'s first variant image | `GROUP BY (audience, categoryId)` over `status=ACTIVE`; `image` = `Category.heroMediaId` if set, **else** the same first-product fallback, so the payload stays byte-identical until an admin sets a hero. The draft omitted `image` entirely. |

**"New arrivals" has two contradictory definitions in the storefront today** and `publishedAt` must serve both: `?filter=new-arrivals` uses `getNewArrivalProducts` (top 8 by date), while `ShopPage`'s `availabilityFilter` uses a rolling **30-day window**. Do not unify them at cutover; reproduce both.

### 6. Inventory

There is no stock field anywhere. Worth flagging precisely: `ShopPage.jsx`'s `availabilityFilter` looks like stock but is not — it filters `sale | featured | best-sellers | new-arrivals`. **Nothing in the storefront can be out of stock.**

| Entity | Purpose | Key fields | Priority |
|---|---|---|---|
| **InventoryItem** | 1:1 with ProductVariant. The only place quantity lives. | `variantId @unique`, `onHand Int`, `reserved Int`, `lowStockThreshold Int @default(2)`, `trackInventory Boolean @default(false)`, `allowBackorder Boolean @default(false)` | **REQUIRED NOW** |
| **StockMovement** | Append-only ledger; every change to `onHand`/`reserved`. | `variantId`, `delta Int`, `reason StockReason`, `orderId?`, `note?`, `actorId?`, `createdAt` | **REQUIRED NOW** |

`available = onHand − reserved`, **computed, never stored** — a stored third column is a guaranteed drift bug. `onHand` is a denormalised cache of `SUM(StockMovement.delta)`; every write is one transaction that inserts the movement and updates the cache. A weekly (not nightly — this is a 39-SKU store) reconciliation job compares them and emails the admin on mismatch.

`enum StockReason { IMPORT PURCHASE_RECEIVED ORDER_RESERVED ORDER_FULFILLED ORDER_CANCELLED RETURN_RESTOCK RTO_RESTOCK DAMAGE MANUAL_ADJUSTMENT RECOUNT }`

**Reserve at order placement, not add-to-cart.** With COD and no gateway there is no authorisation hold to hang a cart reservation on, and the cart is device-local anyway. Reserve on `PLACED`, decrement `onHand` on `SHIPPED`, release `reserved` on `CANCELLED`, restock on `RETURNED` or `RTO_DELIVERED`.

**Single location. No warehouse entity.** `[LATER]`: multi-location is a `locationId` on `InventoryItem` and `StockMovement`, nothing more.

**The critical import default: `trackInventory = false` on all 78 seeded variants.** Today every product is infinitely purchasable. Importing with tracking on and `onHand = 0` would silently take the entire catalogue out of stock at cutover. The admin enables tracking per variant after a physical count.

### 7. Commerce

#### 7.1 Status model and the legacy shim

The storefront's entire status vocabulary is one string, `"ORDER PLACED"`, rendered verbatim by `OrderReceipt.jsx` and `MyOrders.jsx`.

```
enum OrderStatus       { PENDING PLACED CONFIRMED PACKED SHIPPED OUT_FOR_DELIVERY
                         DELIVERED CANCELLED RETURN_REQUESTED RETURNED
                         RTO_INITIATED RTO_DELIVERED }
enum PaymentStatus     { PENDING PAID FAILED PARTIALLY_REFUNDED REFUNDED }
enum FulfillmentStatus { UNFULFILLED PARTIALLY_FULFILLED FULFILLED RETURNED }
enum PaymentMethod     { COD ONLINE }
```

`RTO_*` is not padding — return-to-origin is the defining failure mode of Indian COD and the single most important number on the admin dashboard. `PaymentStatus.PENDING` is the normal state of a COD order in transit, flipping to `PAID` on cash collection. `ONLINE` is a selectable radio in `OrderPage.jsx` with **no gateway integrated anywhere** — model it, gate it behind `StoreSetting["payments.onlineEnabled"] = false`.

| OrderStatus | legacy `status` string |
|---|---|
| `PENDING`, `PLACED` | `ORDER PLACED` |
| `CONFIRMED`, `PACKED` | `PROCESSING` |
| `SHIPPED`, `OUT_FOR_DELIVERY` | `SHIPPED` |
| `DELIVERED` | `DELIVERED` |
| `CANCELLED` | `CANCELLED` |
| `RETURN_REQUESTED`, `RETURNED`, `RTO_INITIATED`, `RTO_DELIVERED` | `RETURNED` |

**Full legacy order payload contract** (the draft specified the entities but never mapped them back):

| Legacy field | Source |
|---|---|
| `orderId` | `Order.orderNumber` |
| `date` | `Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata" })` server-side — a locale string, matching `new Date().toLocaleString("en-IN")` |
| `placedAt` | **NEW, additive** — ISO 8601, for anything built after cutover |
| `status` | shim table above |
| `paymentMethod` | `Order.paymentMethod` |
| `subtotal`, `shippingFee`, `totalAmount` | `subtotalMinor`, `shippingMinor`, `totalMinor` ÷ 100 |
| `discount`, `discountCode` | **NEW, additive** — §7.3; the storefront ignores unknown fields |
| `shippingDetails` | `Order.shippingAddress` JSON snapshot, projected to `{fullName,email,phone,address,city,state,pinCode}` |
| `items[]` | `OrderItem[]` -> `{productId, variantId, title, price, quantity, selectedVariant}` |

**`orderNumber` format — the draft's proposal is not implementable.** It called for "a zero-padded daily sequence from a Postgres sequence"; a Postgres sequence does not reset daily, and a monotonic global one leaks lifetime order volume. Commit instead to **`NIYA-YYMMDD-XXXX`**, where `XXXX` is four Crockford-base32 characters, `@unique`, retried up to three times on conflict. No collision (unlike `NIYA-${Date.now()}`), no volume leak, human-readable on the phone. The storefront only prints it, so the format is free.

**Guest checkout is the default and `Order.userId` is nullable.** `OrderPage.jsx` prefills from the auth user but does not require a session; `/order` is not a protected route.

#### 7.2 Commerce entities

| Entity | Purpose | Key fields | Priority |
|---|---|---|---|
| **Order** | Immutable financial record. | `id`, `orderNumber @unique`, `userId?`, `status`, `paymentStatus`, `fulfillmentStatus`, `paymentMethod`, `subtotalMinor`, `discountMinor`, `shippingMinor`, `taxMinor`, `totalMinor`, `currency @default("INR")`, `shippingAddress Json`, `contactEmail`, `contactPhone`, `discountId?`, `discountCode?`, `carrier?`, `trackingNumber?`, `trackingUrl?`, `shippedAt?`, `deliveredAt?`, `codCollectedAt?`, `customerNote?`, `internalNote?`, `placedAt`, `cancelledAt?` | **REQUIRED NOW** |
| **OrderItem** | Line-level **snapshot** — title, price, variant label copied at purchase. | `orderId`, `productId?`, `variantId?`, `sku`, `title`, `variantLabel`, `unitPriceMinor`, `quantity`, `lineTotalMinor`, `imageUrl` | **REQUIRED NOW** |
| **OrderEvent** | Append-only timeline; powers admin order detail. | `orderId`, `type`, `fromStatus?`, `toStatus?`, `message`, `actorId?`, `actorKind SYSTEM\|ADMIN\|CUSTOMER`, `meta Json?`, `createdAt` | **REQUIRED NOW** |
| **Discount** | Server-authoritative coupons. | `code @unique` (uppercased), `type PERCENT\|FIXED\|FREE_SHIPPING`, `value Int`, `minSubtotalMinor?`, `maxDiscountMinor?`, `startsAt?`, `endsAt?`, `usageLimit?`, `usageCount Int`, `isActive`, `deletedAt` | **REQUIRED NOW** |

**Shipment and Payment are folded into Order columns for v1.** One brand, one parcel per order, and COD is exactly one money event. Two extra tables for a store with zero orders is ceremony. `[LATER]` triggers: a real payment gateway (-> `Payment`), or the first split shipment (-> `Shipment`). `DiscountRedemption` is cut outright — with `Order.discountId` present, a redemption row with `@@unique([orderId])` is the same fact stored twice; usage limits are a `COUNT(*)` inside the order-creation transaction.

#### 7.3 Why Discount is REQUIRED NOW, and the pricing bug the draft missed

Two verified defects make server-authoritative totals non-negotiable:

1. **The phantom coupon.** `CartPage.jsx` hardcodes `NIYA10`, computes `promoDiscount = subtotal * 0.1`, and displays it. `OrderPage.jsx` builds `orderPayload` with **no discount field at all** and recomputes `grandTotal = subtotal + shippingFee`. The customer is shown a discount that is never applied.
2. **Sale prices are displayed but not charged.** `ProductCard.jsx` and `ProductDetails.jsx` render `finalPrice` (`isOnSale ? salePrice : price`), but **both** `CartPage.jsx` (`itemPrice = item?.variant?.price || product?.price`) and `OrderPage.jsx` (`Number(item.price)`) total on the **list** price. All **10 on-sale products** are advertised at the sale price and billed at the full price. This is a larger and more legally exposed bug than the coupon, and the draft did not find it.

The same files also disagree on shipping: `CartPage` sets `estimatedShipping = 0` unconditionally, while `OrderPage` charges `₹100` under `₹2000`.

**Commitment:** totals are computed server-side at order creation from `priceMinor`, the discount rules and the `StoreSetting` shipping rules. The order payload gains `discountMinor` / `discountCode` — additive JSON the storefront ignores. Note honestly: the *displayed* cart total stays wrong until the cutover PR repoints `CartPage`; the admin merely stops the wrong number from becoming the charged number.

**Server cart and wishlist are `[LATER]`.** `CartContext` and `WishlistContext` are localStorage-only and cannot be repointed without editing them. Building `Cart`/`CartItem`/`WishlistItem` now yields tables with no writer. `[LATER]` trigger: the cutover PR that swaps those contexts. When it lands, the merge is already possible because `publicId` preserves the legacy id — `niyaWishlist` keys (`"handbag-001-Black"` or bare `"handbag-001"`) resolve to a `variantId` via `publicId` plus the verbatim `OptionValue.label`, falling back to the product's first variant for bare keys.

### 8. Content and CMS

#### 8.1 HomepageSection

```
model HomepageSection {
  id          String    @id @default(cuid())
  pageKey     String              // "home" | "shop" | "wishlist"
  type        String              // registry key, Zod-validated
  position    Int                 // gap-spaced: 1000, 2000, 3000
  enabled     Boolean   @default(true)
  startsAt    DateTime?
  endsAt      DateTime?
  payload     Json                // shape owned by sectionRegistry[type]
  updatedById String?
  @@index([pageKey, enabled, position])
}
```

**`position` is gap-spaced with no unique constraint** — a drag-reorder under `@@unique([pageKey, position])` would need deferrable constraints or a temp-value shuffle on every drop; gap spacing makes a reorder one `UPDATE`, with a rare renumber maintenance action.

The draft's `version Int @default(1)` column is **dropped**: nothing read or wrote it, and section history is already covered by `AuditLog.diff`. An unused column is a promise you did not keep.

**Type registry** — `src/server/content/section-registry.ts` maps `type -> { zodSchema, label, icon, defaultPayload, editorComponent }`. Adding a type touches one file and needs no migration.

| `type` | Payload sketch | Seeded from | Priority |
|---|---|---|---|
| `HERO_CAROUSEL` | `{ slides: [{ mediaId, title, subtitle, buttonText, buttonLink }] }` | `heroBannersData` (2) | **REQUIRED NOW** |
| `CATEGORY_GRID` | `{ mode: "auto"\|"manual", categoryIds[], audience? }` | `getCategories()` | **REQUIRED NOW** |
| `PRODUCT_CAROUSEL` | `{ title, source: "featured"\|"best_sellers"\|"new_arrivals"\|"category"\|"manual", categoryId?, productIds[], limit? }` | `FeaturedProducts.jsx` | **REQUIRED NOW** |
| `TRUST_BADGES` | `{ items: [{ iconKey, title, text }] }` | **hardcoded in `TrustBadges.jsx`** (4) | **REQUIRED NOW** |
| `CAMPAIGN_SPOTLIGHT` | `{ eyebrow, title, description, mediaId, buttonText, buttonLink }` | `campaignData` | **REQUIRED NOW** |
| `REELS` | `{ title, mode: "manual"\|"latest", reelIds[], limit }` | `reelsData` (4) | **REQUIRED NOW** |
| `CRAFTSMANSHIP` | `{ eyebrow, title, description: string[], stats: [{value,label}], mediaId, imageAlt, buttonText, buttonLink }` | `craftsmanshipData` | **REQUIRED NOW** |
| `REVIEWS` | `{ title, mode: "curated_testimonials"\|"latest_approved", testimonialIds[], limit }` | `reviewsData` (3) | **REQUIRED NOW** |
| `NEWSLETTER` | `{ eyebrow, title, description, buttonText }` | **hardcoded inline in `HomePage.jsx`** | **REQUIRED NOW** |
| `RICH_TEXT` | `{ html }` (sanitised server-side) | — | `[LATER]` |

**`PROMO_BANNER` is removed from the registry — the draft was wrong to include it.** `PromoBanner` is not a child of `HomePage.jsx`; it is rendered **inside `HeroBanner.jsx`** as `<PromoBanner page="home" position="after-hero" />` with hardcoded props, and it queries `getPromoBanners()` and filters by page+position itself. A section row therefore cannot position it. Promo banners are served by the `Banner` entity, queried by page+position — which is exactly the interface the storefront already uses.

That leaves **9 sections for `pageKey = "home"`**, matching `HomePage.jsx`'s nine flat children in order: Hero, CategorySection, FeaturedProducts, TrustBadges, CampaignSpotlight, Reels, BrandCraftsmanship, CustomerReviews, Newsletter.

`TRUST_BADGES.iconKey` must be a **closed enum matching the `react-icons/fi` names the component already imports** — `FiBox`, `FiShield`, `FiRefreshCw`, `FiHelpCircle`. The storefront maps key -> component and cannot resolve an arbitrary string; free text would render nothing at cutover.

JSON payloads cannot FK to Media. **`SectionMediaRef { sectionId, mediaId }`**, maintained by the service layer on every section write, gives the Media library a real "used in 3 places" indicator and blocks deletion of a live hero image.

#### 8.2 Content entities

| Entity | Purpose | Key fields | Priority |
|---|---|---|---|
| **Banner** | Promo banners; already page+position targeted today. | `page`, `position`, `mediaId`, `title`, `alt`, `linkUrl?`, `isActive`, `startsAt?`, `endsAt?`, `sortOrder` | **REQUIRED NOW** |
| **Announcement** | Global ticker; not homepage-scoped. | `text`, `linkUrl?`, `isActive`, `sortOrder`, `startsAt?`, `endsAt?` | **REQUIRED NOW** |
| **Reel** | Growing video library. | `title`, `mediaId?`, `externalUrl?`, `posterMediaId?`, `isActive`, `sortOrder`, `linkedProductId?` | **REQUIRED NOW** |
| **Testimonial** | The 3 legacy quotes — **not** reviews. | `authorName`, `location`, `text`, `isActive`, `sortOrder` | **REQUIRED NOW** |
| **CmsPage** | The **8** footer pages, one flexible shape. | `slug` (partial unique), `routePaths String[]`, `title`, `eyebrow?`, `intro?`, `blocks Json`, `seoTitle?`, `seoDescription?`, `status`, `publishedAt?`, `deletedAt` | **REQUIRED NOW** |
| **FooterConfig** | Singleton (`id = "default"`), Zod-validated JSON. | `brandName`, `brandDescription`, `customerServiceHeading`, `customerServiceDescription`, `supportEmail`, `copyright`, `sections Json`, `socialLinks Json`, `legalLinks Json` | **REQUIRED NOW** |

**Three corrections to the draft's content model, all from reading `footerData.js`.**

1. **There are 8 CmsPages, not 7, and there is no `legal` record.** `footerPagesData` keys are: `about, our-story, contact, shipping-returns, size-guide, faq, privacy-policy, terms-of-use`. `privacy-policy` and `terms-of-use` are separate records, and `LegalPage.jsx` derives its slug from `location.pathname.split("/")[1]` — so both resolve directly. **`routePaths` has exactly one real job:** `SizeCarePage.jsx` hardcodes `getFooterPage("size-guide")` and is mounted at *both* `/size-guide` and `/care-guide`, so the `size-guide` record carries two route paths. Every other page is 1:1.
2. **CmsPage blocks need stable `anchorId`s.** Footer links deep-link into page fragments — `/shipping-returns#shipping`, `/shipping-returns#exchange`, `/size-guide#size-guide`, `/size-guide#care-guide`. If the block editor generates anchors from titles, renaming a heading silently breaks four footer links. Every block carries an explicit, editable, immutable-by-default `anchorId`.
3. **No `Faq` table.** The draft claimed it was "reused by `/faq` and `/shipping-returns`" — it is not; `shipping-returns` uses `sections`, and `faq` is the sole consumer of **6** entries (not the ~10 claimed). Six rows with one consumer is a `FAQ_LIST` block inside the `faq` CmsPage, drag-reorderable in the block editor like any other block. `[LATER]` trigger: FAQs need to appear on a second surface.

`CmsPage.blocks` is a typed array — `RICH_TEXT | SECTION_LIST | VALUE_GRID | QUOTE | CONTACT_CARD | FAQ_LIST` — which reproduces all eight ad-hoc page shapes (`sections`, `values`, `quote`, `contactDetails`, `faqs`) without one table per page.

**FooterConfig absorbs nav as validated JSON rather than three tables.** The real volume is 2 nav sections / 8 links / 4 social / 2 legal = 16 rows that are always read together, never queried individually, and returned to the storefront as one object. Three join tables for 16 rows is bloat; a Zod-validated JSON column with a drag-reorder editor is the same UX and one query. `[LATER]` escape hatch: normalise if footer links ever need per-link scheduling or analytics.

**What is deliberately *not* an entity.** `Campaign` — `campaignData` is a single homepage spotlight with an image and a button; no product set, no schedule, no lifecycle. It is a `CAMPAIGN_SPOTLIGHT` payload. A Campaign entity earns its place only when a campaign must bundle a landing page, a curated product set and a discount under one schedule. `TrustBadge` — four items, no reuse, no lifecycle: payload. `HeroBanner` — homepage-only: payload. `Banner` **is** an entity precisely because the existing `promoBannersData` already spans `home | shop | wishlist` and the storefront already queries it by page+position.

**The three legacy testimonials seed `Testimonial`, not `Review`.** They have no rating, no product link, no date and no verification; forcing them into a `Review` row would mean inventing a rating and a product to satisfy a schema. The `REVIEWS` section defaults to `mode: "curated_testimonials"`.

**`Review` itself is `[LATER]`, a demotion from the draft.** There is no review submission UI anywhere in the storefront — `rating` and `reviewCount` are hardcoded constants. Shipping a moderation queue with zero rows is a screen nobody opens. `[LATER]` trigger: a review form ships on the product page. The schema is pre-agreed so it is a single migration: `productId, userId?, orderId?, rating Int (1–5), title?, body, authorName, status ReviewStatus, isVerifiedPurchase, adminReply?, deletedAt` with `enum ReviewStatus { PENDING APPROVED REJECTED SPAM }` defaulting to `PENDING` — an unmoderated form on a luxury brand's PDP is a liability. When it lands, the admin flips the `REVIEWS` section to `latest_approved` and the homepage switches sources with no code change; `Product.ratingSource` flips `SEEDED -> COMPUTED` per product.

### 9. Platform

| Entity | Purpose | Key fields | Priority |
|---|---|---|---|
| **StoreSetting** | Typed key/value; a Zod schema per key. | `key @unique`, `value Json`, `updatedById`, `updatedAt` | **REQUIRED NOW** |
| **AuditLog** | Append-only. Who changed what. | `actorId?`, `actorEmail` (denormalised), `action` (`"product.update"`), `entityType`, `entityId`, `diff Json` (changed keys only), `ip?`, `userAgent?`, `createdAt` | **REQUIRED NOW** |
| **NewsletterSubscriber** | Ships **with** the cutover PR. | `email @unique`, `source`, `status SUBSCRIBED\|UNSUBSCRIBED`, `confirmedAt?` | `[LATER]` |

`NewsletterSubscriber` is honestly `[LATER]`: the homepage `<form>` in `HomePage.jsx` has **no `onSubmit` handler**, so nothing can POST to it. The table and its endpoint ship in the same PR that adds the handler — building it earlier is a table with no writer.

`Notification` is cut. For a single-operator admin, "low stock" and "reconciliation mismatch" are an email plus a dashboard query, not an inbox table with a read state.

**Seed `StoreSetting` from values found hardcoded and mutually contradictory across three files:**

| Key | Value | Found in |
|---|---|---|
| `shipping.freeThresholdMinor` | `200000` (₹2000) | `CartPage.FREE_SHIPPING_LIMIT` and `OrderPage` both — but `TrustBadges.jsx` copy says "Orders over ₹10,000" |
| `shipping.flatFeeMinor` | `10000` (₹100) | `OrderPage` charges it; `CartPage` sets `estimatedShipping = 0` |
| `payments.codEnabled` | `true` | `OrderPage` radio |
| `payments.onlineEnabled` | `false` | no gateway exists anywhere |
| `store.currency` | `"INR"` | — |
| `store.timezone` | `"Asia/Kolkata"` | — |
| `store.supportEmail` | from `footerData.customerService.email` | — |
| `catalog.suggestionsLimit` | `6` | `getSuggestedProducts` |
| `catalog.newArrivalWindowDays` | `30` | `ShopPage` availability filter |

Consolidating these is the concrete payoff of the whole exercise: today, changing the free-shipping threshold means editing three files, one of which is marketing copy that is already wrong.

**`AuditLog` matters more here than in a typical build, precisely because there are only two roles.** Every ADMIN has unrestricted power over pricing, orders and published content. With no permission gradations to constrain damage, the append-only log is the only accountability mechanism. Store `actorEmail` denormalised so entries survive user deletion. Retain 400 days, then prune.

### 10. Indexes that actually matter

| Index | Table | Screen it serves |
|---|---|---|
| `(deletedAt, status, publishedAt DESC)` | Product | Admin list default sort; new-arrivals |
| `UNIQUE(slug) WHERE deletedAt IS NULL` | Product, Category, CmsPage | Slug reuse after archive |
| `UNIQUE(publicId)` | Product, ProductVariant, Category | Public API lookup by legacy id |
| `(categoryId, status)` | Product | Shop filtered by subcategory |
| `(audience, categoryId)` | Product | The `getCategories()` group-by; women/men split |
| `(isFeatured) WHERE isFeatured = true` | Product | Featured carousel |
| `(orderCount DESC)` | Product | Best sellers |
| GIN `pg_trgm` on `title`, `description` | Product | Admin search + server-side `?search` |
| `UNIQUE(sourceUrl)` | Media | Import dedupe (234 refs -> 49 rows) |
| `UNIQUE(checksum) WHERE checksum IS NOT NULL` | Media | Upload dedupe for files we can hash |
| `(status, placedAt DESC)` | Order | Admin orders list — the single hottest query |
| `(paymentStatus) WHERE paymentStatus = 'PENDING'` | Order | COD-pending dashboard tile |
| `(userId, placedAt DESC)` | Order | Customer order history |
| `(orderId, createdAt)` | OrderEvent | Order timeline |
| `(variantId, createdAt DESC)` | StockMovement | Inventory ledger drill-down |
| `(pageKey, enabled, position)` | HomepageSection | Public content fetch |
| `(entityType, entityId, createdAt DESC)` | AuditLog | "History" tab on any record |

### 11. The one-time importer

```
admin_panel/prisma/seed/
  extract-legacy.ts        # run ONCE locally; reads ../../e-commerce_frontend-main READ-ONLY
  data/                    # committed snapshots -- the actual import source
    products.snapshot.json     # 39 products, 78 variants, 234 image refs
    home.snapshot.json         # hero(2) promo(3) announcements(3) reels(4) craftsmanship reviews(3)
    trust-badges.snapshot.json # extracted from the COMPONENT; no data file exists
    footer.snapshot.json       # footerData + 8 footerPagesData entries
    media.manifest.json        # normalised sourceUrl -> sha256 for the 43 local files
  import/{catalog,content,settings}.ts
  index.ts
```

**Vendor snapshots; never read the sibling folder at deploy time.** The admin is its own Vercel project and the storefront directory will not exist on that build machine. `extract-legacy.ts` runs once locally, reads the storefront read-only (honouring the zero-changes constraint), and writes committed JSON reviewable in a diff. It also hashes the 43 local asset files it can reach — the six remote assets get no checksum, by design (§5.4).

Every imported row carries its legacy id (as `publicId` or `legacyKey`) with a unique index, and the importer **upserts on it** — so `pnpm db:import` is idempotent and re-runnable against a partially seeded database.

**Verified expected volumes** (measured, not estimated):

| Rows | Entity |
|---|---|
| 1 root + 5 leaves | Category |
| 39 | Product |
| 39 | ProductOption (one COLOUR axis each) |
| **7** | OptionValue — Black 34, Brown 22, Beige 9, Tan 9, Pink 2, Gold 1, Coffee 1 |
| 78 | ProductVariant · VariantOptionValue |
| 234 | ProductImage (3 identical refs per variant, preserved) |
| **49** | Media — 39 distinct product files + hero-1 + 2 promo + 1 reel video + 6 external. *hero-2 is byte-identical to `handbag-001`'s Black image and dedupes away.* |
| 78 | InventoryItem, all `trackInventory = false` |
| 9 | HomepageSection (`pageKey="home"`, positions 1000–9000) |
| 3 / 3 / 4 / 3 | Banner / Announcement / Reel / Testimonial |
| **8** | CmsPage (with 6 FAQ entries inside the `faq` page's blocks) |
| 1 | FooterConfig (2 nav sections, 8 links, 4 social, 2 legal, as validated JSON) |
| 9 | StoreSetting |
| 0 | Order, User |

**Not imported:** `niyaUsers` (plaintext passwords, no hash to migrate), `niyaOrders` (device-local, unverifiable, no customer identity to attach), `niya_cart`, `niyaWishlist`. Carts and wishlists stay client-side until the cutover PR, when a merge routine resolves them against `publicId`.

The importer's final step writes an `AuditLog` row with `action: "system.import"` and the snapshot checksums, so the provenance of every seeded record is traceable from inside the admin.

### 12. The contract test, and the cut list

**The single most valuable safety net, which the draft omitted: a golden-file contract test.** `legacy/product.legacy.ts` serialising the seeded database must `deepEqual` the committed `products.snapshot.json`, modulo the one additive `variants[].id`. Same for `getCategories()`, `home.snapshot.json` and each of the 8 CmsPages. It runs in CI on every migration. Without it, "the cutover is mechanical" is a hope; with it, it is a green check.

**Cut from the draft, each with a named `[LATER]` trigger:**

| Cut | Trigger to build it |
|---|---|
| `Payment` table | A real payment gateway is integrated |
| `Shipment` table | The first order ships in more than one parcel |
| `Cart` / `CartItem` | The cutover PR repoints `CartContext` |
| `WishlistItem` | The cutover PR repoints `WishlistContext` |
| `Address` | An address-book screen ships on the storefront |
| `Faq` table | FAQs must appear on a second surface |
| `DiscountRedemption` | Per-user coupon limits are actually wanted |
| `Notification` | More than one person operates the admin |
| `Review` | A review form ships on the product page |
| `HomepageSection.version` | Deleted outright — `AuditLog.diff` already carries history |
| `PROMO_BANNER` section type | Never — `PromoBanner` is nested inside `HeroBanner.jsx` and cannot be positioned by a section row |

Twenty-eight tables ship in v1. Nine are deferred with triggers, not vibes. That is the difference between enterprise-grade and bloated.


**Decisions**

- FIX: Retracted the draft's headline claim. Traced CartContext.addToCart line by line: the `hasExisting` branch filters out EVERY line whose `_id` matches the product before appending, so emitting `variants[].id` does not fix the multi-variant cart bug — it converts silent quantity-merging into silent eviction of the other colour. Variant ids are now framed as a precondition; the ~10-line fix is explicitly assigned to the cutover PR, since nothing in admin_panel/ can repair it.
- FIX: Found a larger pricing bug the draft missed. CartPage and OrderPage both total on `item.price` (list price) while ProductCard/ProductDetails display `finalPrice` (salePrice) — all 10 on-sale products are advertised at sale price and billed at full price. This, not NIYA10, is now the lead argument for server-authoritative totals.
- FIX: Corrected the footer page count. footerPagesData has 8 keys, not 7, and there is NO `legal` key — privacy-policy and terms-of-use are separate records resolved by LegalPage from location.pathname. routePaths now has exactly one real job: size-guide serving both /size-guide and /care-guide (SizeCarePage hardcodes the slug).
- FIX: Added a requirement the draft skipped entirely — CmsPage blocks need explicit stable `anchorId`s, because footer links deep-link to #shipping, #exchange, #size-guide and #care-guide. Title-derived anchors would break four live links on rename.
- FIX: Removed PROMO_BANNER from the section registry. PromoBanner is not a child of HomePage.jsx — it is rendered inside HeroBanner.jsx with hardcoded page/position props and filters getPromoBanners() itself, so a section row cannot position it. Promo banners are served by the Banner entity via page+position, the interface the storefront already uses.
- FIX: Resolved a self-contradiction in the Media model. `checksum @unique` as the dedupe key is impossible for provider EXTERNAL_URL (6 remote Unsplash/Pexels/slidesdocs assets whose bytes are never fetched). checksum is now nullable-unique, computed only for the 43 local files, and `sourceUrl @unique` is the always-present dedupe key.
- FIX: Added URL normalisation. Hero banner paths are percent-encoded while product paths are raw; heroBannersData[1].image and handbag-001's Black image are verified to be the same file under two strings. Without decodeURIComponent the importer creates duplicate Media rows.
- FIX: Corrected the 234-to-39 arithmetic and its explanation. 78 variants x 1 distinct file = 78, not 39. The real cause is that 21 of the 39 files are shared across different variants AND different products — one file serves as 'Black' on seven minibags and as 'Tan'/'Pink' elsewhere. Same collapse, much worse reason; added a 'reused image' badge requirement.
- FIX: Gave a real Media row count (49) the draft never computed: 39 product files + hero-1 + 2 promo + 1 reel video + 6 external, with hero-2 deduping away.
- FIX: Corrected the Int paise ceiling from Rs21.4 crore to Rs2.14 crore (Int max 2,147,483,647 paise). Off by 10x. Conclusion unchanged, arithmetic now correct.
- FIX: Replaced the unimplementable orderNumber scheme. A Postgres sequence does not reset daily, and a monotonic one leaks lifetime volume — so 'zero-padded daily sequence' was not buildable as stated. Committed to NIYA-YYMMDD-XXXX with 4 Crockford-base32 chars, unique, retry-on-conflict.
- FIX: Made the option value vocabulary GLOBAL rather than per-product. ShopPage builds its colour facet from variant.name strings and filters on exact lowercase match, so per-product free-text labels would silently split the shop filter the first time someone typed 'Jet Black'. OptionValue is now a store-wide controlled list with @@unique([type, slug]).
- FIX: Added the four legacy-helper behaviour changes the draft glossed. ?featured takes no limit (returns all 16); ?minPrice/?maxPrice filter on LIST price not effective price (draft's 'effective price' rejected as a silent change); getCategories() emits an `image` field the draft omitted, sourced from the first product in the group unless a Category hero is set; /suggestions is a genuinely VISIBLE behaviour change, now specified with a top-up rule so it always returns 6.
- FIX: Documented that 'new arrivals' has two contradictory definitions in the storefront today — ?filter=new-arrivals uses top-8-by-date while ShopPage's availabilityFilter uses a rolling 30-day window. Both must be reproduced at cutover, not unified.
- FIX: Added the full legacy ORDER payload mapping table. The draft specified Order/OrderItem entities but never mapped them back to the shape MyOrders.jsx and OrderReceipt.jsx actually read (orderId, date, status, shippingDetails, items[]).
- FIX: Added a genuine zero-code-change cutover pilot the draft missed. notFoundApi.js is REAL HTTP against contentApi, whose baseURL is VITE_MOCKOON_API_BASE_URL and which currently fails to localhost:3001 in production. Serving GET /not-found-bags -> [{id,image}] and setting one env var makes an endpoint admin-controlled with ZERO file changes inside e-commerce_frontend-main.
- FIX: Added the golden-file contract test — legacy serializers must deepEqual the committed snapshots in CI on every migration. Without it, 'the cutover is mechanical' is a hope rather than a green check. The draft had no verification strategy at all.
- FIX: Cut nine tables as over-engineering for a 39-product, zero-order, one-operator store, each with a named [LATER] trigger: Payment and Shipment folded into Order columns; Cart/CartItem and WishlistItem (no writer exists — the contexts are localStorage-only and cannot be repointed now); Address (no address-book UI exists; User.defaultAddress Json instead); Faq (draft wrongly claimed shipping-returns reuses it — it uses `sections`; 6 rows, one consumer, so it is a FAQ_LIST block); DiscountRedemption (Order.discountId already stores the fact); Notification (email + dashboard query for a solo admin); Review (no review form exists anywhere, so the moderation queue would have zero rows). 28 tables ship.
- FIX: Corrected the FAQ count from '~10' to the actual 6, and the CmsPage count from 7 to 8.
- FIX: Collapsed FooterSection/FooterLink/SocialLink into Zod-validated JSON columns on the FooterConfig singleton. Real volume is 16 rows always read together, never queried individually, returned to the storefront as one object — three join tables for that is ceremony. Escape hatch documented.
- FIX: Dropped HomepageSection.version — nothing read or wrote it and AuditLog.diff already carries history. An unused column is a promise you did not keep.
- FIX: Promoted NEWSLETTER to REQUIRED NOW (it is rendered on the homepage today, hardcoded inline, so the section list cannot reproduce the page without it) while keeping NewsletterSubscriber at [LATER] with an honest reason: the form has no onSubmit, so nothing can POST to it until the cutover PR.
- FIX: Named the partial-unique-index consequence the draft left out — because the index is not declared in the Prisma schema, findUnique({where:{slug}}) is unavailable and the repository layer must use findFirst with the scope filter.
- FIX: Specified @node-rs/argon2 rather than argon2 — the classic native module does not build reliably on Vercel's serverless runtime.
- FIX: Committed to rendering LEGACY_PATH media in the admin via NEXT_PUBLIC_STOREFRONT_ORIGIN, so the Media library is not a wall of broken thumbnails. The draft correctly identified that those paths only resolve on the storefront origin but left the admin-side consequence unaddressed.
- FIX: Stated that guest checkout is the default and Order.userId is nullable — /order is not a protected route and OrderPage only prefills from the auth user.
- FIX: Moved the central tension from a buried aside to section 0, and stated plainly that the admin can change nothing the live site renders until src/api/*.js is repointed.

**Open assumptions**

- Free shipping is Rs2000 (the value actually used in both CartPage and OrderPage) and the TrustBadges 'Orders over Rs10,000' copy is stale marketing text to be corrected. Confirm which is the real rule before the badge text is seeded.
- The shipping fee is Rs100 under the threshold (OrderPage's rule) and CartPage's unconditional estimatedShipping = 0 is the bug, not the policy. Confirm.
- The men's audience (3 of 39 products) is a residual experiment rather than a growing line. If a real men's collection is planned, the audience-as-enum decision still holds but CATEGORY_GRID needs a per-grid audience filter instead of one combined grid.
- Handbags will not gain a genuine size axis in the next 12 months. The generic option model absorbs it if they do; no SIZE values are seeded.
- There is exactly one physical stock location.
- The 3-identical-images-per-variant duplication, and the reuse of one file across seven different products' colour variants, are placeholder artefacts rather than intentional. The importer preserves all 234 positions faithfully, but the admin's first content task is replacing them.
- Reviews will be admin-moderated (default PENDING) when the feature eventually ships. For a luxury brand this is assumed correct but is a business call.
- Online payment stays disabled at launch. PaymentMethod.ONLINE is modelled and gated behind StoreSetting['payments.onlineEnabled'].
- GST/tax is out of scope for v1: Order carries taxMinor but the calculator returns 0 until GST registration and HSN codes are supplied.
- Existing customers re-registering at cutover is acceptable, since niyaUsers holds plaintext passwords with no hash to migrate. This needs an announcement plan.
- The storefront cutover will eventually happen and will be confined to src/api/*.js plus the ~10-line CartContext fix. If the user will never do the cutover, the entire legacy serializer layer and the golden-file contract test are wasted effort and should be dropped.

**Risks**

- The multi-variant cart bug cannot be fixed from admin_panel/ at all. It lives in CartContext.addToCart's hasExisting eviction branch and in isInCart's product-level match. If the user believes shipping variant ids fixes it, they will ship variant ids and the cart will still be wrong — differently. This must be stated to them explicitly before the cutover PR is scoped.
- Sale prices are displayed but not charged today (10 products). Making totals server-authoritative stops the wrong number from becoming the charged number, but the DISPLAYED cart total stays wrong until the cutover PR repoints CartPage. There is a window where admin and storefront disagree on price, and it is on the customer-facing side.
- OptionValue.label is a public filter key: ShopPage matches selectedColors against variant.name strings. Renaming a colour in the admin silently breaks the shop filter after cutover with no error anywhere. The admin UI must warn on rename; a rename is effectively a schema change.
- publicId is a URL contract: /product/:id resolves via getProductById on the legacy id, and live browsers hold niya_cart and niyaWishlist keys built from it. Any code path that regenerates a publicId breaks bookmarks and orphans a customer's cart. Consider making publicId immutable at the database level.
- The partial unique indexes are hand-written SQL outside Prisma's schema. A future `prisma migrate dev` that recreates a table can drop them silently. The contract test will not catch it; add an explicit index-existence assertion to CI.
- The 39-to-49 Media dedupe depends on decode-normalised sourceUrl matching. If the extractor and the runtime normalise differently (Windows path separators, trailing slashes, case), duplicates appear and SectionMediaRef usage counts become wrong. Normalisation belongs in one shared function used by both.
- Six content assets are hotlinked to Unsplash, Pexels and slidesdocs. They can 404, rate-limit or change without notice, and Pexels download URLs in particular are not stable embed endpoints. The admin should flag EXTERNAL_URL media as unmanaged and nudge toward rehosting, even though rehosting must not block cutover.
- trackInventory=false on all 78 variants means the inventory tables ship with no operational effect. There is a real risk they stay that way indefinitely and the ledger rots unused. Tie enablement to a concrete first-count task rather than leaving it as an open toggle.
- AuditLog is the only accountability control in a two-role system, and an ADMIN can also delete AuditLog rows unless the database role is restricted. Grant the application role INSERT and SELECT but not DELETE or UPDATE on AuditLog, or the control is decorative.
- Neon branch-per-preview plus Prisma migrations is pleasant until a preview branch drifts from production schema state and a migration is applied out of order. For a solo dev this is a real footgun; keep migrations forward-only and never edit an applied migration.
- Nine deferred tables is discipline only if the triggers are honoured. If the cutover PR lands without Cart/CartItem, the server has no authoritative cart and totals fall back to client numbers again — reintroducing exactly the bug this model exists to close. Cart/CartItem and the cutover PR must ship together.

---

## Dashboard — the Operator Control Center

**Route:** `/dashboard` in the `(admin)` route group. Server Component, `dynamic = "force-dynamic"`.

Consumes entities defined elsewhere in this blueprint (`Order`, `OrderItem`, `Customer`, `Product`, `ProductVariant` *with a stable id*, `InventoryLevel`, `ContentBlock`, `AuditLog`, `Setting`) in the admin's **own** Postgres via Prisma. **None exist in the storefront today.** The admin is the first and only writer of this model.

### 0. Access control

| Concern | Commitment |
|---|---|
| Roles | Exactly two: `ADMIN`, `USER`. No permission matrix. |
| Gate | Auth.js v5 `auth()` in the `(admin)` layout **and** inside `requireAdmin()` in the data layer. Middleware does only the cheap unauthenticated redirect. |
| Why not middleware-only | Middleware is routing, not a security boundary (bypassable in past Next.js releases). Every dashboard query calls `requireAdmin()` itself; omitting it is a review-blocking defect. |
| Signed-in `USER` on `/dashboard` | Static 403 page + sign-out. **Never a redirect** — redirecting an authenticated session to `/login` loops forever. |
| Post-login | `ADMIN` → `/dashboard`; `USER` → the same 403. No customer area exists in this app. |
| Client gating | Never. No `role === "ADMIN" && <Widget/>`. |

---

### 1. Files and grid

```
admin_panel/src/
  app/(admin)/dashboard/
    page.tsx               # RSC shell: h1 + grid + ErrorBoundary/Suspense pairs only
    loading.tsx            # pre-shell frame
    error.tsx              # last-resort backstop
    _components/
      dashboard-header.tsx   kpi-row.tsx   kpi-tile.tsx
      sales-chart-block.tsx  needs-attention.tsx  alert-item.tsx
      recent-orders.tsx  inventory-attention.tsx  top-selling.tsx
      recent-customers.tsx  quick-actions.tsx  activity-feed.tsx
      setup-checklist.tsx    widget-shell.tsx
  features/dashboard/
    queries/     # one async fn per widget, one SQL statement each
    alerts/      # rules.ts (registry), evaluate.ts, severity.ts, fingerprint.ts
    measures.ts  # the canonical money/period definitions in §2
    types.ts
```

| Breakpoint | Layout |
|---|---|
| `2xl` ≥1536 | 12-col, 24px gap. KPI `grid-cols-6` (one row). Chart `col-span-8` + Needs attention `col-span-4`. Recent orders `8` + right rail `4` (Quick actions, Activity). Inventory `4` + Top selling `4` + Recent customers `4`. |
| `xl` 1280–1535 | KPI `grid-cols-3` (2×3). Chart `col-span-8` + attention `col-span-4`. Rest as above. |
| `lg` 1024–1279 | KPI `grid-cols-3`. Chart `col-span-7` + attention `col-span-5`. Inventory `6` + Top selling `6`; Recent customers `12`. |
| `<lg` | Single column. KPI `grid-cols-2`. **Needs attention renders directly under the KPI row, above the chart** — below laptop width the operator is triaging, not analysing. Tables get `overflow-x-auto` with first column `sticky left-0`. |
| `<640` | KPI `grid-cols-2` (still — a 1-up column of six tiles is a scroll, not a summary). Chart shows the revenue series only; orders behind a `Tabs` toggle. Tables render as stacked definition rows, never squeezed tables. |

Six KPI tiles is a **content** decision (§3), not a grid one — the ladder above renders 4, 5 or 6 tiles without an orphan cell. Six across is reserved for ≥1536px; at 1280px six tiles would be ~185px each, too narrow for `₹1,24,500` + delta + sparkline.

---

### 2. Canonical measures — defined once, imported everywhere

The draft's biggest correctness hole was three different revenue denominators. One definition, in `measures.ts`, used by KPIs, chart, Top selling and every export.

| Term | Definition |
|---|---|
| Money storage | `INTEGER` **paise**, never float/Decimal-as-float. Storefront prices are whole rupees; the seed importer multiplies by 100. |
| Money display | `Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 })`. |
| `merchandiseRevenue` | `Σ over order_items (quantity × unitPricePaise)` for orders whose `status ∉ {CANCELLED, RETURNED, FAILED_DELIVERY}` and `placedAt ∈ range`. **Excludes shipping.** |
| `shippingCollected` | `Σ order.shippingFeePaise` over the same set. Reported separately; never inside a revenue KPI. |
| `realisedRevenue` | Same as `merchandiseRevenue` but restricted to `status = DELIVERED`. |
| `countedOrders` | Orders in range, all statuses. |
| Comparison period | Immediately preceding window of identical length, same IST boundaries. |
| Time zone | All bucketing and day boundaries in `Asia/Kolkata` (UTC+5:30) via SQL `AT TIME ZONE 'Asia/Kolkata'`. Storage is `timestamptz` (UTC). A 22:00 IST order bucketed in UTC lands on the next day and shifts every daily total. |

**Server-side pricing authority (a schema and trust decision the draft missed).** The storefront's payload (`OrderPage.jsx` L114–137) sends client-computed `price`, `subtotal`, `totalAmount` and a client-generated `orderId` (`"NIYA-" + Date.now()`). After the cutover the admin's order-create endpoint **re-prices every line server-side from the catalogue** and treats client amounts as advisory only:

- `order_items` stores `listPricePaise` **and** `unitPricePaise` at order time — the server knows both, so KPI 6 needs nothing extra from the storefront.
- Order numbers are server-generated `NIYA-YYMM-NNNN` on a unique index. The client's `NIYA-<epoch>` is retained as `clientOrderRef` for idempotent retries only.
- A client/server total mismatch is recorded and surfaced as an alert rather than silently accepted.

This is a *later* concern — no order can reach the admin before the cutover — but the columns must exist from the first migration because they cannot be retrofitted onto rows that were never captured.

---

### 3. The KPI row

Six **period-comparable** tiles. State metrics (stock on hand, orders awaiting action) are excluded on purpose: a delta chip on a state number lies. State lives in Needs attention.

Tile contract: `label` sentence case · `value` semibold `tabular-nums`, `en-IN` · `delta` signed % vs the previous equal-length period, coloured by direction × `higherIsBetter`, **always accompanied by screen-reader text** ("up 12% versus previous 30 days") — colour and a chevron alone are not a value · `trend` 12-bucket sparkline, de-emphasis hue, final bucket in accent, no axis and no tooltip (texture, not a chart).

| # | KPI | Formula | Comparison | ↑ good | Reference point |
|---|---|---|---|---|---|
| 1 | **Merchandise revenue** | `merchandiseRevenue` | prev. period | yes | No external benchmark exists. Operator enters a monthly target in Settings; tile renders a meter against it. Sub-line **"₹X realised"** = `realisedRevenue` — for a COD store the booked-vs-realised gap *is* the business. Second sub-line: shipping collected. |
| 2 | **Orders** | `countedOrders` | prev. period | yes | Growth only; an absolute floor is meaningless at this scale. |
| 3 | **Average order value** | `merchandiseRevenue ÷ non-cancelled order count` | prev. period | yes | **≥ ₹2,000** — the storefront's free-shipping threshold, applied to **subtotal** (`OrderPage.jsx:82`: `subtotal >= 2000 ? 0 : 100`). AOV is therefore computed on merchandise only; including shipping would compare against a different quantity. Verified catalogue: **39 products**, list prices **₹999–₹3,599**, median **₹1,999**, and **22 of 39 sit below ₹2,000** — so an AOV under ₹2,000 means most baskets are a single sub-threshold bag paying ₹100 shipping. Stretch ₹2,600. |
| 4 | **Repeat customer rate** | distinct customers in range with ≥2 lifetime orders ÷ distinct customers in range | prev. period | yes | Suppressed below 25 distinct lifetime customers — renders "Not enough data", not a volatile percentage. |
| 5 | **Cancelled + RTO rate** | `(CANCELLED + RETURNED + FAILED_DELIVERY) ÷ countedOrders` | prev. period | **no** | COD India runs high; the most expensive leak for this store. Thresholds: <10% good, 10–20% warning, >20% serious. |
| 6 | **Discounted revenue share** | `Σ(qty × unitPrice) where listPrice > unitPrice ÷ merchandiseRevenue` | prev. period | **no** | Same numerator basis as the denominator — both merchandise-only. **10 of 39** products carry `isOnSale`; past ~35% the sale rack *is* the store. |

#### The `orderCount` trap — an explicit prohibition

`products.js` ships hardcoded `orderCount`, `rating`, `reviewCount`. Verified: `handbag-001` ("Classic Handbag") claims `orderCount: 184`, `rating: 4.7`, `reviewCount: 64` while zero orders and zero reviews exist anywhere. **No dashboard number may read those fields.** They import into `legacySeedOrderCount` / `legacySeedRating` / `legacySeedReviewCount`, are excluded from every query, and render only on the product detail page labelled *"Seed value from storefront data — not derived from orders"*. Real `unitsSold` is a read-model column recomputed from `order_items`; on day one it is 0 while the static file still says 184. That divergence is correct and must stay visible.

#### Not computable — do not fake these

| Metric | Why | Status |
|---|---|---|
| Conversion rate | No sessions, visits or analytics anywhere in the storefront | [NEEDS TRACKING — not in v1] |
| Cart abandonment | Cart is `localStorage["niya_cart"]`; `cartApi.js` has real HTTP methods but `CartContext` never calls them, so no cart reaches a server | [NEEDS TRACKING — not in v1] |
| Wishlist adds / most-wishlisted | `localStorage["niyaWishlist"]`, device-local and anonymous | [NEEDS TRACKING — not in v1] |
| Product views, view→cart | No PDP instrumentation | [NEEDS TRACKING — not in v1] |
| Zero-result searches | `SearchOverlay.jsx` filters the local array client-side; nothing is logged | [NEEDS TRACKING — not in v1] |
| Channel / UTM revenue | No UTM capture at checkout | [NEEDS TRACKING — not in v1] |
| Customer LTV, cohort retention | Computable in principle; needs ≥6 months of orders | Deferred, not blocked |

**Cut from the draft:** the empty `storefront_events` table stub. An unused table that no widget reads is scaffolding for a feature that requires storefront changes we are forbidden to make. The cutover note in §9 records the intent instead; the table ships with the tracking feature or not at all.

---

### 4. The chart block

**Two vertically stacked charts sharing one x-axis, one crosshair and one range control — never a dual-axis chart.** Revenue (₹) and orders (count) are incommensurate; a crossover on two y-scales is an axis artifact, not a finding.

- **Top — Revenue over time.** Single-series area, one sequential hue, 2px line at the band edge. Previous period as a 1px dashed de-emphasis line; legend present (2 series).
- **Bottom — Orders over time.** ~120px column chart, 4px rounded tops on the baseline, 2px gap. Cancelled orders as a second stacked segment in the reserved `critical` status step, with an icon-and-label legend entry.
- **Shared tooltip:** date · revenue · order count · AOV for that bucket.

| Range | Granularity | Buckets |
|---|---|---|
| ≤31 days | Daily (IST) | ≤31 |
| 32–120 days | ISO week, Mon–Sun (IST) | 5–18 |
| >120 days | Calendar month (IST) | — |

**Control:** shadcn `Popover` + `Calendar` with presets — Today · Last 7 days · **Last 30 days (default)** · This month · Last 90 days · Custom. The range lives in URL search params (`?from=&to=&g=`). The **client** control writes them with `nuqs`; the **server** reads the awaited `searchParams` prop directly — nuqs is a client-side URL helper, not a data source for RSC.

The range drives KPIs, the chart and Top selling **only**. Needs attention, Inventory attention, Recent customers and Activity are current-state widgets, ignore the range, and carry a **"Live"** chip in their header so the mismatch is visible rather than surprising.

**Library:** `recharts` through shadcn's `chart` wrapper (`ChartContainer`, `ChartTooltip`, `ChartLegend`) — CSS-variable theming means charts follow the admin's light/dark tokens with no second palette. The reserved status ramp (`critical`/`serious`/`warning`/`info`) is never reused for a data series except the explicitly-labelled cancelled segment.

**Low-data guard:** fewer than 3 non-zero buckets ⇒ do not draw. A flat line at y=0 reads as a measured result; render "Not enough data yet" instead.

---

### 5. Operational tables

All wrap in `widget-shell`: `Card` → title, Live/range chip, `Table`, `CardFooter` with a ghost `Button asChild` "View all →" that **carries the current range in the query string**. Numeric columns `tabular-nums`; every table has a visually-hidden `<caption>`.

Fixed top-N reads ⇒ plain shadcn `Table`, **not** `@tanstack/react-table` (no sorting, pagination or resizing needed). TanStack Table belongs on `/orders`, `/products` and `/inventory`.

| Widget | Rows | Columns | Sort | Empty copy |
|---|---|---|---|---|
| **Recent orders** | 8 | Order no. (mono) · Customer (name, city) · Items · Total ₹ · Payment `Badge` (COD/Online) · Status `Badge` · Placed (relative; absolute IST on `Tooltip`) | `placedAt` desc | never: "No orders yet — the storefront is not connected to this admin. **What that means →**" |
| **Inventory attention** — `Tabs`: Out of stock · Low stock, count badge per tab | 6 per tab | Product (32px thumb + title) · Variant · SKU · On hand · Threshold · Last sold | Out: units sold last 30d desc (demand-weighted). Low: on-hand asc | Out: "Nothing is out of stock." Low: "Nothing is below its low-stock threshold." Pre-setup: "Stock has not been set for any variant yet — 0 of 66. **Set stock levels →**" |
| **Top selling products** | 5 | Rank · Product · Units · Merchandise revenue ₹ · Share of revenue (inline meter, same ramp) | units desc, revenue tiebreak | "No sales in this period." / "No sales yet." |
| **Recent customers** | 6 | Customer (name + masked email) · City, State · Orders (lifetime) · Lifetime value ₹ · **First seen** | `firstSeenAt` desc | "No customers yet." |

**Low + Out merged into one tabbed card, deliberately.** Verified catalogue: 39 products / **66 variants**. Two separate tables would rarely hold more than a handful of rows and would eat a full grid row that Top selling and Recent customers need.

**Customer provenance.** Storefront "auth" is `localStorage["niyaUsers"]` holding plaintext passwords — fake and device-local; no registration ever reaches a server. `Customer` rows are therefore created **at checkout**, not at sign-up, hence **First seen**, not "Joined".

**Identity key — committed (the draft left this vague and it silently breaks KPI 4).** Primary key for identity resolution is the **normalised 10-digit phone** (strip spaces, `+91`, leading `0`); email is secondary and used only when phone is absent. In COD India the phone is the reliable identifier — a mistyped email would otherwise split one repeat buyer into two customers and depress repeat rate. Merges are manual, logged to `audit_log`, and never automatic on email alone.

---

### 6. Needs attention

One `Card`, max **6 items** rendered, grouped by severity, "+N more →" overflow row. Every item is **icon + label + colour**, never colour alone (status hues are sub-3:1 on light surfaces by design). Severity ramp: `critical` `#d03b3b` · `serious` `#ec835a` · `warning` `#fab219` · `info` neutral.

The **Pre-cutover** column is the honesty column: it says whether a rule can fire before `src/api/*.js` is repointed, and whether fixing it changes anything a shopper sees today (it does not — the storefront still reads static files).

| # | Alert | Rule | Sev | Fires pre-cutover | Deep link |
|---|---|---|---|---|---|
| 1 | Published product out of stock | `status = PUBLISHED ∧ Σ variant.onHand = 0` | critical | yes | `/products/{id}/inventory` |
| 2 | Sale price not a discount | `isOnSale ∧ (salePrice IS NULL ∨ salePrice ≥ price)` | critical | yes | `/products/{id}` |
| 2b | Stale discount percentage | stored `discountPercentage` ≠ computed `(price − salePrice)/price` | warning | yes | `/products/{id}` — `ProductCard` prefers the stored field over the computed one, so a stale value prints a wrong badge |
| 3 | First variant has no image | `variants[0].images.length = 0` | critical | yes | `/products/{id}/media` — verified resolver chain is `thumbnail ‖ images[0] ‖ variants[0].images[0] ‖ image ‖ image_link ‖ ""`; products.js has none of the first two, so this renders an **empty `src`**, not a placeholder. Breaks the product card *and* the derived category tile |
| 3b | A non-first variant has no image | `any(variants[1..].images.length = 0)` | warning | yes | PDP gallery gap only — the card still renders |
| 4 | Hero carousel empty | `count(heroBanners where isActive) = 0` | critical | yes | `/content/hero-banners` (2 seeded banners today) |
| 5 | Order awaiting action >24h | `status = PLACED ∧ placedAt < now − 24h`, **plain IST wall-clock** | serious | **no** | `/orders?status=PLACED&stale=1` |
| 6 | Content link is dead | `buttonLink` resolves to neither a known storefront route nor a `PUBLISHED` product slug | serious | yes | `/content/{block}` |
| 7 | COD order with invalid phone | `paymentMethod = COD ∧ phone is not 10 digits starting 6–9` | serious | **no** | `/orders/{id}` — courier rejects the pickup |
| 8 | Low stock | `0 < onHand ≤ lowStockThreshold` (default **3**) | warning | yes | Inventory tab |
| 9 | A live category facet emptied | one of the **5 facets that exist today** dropped to 0 published products | warning | yes | `/products?subcategory=…` |
| 10 | Scheduled content expiring | `isActive ∧ expiresAt ≤ now + 72h` | warning | yes (if ContentBlock ships scheduling in v1) | `/content` |
| 11 | Announcement bar empty | `count(announcements where isActive) = 0` | info | yes | `/content/announcements` |

**Alert 5 — de-scoped from the draft.** "IST business-hours aware" was hand-waving. Committed: a flat 24h IST wall-clock threshold. A one-operator brand does not need a business-calendar engine, and 24h already absorbs an overnight gap.

**Alert 6 — corrected.** The draft asserted content blocks link to product slugs. Verified: **every `buttonLink` in `homeData.js` is a route path** (`/craftsmanship`, `/shop`) — not one points at a product. The rule is therefore a general dead-link check against a **hardcoded allowlist of the 20 storefront routes** copied into `admin_panel/src/lib/storefront-routes.ts` (`/`, `/sale`, `/shop`, `/product/:id`, `/craftsmanship`, `/account`, `/profile`, `/cart`, `/wishlist`, `/order`, `/my-orders`, `/about`, `/our-story`, `/contact`, `/shipping-returns`, `/size-guide`, `/care-guide`, `/faq`, `/privacy-policy`, `/terms-of-use`) plus published product slugs. Copied, not imported — the admin must not reach into `e-commerce_frontend-main/`. The list carries a comment naming its source file so a future storefront route change has one place to be mirrored.

**Alert 9 — corrected, and it was a false-alarm generator as drafted.** Categories are *derived*: `getCategories()` groups by `gender + "-" + subcategory`. The draft's cartesian product (5 subcategories × 2 genders = 10) would fire ~5 permanent false alerts on day one, because only **five facets actually exist**: `women-handbags` (6), `women-minibags` (14), `women-sling` (9), `women-tote` (7), `men-wallet` (3) — all 3 men's products are wallets, and there is no `women-wallet` at all. The rule therefore watches only facets with a non-zero baseline and fires on a transition to zero. A facet that drops to zero **silently vanishes from the homepage `CategorySection` with no error anywhere** — which is exactly why it needs an alert.

**Demoted to [LATER]: reviews awaiting moderation.** The storefront has **no review submission path anywhere** — `reviewsData` is three hardcoded testimonials with no rating, no product link and no date. A moderation queue in v1 could only ever contain rows the admin typed itself. The rule stays in `rules.ts` behind a flag and lights up when a review-submission endpoint ships.

**Dismissal semantics.** Each alert carries a stable `alertKey` plus a `fingerprint` hash of its underlying values. "Dismiss" hides it *until the fingerprint changes* — restocking then re-emptying re-fires it. Snooze 24h / 7d. **No email or push in v1** (no ESP is integrated; a dead toggle is worse than an absent one). Unresolved `critical + serious` count renders as a `Badge` on the sidebar's Dashboard item.

---

### 7. Quick actions

Five, chosen by *frequency × friction* for this store. 2-col grid of ghost `Button`s with icons.

| Action | Target | Why |
|---|---|---|
| **Add product** | `/products/new` | Highest-frequency creative task at 39 SKUs and growing |
| **Set stock levels** | `/inventory?filter=unset` | Inventory does not exist in the storefront at all. Day one is **66 variant rows** to fill — a full page with inline editing and keyboard traversal, **not** a `Sheet`; 66 rows in a slide-over is a data-entry trap |
| **Edit homepage hero** | `/content/hero-banners` | The reason the admin exists — 2 seeded banners, changed per drop |
| **Publish announcement** | `/content/announcements` | Fastest-changing content (3 seeded; sale and shipping messaging in the top bar) |
| **Export orders (CSV)** | range-aware route handler, streamed | COD reconciliation against courier remittance is the real weekly task — no ERP, no accounting integration, no gateway dashboard. **Disabled with an explaining tooltip while `storefront.connected = false`**, since no order can exist yet |

**Deliberately absent:** "Create discount code" (no coupon or discount-rule entity — sale pricing is a per-product `isOnSale`/`salePrice`/`discountPercentage` triple), "Issue refund" (`ONLINE` is a radio option with no processor behind it anywhere in the codebase), "Email customers" (no ESP).

---

### 8. Recent activity

Reads `audit_log`, written by every admin mutation. Eight entries, day headers ("Today", "Yesterday", then `d MMM`), relative timestamps with absolute IST on `Tooltip`, actor `Avatar` with initials.

```ts
type AuditEntry = {
  id: string; createdAt: Date;             // timestamptz UTC, rendered IST
  actorId: string; actorEmail: string; actorRole: "ADMIN";
  action: "CREATE" | "UPDATE" | "DELETE" | "PUBLISH" | "UNPUBLISH"
        | "STATUS_CHANGE" | "LOGIN" | "BULK_IMPORT" | "MERGE";
  entityType: "PRODUCT" | "VARIANT" | "INVENTORY" | "ORDER"
            | "CONTENT_BLOCK" | "FOOTER_PAGE" | "CUSTOMER" | "SETTING";
  entityId: string; entityLabel: string;   // denormalised: survives deletion
  changedFields: string[];                 // names only
  summary: string;                         // "Stock 4 → 0 (Black)"
  ip: string; userAgent: string;
};
```

Rendered: *avatar* — "**A. Sharma** set **Classic Handbag** to Out of stock · 12m ago". Filter chips: All · Products · Content · Orders. Footer "View full log →" `/settings/audit-log`.

Rules: `actorRole` is always `ADMIN` (two roles, `USER` locked out), so the feed is unambiguously "what the operators changed". **Never log reads** — a 39-product catalogue would drown in `VIEW` rows. **Never store request bodies**: `changedFields` names fields, `summary` carries a short human diff; customer PII beyond `entityLabel` and any credential material are excluded **at the writer**, not filtered at render. Retention 180 days, then hard delete.

**Why it earns a slot:** until the cutover, content edits have *no visible effect anywhere*. The audit log is the only evidence a hero banner was changed, by whom and when — the accountability layer for a period in which the admin's output is invisible.

---

### 9. The storefront-connection banner — the honesty mechanism

A single `Setting` row, `storefront.connected` (boolean, default **false**, flipped manually after the cutover), is the one source of truth for every honesty affordance:

1. A persistent amber notice in the admin shell: *"Storefront not connected — changes are saved here but are not yet visible on the live site."* with a link to the cutover note.
2. A "Not live yet" chip on every content-editing widget and page.
3. The disabled state + tooltip on **Export orders**.
4. Step 5 of the Setup checklist.

**The cutover note** (a static admin page, `/settings/storefront-connection`) states plainly: the storefront's `src/api/*.js` files are thin adapters over local static JS data; the real axios implementations already exist, commented out, in `authApi.js`, `productApi.js` and `contentApi.js`; `cartApi.js` and `notFoundApi.js` already make real HTTP calls but `CartContext` never invokes the former. Connecting is a **later, separate, mechanical step confined to `src/api/*.js`** plus a `VITE_API_BASE_URL` change, performed by the storefront owner. **Nothing in `e-commerce_frontend-main/` is touched by this project.** The note also records the two contract requirements the admin imposes on that step: variants must carry **stable ids** (today they have only `name`, so `CartContext.getVariantKey` falls back to the product id and every variant of a product silently collapses into one cart line), and order timestamps must be sent as ISO 8601, not `toLocaleString("en-IN")`.

If the demo-mode bar (§11) and this banner are both active, the demo bar renders above and in the louder treatment — a fabricated-data warning outranks a not-yet-connected one.

---

### 10. Loading, errors, caching, cost

`page.tsx` renders the header and the full grid immediately; **every widget is its own `async` Server Component wrapped `ErrorBoundary > Suspense > widget`**, fetching in parallel. The load-bearing rule: never `await` data in a parent that renders a Suspense child — that serialises them and turns streaming into a waterfall. Each widget owns its query end to end.

| Widget | Skeleton | Priority |
|---|---|---|
| KPI row | 6 tiles: 12px label bar, 32px value bar, 40×20 sparkline block | 1 |
| Needs attention | 5 rows: 16px circle + two text bars | 1 (cheap; streams with KPIs) |
| Chart block | 240px skeleton with 7 faint column stubs at real column positions | 2 (heaviest — two bucketed aggregations) |
| Recent orders | 8 rows at exact column widths | 2 |
| Inventory / Top selling / Recent customers | 6 / 5 / 6 rows, thumbnail squares where images go | 3 |
| Activity | 8 rows: avatar circle + 2 text bars | 3 |

Skeletons match final geometry exactly; the grid is defined in the shell, so nothing reflows on resolve. `loading.tsx` covers the pre-shell frame only.

**Error isolation:** a per-widget client `ErrorBoundary` (`react-error-boundary`) wrapping the Suspense boundary inside `widget-shell`. One failed aggregation degrades to a compact "Couldn't load — Retry" card; it must never blank the control center. `error.tsx` remains only as a last-resort backstop.

**Caching.** Next 16's `use cache` with `cacheTag` / `cacheLife`, invalidated by `revalidateTag` from admin mutations (on Next 15, `unstable_cache` is the equivalent). `force-dynamic` disables the full-route cache; the data functions still cache.

| Widget | Life | Tag |
|---|---|---|
| KPI row, chart block | 300s | `orders` |
| Recent orders | 60s | `orders` |
| Inventory attention | 60s | `inventory` |
| Top selling | 900s | `orders` |
| Recent customers | 300s | `customers` |
| Needs attention | 120s | `alerts` |
| Activity feed | 60s | `audit` |

**Two cache correctness rules the draft missed:**
1. Range-dependent queries (KPIs, chart, Top selling) must include `from`, `to` and `g` **in the cache key**. Otherwise every range shares one entry and a custom range serves last-30-days numbers.
2. The header's manual refresh cannot be `router.refresh()` alone — that re-renders but re-reads the same cached data. Refresh is a **Server Action** that revalidates the dashboard tags, then `router.refresh()`.

**No polling by default** — a one-to-two-operator store does not need it, and a 30s poll across nine aggregations is pure database burn. Opt-in 60s auto-refresh toggle persisted in `localStorage`, off by default, paused on `document.hidden`. Header shows "Updated 14:32 IST"; a subtle "stale" chip appears only past 10 minutes.

**Query budget and indexes.** Nine widget queries per load; each must be **one SQL statement** — no Prisma `include` fan-out (an N+1 across 8 recent orders is 9 round trips for one card). IST date-bucketing is not expressible in Prisma's query API, so the KPI, chart and Top-selling aggregations are `$queryRaw` with typed result shapes, colocated in `features/dashboard/queries/`. Budget: p95 < 400ms per widget on the day-one dataset and at 100× it.

| Index | Serves |
|---|---|
| `orders (placedAt DESC)` | Recent orders, chart |
| `orders (status, placedAt)` | KPI 1/5, stale-order alert |
| `order_items (orderId)`, `order_items (productVariantId, orderId)` | KPI 1/6, Top selling |
| `orders (customerId, placedAt)` | KPI 4, lifetime value |
| `customers (phoneNormalised)` unique, `customers (firstSeenAt DESC)` | identity resolution, Recent customers |
| `inventory_levels (onHand)` partial `WHERE onHand <= lowStockThreshold` | Inventory attention, alerts 1 & 8 |
| `audit_log (createdAt DESC)` | Activity feed |

---

### 11. Day one: the honest empty store

Today this store has **zero orders, zero customers, zero reviews, zero stock records**. Seeds are the **39 real products** (66 variants) from `products.js` and the real content from `homeData.js` / `footerData.js` — the store's actual content, never fabrications.

**Four states per widget; the middle two are different:**

| State | Meaning | Copy |
|---|---|---|
| `loading` | streaming | skeleton |
| `never` | the entity has no rows at all | "No orders yet — the storefront is not connected." |
| `zero-in-range` | rows exist, none in range | "No orders between 1–30 Sep. **Try last 90 days →**" |
| `populated` | normal | — |

Conflating `never` with `zero-in-range` is the most common empty-state bug and makes an operator think their data vanished.

**The day-one dashboard, precisely:**

- **KPI row renders**, all six at `₹0` / `0` / `—`, with **no delta chip** (a percentage change against zero is undefined; "+0%" is fabricated reassurance) and **no sparkline** — replaced by a muted "No prior period" caption.
- **Chart block is replaced, not zeroed.** A flat line at y=0 looks like a measurement. Its slot is taken by a **Setup checklist**: (1) Products imported — 39 of 39 ✓ · (2) Stock set — 0 of 66 variants · (3) Sale pricing reviewed — 10 products flagged `isOnSale` · (4) Hero banners published — 2 of 2 ✓ · (5) **Connect the storefront** — *"Later, separate step"*, linking to §9's cutover note. Auto-retires on the first real order; reopenable from Settings.
- **Needs attention is the widget that actually works on day one.** Every rule except 5 and 7 is catalogue- or content-derived and fires with zero orders.
- **The honest framing, stated on the page:** *until the storefront is connected, this dashboard is a data-quality console; it becomes a sales console only after the cutover.* No order can arrive before then — a permanently empty Recent orders card is the correct, expected state, not a bug and not a sign of missed sales. The layout is designed so the transition needs no structural change: swapping the checklist slot back to the chart is the only difference.

**Mock-versus-real data policy — committed:**

1. **No mock data is ever written to any database**, Preview included. Fabricated orders in a real table become fabricated KPIs the moment someone forgets.
2. A demo dataset exists only for screenshots and UI review, behind `ADMIN_DEMO_MODE=true` — **server-only**, never `NEXT_PUBLIC_`, permitted in `.env.local` and Vercel **Preview** only.
3. A build-time assertion fails the build when the deploy is production and the flag is set (`VERCEL_ENV === "production" && ADMIN_DEMO_MODE === "true"`). Demo mode cannot reach production by accident; it breaks the deploy instead. On a non-Vercel host an equivalent environment discriminator is required, and the assertion **fails closed** if it cannot determine the environment.
4. Demo rows are generated **in memory per request**, never persisted. Every synthetic order number is prefixed `DEMO-`, never `NIYA-`, so a stray row is one `grep` away.
5. **Flagging is loud, not tasteful:** a persistent amber bar ("Demo data — nothing here is real"), an outline `Badge "Demo"` on every widget rendering synthetic rows, and `[DEMO]` prefixed to the document title so screenshots self-identify.
6. **`products.js` seed numbers are treated as mock data, not history** — see §3.

The result: on day one every number on this dashboard is either genuinely zero or genuinely derived from the catalogue. Nothing is invented to make the page look alive.

---

### 12. Accessibility

`<main>` with a single `<h1>Dashboard</h1>`; each widget is a `<section>` with an `aria-labelledby` pointing at its card title. KPI deltas carry visually-hidden text stating direction and comparison window. Every chart is preceded by a visually-hidden data table of its buckets — a canvas-free equivalent, no extra library. Severity is icon + label + colour, never colour alone. All interactive elements keyboard-reachable with visible `focus-visible` rings; the inventory page's inline editing supports arrow/tab traversal across all 66 rows.

### 13. Out of scope for this section

Owned elsewhere in the blueprint: the entity definitions and migrations, the order status state machine, `/orders`, `/products`, `/inventory`, `/content/*` and `/settings/*` page designs, the admin's public API surface, and the auth configuration. Explicitly **[LATER]**, each with its blocker: storefront event tracking (needs storefront changes), review moderation (needs a submission path), coupon/discount rules (no entity), refunds (no payment processor), customer email (no ESP), LTV and cohorts (needs ≥6 months of orders).


**Decisions**

- FIX: Corrected verified numbers the draft got wrong — 22 of 39 products are below the ₹2,000 free-shipping threshold (not ~21), median list price is ₹1,999 (the draft's 'mode near ₹1,899' is a three-way tie at 1799/1899/1999), and there are 66 variants across 39 products (not '39 × ~2'). Inventory setup is now stated as 0 of 66 variant rows.
- FIX: Added §2 'Canonical measures' because the draft used three incompatible revenue denominators. KPI 1 summed order.totalAmount (which includes shipping) while KPI 6's numerator and Top selling's revenue share were merchandise-only — every share percentage was systematically understated. Renamed KPI 1 to Merchandise revenue, moved shipping to a separate sub-line, and made KPI 3 (AOV) merchandise-only so it is actually comparable to the ₹2,000 subtotal threshold it is benchmarked against (OrderPage.jsx:82 tests subtotal, not total).
- FIX: Replaced the draft's 'the storefront payload stores only price so KPI 6 needs a column from day one' with the correct architectural answer: the admin's order-create endpoint must re-price server-side from the catalogue and never trust client-sent price/subtotal/totalAmount. This is both a security fix (the storefront computes money client-side) and it yields listPricePaise + unitPricePaise for free. Also added server-generated order numbers (NIYA-YYMM-NNNN) since the storefront's client-side `NIYA-` + Date.now() is collision-prone and untrustworthy.
- FIX: Committed money storage to INTEGER paise with a documented en-IN formatter. The draft never said how ₹ is stored, which invites float drift in every aggregate.
- FIX: Alert 6 was a hallucination. The draft claimed content blocks link to product slugs; verified that every buttonLink in homeData.js is a route path (/craftsmanship, /shop) and none points at a product. Rewrote it as a general dead-link check against a hardcoded copy of the 20 storefront routes plus published slugs — copied into admin_panel/src/lib/storefront-routes.ts, never imported from the forbidden folder.
- FIX: Alert 11 (empty subcategory) would have fired ~5 permanent false alerts. The draft used a 5-subcategory × 2-gender cartesian product, but getCategories() only emits facets that exist in the data, and only five do: women-handbags(6), women-minibags(14), women-sling(9), women-tote(7), men-wallet(3) — all three men's products are wallets and women-wallet does not exist. The rule now watches only facets with a non-zero baseline and fires on the transition to zero.
- FIX: Split the 'variant with no image' alert. Verified ProductCard's resolver is thumbnail ‖ images[0] ‖ variants[0].images[0] ‖ image ‖ image_link ‖ "" — so only variants[0] breaks the card (critical, empty src not a placeholder); a later variant missing images is a PDP gallery gap (warning). Added alert 2b: ProductCard prefers the stored discountPercentage over the computed one, so a stale stored value prints a wrong badge.
- FIX: Demoted the review-moderation alert to [LATER] behind a flag. The storefront has no review submission path anywhere — reviewsData is three hardcoded testimonials — so a v1 moderation queue could only contain rows the admin typed itself. Over-engineering for this store.
- FIX: Replaced alert 5's hand-waved 'IST business-hours aware' with a committed flat 24h IST wall-clock threshold. A one-operator brand does not need a business-calendar engine.
- FIX: Added §0, an access-control contract the draft omitted — what a signed-in USER sees on /dashboard (a static 403, never a redirect, which would loop on an authenticated session), and the explicit rule that middleware is not the security boundary; requireAdmin() is called inside every query.
- FIX: Corrected the KPI grid ladder. The draft put six tiles across at xl ≥1280, which is ~185px per tile — too narrow for value + delta + sparkline. Six-across now starts at 2xl ≥1536; xl and lg use 3×2; below 640 stays 2-up rather than a six-tall scroll. Also removed the specious '6 divides cleanly so no orphan cell' rationale — the tile count is a content decision, and the ladder renders 4, 5 or 6 without orphans.
- FIX: Two cache-correctness bugs. (a) Range-dependent queries must include from/to/g in the cache key or every custom range serves last-30-days numbers. (b) The header's manual refresh cannot be router.refresh() alone — that re-renders against the same cached data; it is now a Server Action that revalidates the tags first.
- FIX: Modernised the caching primitive to Next 16's `use cache` + cacheTag/cacheLife with unstable_cache named as the Next 15 fallback, matching the 'latest stable Next.js' constraint.
- FIX: Clarified that nuqs is the client-side URL control only; the RSC reads the awaited searchParams prop. The draft implied state 'lives in nuqs', which is not a server data source.
- FIX: Cut the empty storefront_events table stub. An unused table no widget reads is scaffolding for a feature that requires storefront changes we are forbidden to make; the intent is recorded in the cutover note instead.
- FIX: Replaced the 'Update stock' bulk-edit Sheet with a dedicated /inventory page. 66 variant rows of data entry in a slide-over is a UX trap. Made Export orders explicitly disabled-with-tooltip pre-cutover, since no order can exist.
- FIX: Added §9, a single storefront.connected Setting row driving all honesty affordances (global banner, 'Not live yet' chips, disabled export, checklist step 5) plus a precedence rule against the demo bar. The draft scattered the honesty message and never named a mechanism.
- FIX: Made the pre-cutover reality explicit in the alert table via a 'Fires pre-cutover' column, and stated plainly on the page that a permanently empty Recent orders card is the correct expected state — no order can arrive before the cutover, so it is not a sign of missed sales. The draft's 'auto-retires on the first real order' never confronted that no first order is possible.
- FIX: Recorded the two contract requirements the admin imposes on the future cutover in the cutover note: variants must carry stable ids (verified CartContext.getVariantKey falls back to productId because variants have only `name`, collapsing every variant into one cart line) and timestamps must be ISO, not toLocaleString("en-IN").
- FIX: Committed customer identity resolution to normalised 10-digit phone as primary key with email secondary. The draft said 'keyed on normalised email + phone' without saying which wins — a mistyped email would split a repeat buyer in two and silently depress KPI 4.
- FIX: Added a query-budget and index table (§10) and the rule that each widget is one SQL statement with the IST-bucketed aggregations as typed $queryRaw, since Prisma's query API cannot express AT TIME ZONE bucketing. The draft specified caching but never query cost or shape.
- FIX: Added an accessibility section (§12) — screen-reader text on delta chips, a visually-hidden bucket table beside each chart, table captions, keyboard traversal across the 66-row inventory grid. The draft only covered icon-plus-colour.
- FIX: Tightened the ErrorBoundary/Suspense nesting to an explicit order (ErrorBoundary > Suspense > async widget) rather than 'inside widget-shell'; hardened the demo-mode build assertion to fail closed when the environment cannot be determined; changed the audit-feed example actor away from 'Priya', which collides with a name in the storefront's testimonial data.
- FIX: Added §13 listing what this section does not own and every [LATER] item with its specific blocker, so the deferrals are auditable rather than implied.

**Open assumptions**

- Order status vocabulary is PLACED, CONFIRMED, SHIPPED, DELIVERED, CANCELLED, RETURNED, FAILED_DELIVERY. The storefront has exactly one value today, the string "ORDER PLACED". If the owner wants different names or an extra state (e.g. PACKED, RTO_INITIATED distinct from RETURNED), the KPI 1/5 formulas and alert 5 must be updated with them.
- The monthly revenue target behind the KPI 1 meter is operator-entered in Settings. No historical baseline exists to derive one from, and the tile renders without a meter until a target is set.
- Default low-stock threshold of 3 units and the 24-hour stale-order threshold are starting values for small-batch luxury handbags, overridable per product and globally in Settings. Confirm 3 is right — a made-to-order item might warrant 1.
- Customer records are created at checkout from shippingDetails, never by registration, because storefront auth is localStorage-only. This means the admin has no notion of a registered-but-never-purchased customer, and 'First seen' is a first-order date.
- ContentBlock ships with isActive / publishAt / expiresAt in v1. If scheduling is deferred, alert 10 is deferred with it — say so and it comes out of the registry.
- Deployment is Vercel, so VERCEL_ENV discriminates production for the demo-mode build assertion. On another host an equivalent discriminator must be provided or the assertion fails closed and blocks the build.
- The five gender-subcategory facets and the 20-route storefront allowlist are snapshots of the current storefront. If the storefront owner adds a route or a women-wallet product later, the copied allowlist and the facet baseline need a manual mirror — confirm you accept that manual step in exchange for zero storefront coupling.
- Nobody is placing real orders through the storefront today (it saves to localStorage only). If phone/WhatsApp COD orders are actually being taken, a manual order-entry form is needed in v1 so the dashboard is not blind until cutover — that is not currently scoped.
- Reviews, coupons, refunds, customer email and event tracking are all [LATER]. Confirm none of these is expected in the first release.

**Risks**

- The dashboard's entire sales half is dead until the storefront cutover, which this project is forbidden to perform. If the owner's mental model is 'the admin will show me sales next week', that expectation gap is the single largest project risk — §9's banner and §11's framing mitigate it but do not remove it.
- Identity resolution on normalised phone is a one-way door. If two real customers share a household phone, or one customer orders from two numbers, the repeat-rate and lifetime-value numbers are wrong in ways that are hard to detect later. Manual merge is provided; automatic merge on email is deliberately not.
- Nine cached aggregations plus tag invalidation is real complexity for a store with zero orders. It is justified only because the read model must be right before data arrives; if the store never scales past a few orders a day, most of this cache layer is inert cost. Consider shipping without caching first and adding tags when a query actually gets slow.
- The copied storefront route allowlist and the category-facet baseline will silently drift when the storefront changes, because the admin cannot import from it. Alert 6 will then produce false positives (or miss dead links) with no mechanism to notice. A quarterly manual reconciliation task is the honest mitigation.
- IST bucketing lives in raw SQL. Any future move off Postgres, or a Prisma-level refactor of these queries, will silently reintroduce UTC bucketing and shift every evening order into the next day. These queries need a test asserting a 22:00 IST order lands in the correct day bucket.
- Server-side re-pricing at order creation means the storefront and admin can disagree on a total at checkout time. If the storefront's client-computed total is shown to the shopper and the server computes a different one, the shopper sees one number and the admin another. The mismatch alert catches it after the fact; the real fix is the storefront reading prices from the API at cutover, which is outside this project's scope.
- The demo-mode build assertion depends on an env var being correctly set on every deployment target. A misconfigured self-hosted deploy is the one path by which fabricated rows could reach a production screen; the fail-closed rule makes that a broken deploy rather than a silent lie, which trades one failure mode for a noisier one.
- Six KPI tiles all reading zero for months is a demoralising first impression and invites someone to 'just seed a few orders to see it working' — exactly the behaviour the mock-data policy forbids. Consider hiding the KPI row entirely behind storefront.connected and letting the Setup checklist own the page until cutover.

---

## Product, Category and Review Management UX

### 0. Sizing the problem against the real catalogue

Every number below was read out of `e-commerce_frontend-main/src/data/products.js` (1797 lines), not estimated.

| Fact | Verified value |
|---|---|
| Products | **39** |
| Gender split | 36 `women`, 3 `men` — the three men's rows are **all wallets** |
| Subcategories | handbags 6, minibags 14, sling 9, tote 7, wallet 3 |
| Live category tiles today | **5**, not 10 — `getCategories()` emits `women-handbags`, `women-minibags`, `women-sling`, `women-tote`, `men-wallet` |
| Price span | **₹999 – ₹3,599**, all integers |
| On sale | 10 products |
| `isFeatured: true` | 16 products — but `FeaturedProducts.jsx` slices to **4**, so 12 are invisible on the homepage |
| Option axes | one: colour |
| Colour names in data | Black 34, Brown 22, Tan 9, Beige 9, Pink 2, Gold 1, **Coffee 1** |
| Variants carrying an `id` | **14 of ~90** — only the 7 tote products, shaped `tote-001-brown` |
| Humans who will open these screens | one, role `ADMIN` |

This is not a PIM. Investment goes into **edit safety, a correct wire contract, and one shared table shell**. Not virtualisation, not a spreadsheet grid, not a rich-text pipeline, not a moderation queue for reviews that do not exist.

#### The honesty rule that governs every screen

Nothing saved here reaches shoppers today. The storefront reads `src/data/products.js` and `src/data/homeData.js` through thin adapters in `src/api/`. The admin owns its own Postgres and its own API. The storefront cutover is a **later, separate step** — and it is *not* uniformly mechanical (see §6).

Two enforcement mechanisms:

1. `NEXT_PUBLIC_STOREFRONT_WIRED=false` renders a persistent `Storefront sync: pending cutover` chip in the app shell.
2. Every field with **no storefront consumer at all** carries an inline `Stored, not yet displayed on the storefront` hint. That covers `sku`, `stock`, `costPrice`, `tags`, `metaTitle`, `metaDescription`, `category.description`, `category.position`, `moderationNote`. Silent dead fields are how an admin panel starts lying to its only user.

#### Access control and data flow (consistent with the rest of the blueprint)

- Two roles only. `middleware.ts` matches `/(dashboard)/:path*` and redirects any session whose `role !== 'ADMIN'`; every Server Action and route handler re-checks the Auth.js v5 session server-side. `USER` never reaches these screens and never needs to — customer accounts live on the storefront's own (currently fake) auth.
- **Server-first.** List and detail pages are React Server Components calling `features/<entity>/queries.ts` (Prisma) directly. There is no self-`fetch` of our own REST layer. Route handlers exist only for (a) the **public** storefront-facing read API, (b) client-polled helpers (`slug-available`, `facets`), (c) CSV export and upload presigning. All mutations are **Server Actions** with `revalidatePath`.

#### Shared table shell

`@tanstack/react-table` v8 (headless) + shadcn `table / checkbox / dropdown-menu / badge / skeleton`, `nuqs` for typed URL state, `use-debounce` for search. **Not AG Grid or MUI DataGrid** — licence surface and a competing theming layer for a 39-row table, and both fight Tailwind v4 tokens. One `<DataTableShell>` amortises across products, categories, testimonials, orders and users.

```
admin_panel/src/
  app/(dashboard)/products/      page.tsx | new/page.tsx | [id]/page.tsx
  app/(dashboard)/categories/    page.tsx | [id]/page.tsx
  app/(dashboard)/testimonials/  page.tsx | [id]/page.tsx
  app/(dashboard)/reviews/       page.tsx        # placeholder + blocker copy
  app/(dashboard)/media/         page.tsx
  app/api/products/…             # PUBLIC read API (storefront target)
  app/api/categories/            # PUBLIC
  app/api/content/reviews/       # PUBLIC (testimonial feed)
  app/api/admin/…                # slug-available, facets, export.csv, presign
  features/products/     components/(ProductForm, sections/*, VariantTable,
                         MediaGrid) schema.ts queries.ts actions.ts columns.tsx
  features/categories/  features/testimonials/
  components/data-table/ (DataTableShell, Toolbar, BulkBar, ViewTabs,
                          ColumnMenu, Pagination)
  scripts/seed-from-storefront.ts   # one-off, read-only
```

---

### 1. Verified storefront quirks the admin and its API must honour

This table is the highest-value part of the section. Each row is a behaviour I read in the storefront source; each dictates a schema or API decision. Getting these wrong means the cutover requires edits inside the forbidden folder.

| # | Verified behaviour | Consequence for the admin |
|---|---|---|
| 1 | `ProductDetails.jsx:136` — `product?.numReviews \|\| product?.reviewsCount \|\| product?.reviews?.length`. It **never reads `reviewCount`** | The public payload must emit **`numReviews`** as an alias, or every PDP shows no review count after cutover |
| 2 | `ProductDetails.jsx:115` — `finalPrice = Number(product?.salePrice \|\| product?.price)`. **`isOnSale` is ignored** | A non-null `salePrice` with `isOnSale:false` silently sells at the stale sale price on the PDP while the card shows MRP. Enforce `salePrice IS NULL WHEN isOnSale = false` as a **DB check constraint**, not a UI nicety |
| 3 | `CartContext.jsx:31` — key is `selectedVariant?.id \|\| selectedVariant?._id \|\| product.variantId` | Variants must ship stable ids. 32 of 39 products have none today, so two colours of the same bag merge into one cart line |
| 4 | The 7 tote products **already** carry variant ids shaped `tote-001-brown` | Mint ids as `<productId>-<colorSlug>` and **preserve the 14 existing tote ids verbatim** — not random cuids, which would orphan any cart line already in a shopper's `localStorage` |
| 5 | `ShopPage.jsx:105-115` — colour chips are a `Set` of `v.name.trim()` (case-sensitive) while filtering lowercases | Trailing space is already handled; the real drift is **case and synonyms**. The data already contains `Coffee` (1) alongside `Brown` (22) — two chips for one visual family. Hence a controlled palette |
| 6 | `ShopPage.jsx:62-75` maps only `filter=new-arrivals \| best-sellers \| sale`, but `FeaturedProducts.jsx` links `View All → /shop?filter=featured` | That link lands on an unfiltered shop. Admin cannot fix it; log as a post-cutover storefront task |
| 7 | `CategorySection.jsx` navigates to `/shop?gender=X&subcategory=Y`, but **ShopPage never reads `gender`** | The `men/wallet` and a future `women/wallet` tile would land on identical lists. Post-cutover storefront task; do not design around it |
| 8 | `ShopPage` "New Arrivals" = `createdAt` within the last **30 days** | The seed must **preserve the original `createdAt` strings** (`"2026-08-14"`). Stamping import date makes all 39 products new arrivals |
| 9 | `CustomerReviews.jsx:6` — `const reviews = getReviews();` **called synchronously, not awaited** | Repointing `homeApi.js` at HTTP returns a Promise, `reviews?.length` is `undefined`, the component returns `null` and the homepage reviews section **silently vanishes**. The testimonial cutover requires a storefront component edit |
| 10 | `CustomerReviews.jsx` — `Array.from({length: review.rating \|\| 5})` | A null rating **displays five stars** |
| 11 | `CustomerReviews.jsx` — hardcodes `{review.location} · Verified Customer` | Every testimonial claims verified status; `isVerifiedBuyer` cannot suppress it from the admin side |
| 12 | `CustomerReviews.jsx` maps **every** returned row into `md:grid-cols-3` with no slice | The API's `LIMIT` is the only length control. 3 or 6 render cleanly; 4 or 5 leave an orphan row |
| 13 | `CustomerReviews.jsx` keys on `review.id \|\| review.name` | Emit `id` in the feed so two testimonials from the same first name do not collide |
| 14 | `ProductCard.jsx:21-25` image chain: `thumbnail \|\| images[0] \|\| variants[0].images[0] \|\| image \|\| image_link` | Keep `variants[].images[]` populated; optionally add `thumbnail` for a cheaper card image |
| 15 | `getCategories()` image chain ends at `variants[0].images[0]`; tile shape is `{gender, name, filter, image, count}` | The public `/categories` response must keep that exact shape |
| 16 | Product images are **storefront-relative** paths (`/products/bags/tote/WhatsApp Image 2026-08-17 at 5.37.36 PM.jpeg`) served from the Vite `public/` dir | They resolve on the storefront origin but **404 inside the admin panel**, which is a different domain. See §3 Media |
| 17 | `index.html` has one static `<title>`; no per-route title or meta anywhere in `src/` | `metaTitle`/`metaDescription` are unrenderable even after cutover. Store them, do not build a SERP preview |
| 18 | `FeaturedProducts.jsx` slices each of its three sections to **4** | The featured warning threshold is 4, not 8. 16 products are flagged featured today and 12 never appear |
| 19 | `getFeaturedProducts(limit = null)` returns **all** featured; `getBestSellerProducts/getNewArrivalProducts` default `limit = 8` | The public API's default limits must match, or section contents shift at cutover |
| 20 | `discountPercentage` is a **stored** rounded integer (2999 → 2499 = 16.67% stored as `17`) | Recompute and store on every price write; `ProductCard` falls back to computing it, `ShopPage`/`SalePage` read the stored value |

---

### 2. The product LIST screen

#### Columns

| Column | Content | Sortable | Default | Notes |
|---|---|---|---|---|
| select | checkbox | – | on | page-scoped |
| thumb | 40px `variants[0].images[0]` | – | on | `next/image`, blur placeholder |
| title | title + slug muted below | yes | on | click → `/products/[id]`; sticky |
| status | Badge DRAFT / PUBLISHED / ARCHIVED | yes | on | three states only (see §3) |
| category | subcategory label | yes | on | click filters the list |
| gender | women / men | yes | on | separate axis; 3 rows are `men` |
| price | ₹ MRP | yes | on | strikethrough when on sale |
| salePrice | ₹ sale + `−17%` chip | yes | on | percent is the **stored** value, shown not recomputed |
| stock | Σ variant stock + low dot | yes | on | admin-only; storefront has no stock concept |
| variants | count + colour dots | no | on | hover card lists colour names |
| featured | star toggle, optimistic | yes | on | writes `isFeatured`; shows rank hint when beyond the homepage's 4 |
| sku | base SKU | no | off | new field, no storefront consumer |
| orderCount | int | yes | off | hand-seeded today |
| rating / reviewCount | value + count | yes | off | hand-seeded today |
| createdAt / updatedAt | relative + ISO tooltip | yes | `updatedAt` on | `updatedAt` does not exist in current data |
| actions | ⋮ Edit, Duplicate, Archive | – | on | Delete lives only in the Archived view |

#### Filter bar

| Control | Param | Component | Values |
|---|---|---|---|
| Search | `q` | Input | debounce 300ms, min 2 chars, matches title / slug / sku |
| Status | `status` | multi Select | draft, published, archived |
| Category | `category` | multi Combobox | handbags, minibags, sling, tote, wallet |
| Gender | `gender` | Select | women, men |
| Colour | `color` | multi Combobox | palette values present in the catalogue |
| Stock state | `stock` | Select | in_stock, low, out |
| Sale | `sale` | tri-state Toggle | on sale / not / any |
| Featured | `featured` | tri-state Toggle | – |
| Price range | `price_min` `price_max` | two numeric Inputs | ₹ integers; placeholders show the live catalogue bounds (₹999 / ₹3,599) |
| Created | `created_from` `created_to` | `react-day-picker` range | date-only |

A slider is wrong here: the whole catalogue lives in a ₹2,600-wide band and the merchandiser thinks in exact rupee steps. Active filters render as removable chips with `Clear all`.

#### Saved views (tabs)

Pure URL presets, not stored records — one admin, zero need for saved-view CRUD. Counts come from one `GET /api/admin/products/facets` call.

| Tab | Query |
|---|---|
| All | *(none)* |
| Published | `status=published` |
| Draft | `status=draft` |
| On Sale | `sale=true` |
| Low Stock | `stock=low,out` sorted `stock asc` |
| Archived | `status=archived` |

#### URL-as-state contract

`nuqs` parsers give typed round-tripping with `history: 'push'` on filter changes, so Back genuinely undoes a filter. Params: `q, status, category, gender, color, stock, sale, featured, price_min, price_max, created_from, created_to, sort, dir, page, per`. Defaults are omitted (`clearOnDefault`) so a shared link stays readable. `view` is **not** a param — the tab is derived from the params, keeping one source of truth.

Sorting: default `sort=updatedAt&dir=desc`, always with an `id asc` tiebreak server-side, otherwise rows with equal `updatedAt` shuffle between pages. Pagination is offset-based, `per=50|100` with **50 as the default so the entire 39-row catalogue is one page**; `Showing 1–39 of 39`, prev/next, page jumper. Keyset is a documented later swap that does not change the URL contract.

#### Selection and bulk actions

Selection is by id in React state, page-scoped. Because the default page holds the whole catalogue, the draft's "select all matching across pages" escalation strip is **cut** — it is machinery for a problem this store does not have. Changing any filter clears the selection and toasts *"Selection cleared"*; silently retaining ids that are no longer visible is how people archive the wrong products.

The bulk bar is a fixed bottom `Card` showing `N selected` and:

| Action | Guardrail |
|---|---|
| Publish | runs `publishSchema` per row; partial-success dialog lists which rows failed and why |
| Unpublish | → DRAFT, `publishedAt` retained |
| Archive | soft, reversible, AlertDialog with count |
| Feature / Unfeature | after the write, shows *"N featured — the homepage renders the first 4"*; warns when the total would drop below 4 (short row) |
| Set sale | dialog: percent off or fixed price, per-row ₹ preview, rounds to whole rupees, writes `price`/`salePrice`/`isOnSale`/`discountPercentage` together |
| Clear sale | nulls `salePrice`, zeroes the percent, sets `isOnSale:false` — one action because quirk #2 makes a half-cleared sale a live mispricing |
| Assign category | Combobox, shows old → new |
| Delete | Archived rows only, type-to-confirm |

Every bulk op writes one `AuditLog` row per product (actor, op, before/after diff). With two roles and no approvals, the audit log is the only accountability mechanism, and it is ~20 lines of Prisma middleware.

#### Density, columns, empty states

Column visibility and density (`comfortable` 56px / `compact` 40px) persist in `localStorage` under `niya.admin.table.products.v1`, **not** in the URL: they are personal ergonomics, and URL-borne layout makes shared links carry someone else's preferences. Empty states: skeleton rows while loading; *"No products match these filters"* with `Clear filters`; and a distinct first-run state that **links to the seed runbook rather than offering an import button** — the seed script reads a file in the storefront repo, which does not exist on the deployed admin, so a production button would be a lie.

---

### 3. The product CREATE / EDIT experience

#### Decision: one long form, sticky section nav, sticky action footer

Tabs hide validation errors behind unvisited panels — the classic failure is Save erroring on a field the user never opened. A wizard is wrong because **editing dominates**: 39 products exist, creation is rare. One scrolling form with a sticky anchor nav (`Basics · Media · Pricing · Variants · Inventory · Organisation · SEO · Status`) gives one dirty state, one submit, browser find, and per-section error dots. Main column + right rail (Status, Organisation) at ≥1280px, collapsing below; the rail is `position: sticky`. The footer holds `Save`, `Save and publish`, a dirty indicator and the last-saved timestamp.

#### Field groups

**Basics**

| Field | Control | Rules |
|---|---|---|
| `title` | Input | required, 3–120 |
| `slug` | Input + lock toggle | auto-slugifies from title until manually touched; debounced 400ms `GET /api/admin/products/slug-available` shows ✓/✗ and suggests `-2`. **Honest note:** the storefront routes `/product/:id` and calls `getProductById`, so slug is dead data until cutover; it is still unique-enforced because the cutover should move URLs to slugs |
| `description` | **plain Textarea**, 40–600 chars with counter | The storefront renders `description` as a bare string in a `<p>`. A rich-text editor would either print tags on the PDP or require storing the field twice for zero visible benefit. **Rich text is [LATER]**, unlocked only if the PDP ever renders HTML |

**Media** — dnd-kit sortable grid, drag-drop upload, presigned PUT to the S3-compatible bucket the rest of the blueprint already uses, position 0 = card image. Per-image `alt` is required by `publishSchema`. Each image is assigned to one or more colours via chips on the tile — that is how `variants[].images[]` gets populated. A `Media library` dialog enables reuse, which matters because **today the same JPEG is repeated three times inside a single variant**. Uploaded keys are slugified: existing filenames literally contain spaces and must never become production URLs.

Two media facts the draft missed:

- **Legacy images stay where they are.** The 39 products point at storefront-relative paths under the storefront's `public/`. The seed stores them verbatim (so the post-cutover PDP keeps working) and the admin renders them through `NEXT_PUBLIC_STOREFRONT_ORIGIN + path`, with that origin added to `next.config` `images.remotePatterns`. New uploads are stored as absolute object-store URLs. The API therefore emits a mix of relative and absolute strings — both are valid `<img src>` values on the storefront, which is the only consumer.
- **AVIF/WebP derivative pipelines are [LATER]** — `next/image` covers the admin's own thumbnails, and the storefront serves its own static files; a transform pipeline for 39 products is unpaid work.

**Pricing** — mirrors the existing wire shape exactly: `price` (MRP), `salePrice`, `isOnSale`, `discountPercentage`.

- Two-way binding: typing `salePrice` computes `discountPercentage = round((price − sale) / price × 100)`; typing the percent computes `salePrice` rounded to whole rupees. Both fields are written because `ShopPage`/`SalePage`/`ProductCard` read the stored percent. Verified against data: 2999 → 2499 stores `17`.
- `isOnSale` auto-sets when a valid `salePrice < price` exists; clearing it **nulls `salePrice` and zeroes the percent**, enforced by a DB check constraint — see quirk #2, where a stale `salePrice` silently discounts the PDP.
- `costPrice` (nullable) + live margin display: **admin-only, never serialised into the public product API.** That is stated in the endpoint contract, not just the UI.
- Amounts stored as integer minor units; the public API emits whole rupees to match today's `2999`.

**Variants** — one option dimension: colour. No generic option-matrix generator. A colour token input constrained to a controlled palette **seeded from the catalogue** (Black, Brown, Tan, Beige, Pink, Gold, Coffee) generates rows; adding a new colour is an explicit "add to palette" action so drift is deliberate.

```ts
type Variant = {
  id: string          // "<productId>-<colorSlug>", e.g. "tote-001-brown"
  colorName: string   // from the palette
  colorHex: string    // swatch; post-cutover storefront use
  sku: string         // auto NIYA-HB-001-BLK, editable
  stock: number
  imageIds: string[]  // ordered
  position: number
}
```

`priceOverride` is **cut**: the PDP computes price from product-level `price`/`salePrice` only, so a per-variant price would silently never apply. Add it the day the PDP reads it.

Two grounded reasons for the controlled palette, both verified: the catalogue already contains `Coffee` next to 22 `Brown`s, producing two filter chips for one family; and `ShopPage` builds chips from raw names case-sensitively while matching lowercased, so `Black` and `black` would split. Emitting stable `variant.id` remains the single highest-value schema fix in this section — it fixes the cart dedupe collapse for the 32 products that lack ids, while the 7 totes keep theirs.

**Inventory** — `trackInventory` switch, per-variant `stock`, `lowStockThreshold` (default 3), `allowBackorder` off. Honest scoping: the storefront has **no stock concept** — its "Availability" filter is actually New Arrivals / Best Sellers / Featured / On Sale. Stock is an internal ops signal (Low Stock view, dashboard alert) and stays internal even after cutover unless the PDP grows an out-of-stock state. The only lever that changes what shoppers see is publish/archive.

**Organisation** — `category` (Combobox over the Category entity), `gender` (women/men), `tags` (admin-only, powers admin search and nothing else), `isFeatured` with the live "homepage shows the first 4 of N" hint. `orderCount`, `rating`, `reviewCount` are editable-with-warning seed fields ("manually seeded; becomes automatic when orders and reviews go live"). A computed `badges` field is **cut** — `ProductCard` takes its badge from the *section* that renders it (`badgeText` prop), so a product-level badge has no consumer.

**SEO** — two nullable fields, `metaTitle` and `metaDescription`, in a collapsed section labelled *Stored for a future storefront change*. The live SERP preview, `ogImageId` and `canonicalPath` are **cut**: the storefront is a Vite SPA with a single static `<title>` in `index.html` and no per-route meta rendering anywhere, so these are unrenderable even post-cutover. Rendering them requires SSR or a head manager on the storefront, which is out of scope. Storing two columns costs nothing and loses no work.

**Status & publishing** — `DRAFT | PUBLISHED | ARCHIVED` plus `publishedAt` and `archivedAt`. `SCHEDULED` is **cut to [LATER]**: nothing is publicly visible until cutover, so scheduling today schedules nothing, and it drags in a date picker, a fourth badge colour and a cron. When it lands, it is enforced **at read time** in the public query (`status='PUBLISHED' AND publishedAt <= now()`) so correctness never depends on a cron firing; any cron would only relabel cosmetically.

#### Save model, guards and destructive paths

- **Explicit save, never autosave.** Autosave on a published product means a half-typed ₹29 price is briefly canonical, there is no version-history budget to undo it, and edit volume is low. Crash safety instead comes from a **debounced sessionStorage snapshot** (2s) keyed `product:<id>` with a `Restore unsaved changes?` banner on reopen. IndexedDB is unnecessary for a form this size.
- **Draft-first creation.** Entering `/products/new` fires the `createProductDraft` action, returning a `DRAFT` row with an id so media uploads have an owner and the URL becomes `/products/[id]` immediately. Empty untouched drafts older than 7 days are purged **lazily on product-list load** — no cron, one fewer moving part.
- **Unsaved-changes guard.** Two mechanisms, because App Router exposes no blocking navigation API (`useBlocker` / `onBeforeNavigate` do not exist in `next/navigation`): `beforeunload` for tab close and reload, plus a `<GuardedLink>` wrapper and a guarded `router.push` used by the sidebar and breadcrumbs, opening a shadcn `AlertDialog` (Discard / Keep editing). Budget this deliberately; teams discover it too late.
- **Duplicate.** Copies everything except `id`, `slug` (`-copy`), variant ids and SKUs, `publishedAt`, `orderCount`, `rating`, `reviewCount`; forces `DRAFT`; titles it `Classic Handbag (Copy)`; opens the editor.
- **Preview.** Cannot reach the storefront today and the UI says so. Ship an in-admin `Preview` sheet rendering an admin-side replica of the PDP and card layout. `View on store` appears only for products whose id exists in the static catalogue (deep-linking `https://<storefront>/product/handbag-001`, which works today). Signed-token draft preview is **[LATER]**, post-cutover.
- **Delete vs archive.** Archive is the default and the only destructive action on the row menu: sets `archivedAt`, hides the row from public queries, one click to restore. Hard delete exists only inside the Archived view, requires typing the exact product title, and is blocked once order lines reference the product (order lines snapshot title and price, so history survives).
- **Validation.** One zod file, two schemas: `draftSchema` (title only) and `publishSchema` (title, ≥1 image with alt, `price > 0`, category, ≥1 variant with a SKU, unique slug, and the `isOnSale`/`salePrice` invariant). Validate on blur for touched fields, live for counters and price maths, full schema on submit. `react-hook-form` + `zodResolver`, the **same schema re-run in the Server Action** — client validation is UX, server validation is the contract.
- **Error summary.** On failed submit: a destructive `Alert` pinned under the header listing each error as a button that focuses and scrolls to its field, red dots on the offending section-nav items, `aria-invalid` + `aria-describedby` per input, and focus moved to the summary so screen readers announce it.

---

### 4. Bulk import / export

**Verdict: Export = [NOW]. Import UI = [LATER].** For 39 products and one merchandiser, the genuine one-time need is seeding `products.js` into Postgres — a one-off script (`pnpm seed:from-storefront`) reading the storefront file **read-only**, not a UI feature. A mapping wizard, dry-run engine and error-report downloader before the catalogue passes ~200 SKUs is misallocated effort. Export ships now because it costs a day and covers backup plus bulk price edits in a spreadsheet.

CSV column contract, shared by the seed script, export and any future import (one schema, `papaparse` + zod):

| Column | Type | Notes |
|---|---|---|
| `handle` | string | slug; **upsert key**, makes re-import idempotent |
| `title`, `description` | string | plain text |
| `gender` | enum | women, men |
| `category` | string | subcategory slug; must exist |
| `price`, `sale_price` | int ₹ | blank `sale_price` = not on sale, and forces `isOnSale=false` |
| `status` | enum | draft, published, archived |
| `featured` | bool | – |
| `created_at` | date | **preserved from `products.js`**, never restamped — the storefront's New Arrivals filter is a 30-day window |
| `tags` | string | pipe-separated, admin-only |
| `meta_title`, `meta_description` | string | stored, not rendered |
| `variant_id` | string | preserved for the 14 existing tote ids; minted as `<handle>-<color>` otherwise |
| `variant_color`, `variant_sku`, `variant_stock` | – | one row per variant; product columns repeat or blank on continuation rows |
| `variant_image_1..3` | url or storefront-relative path | both accepted (see §3 Media) |

When import does land: upload → column mapping (remembered) → **dry run** rendering parsed rows in the same `DataTableShell` with per-cell error chips and an `N valid · M invalid` header → *Import valid only* or *Cancel* → downloadable `errors.csv` carrying the original columns plus `_row` and `_errors`. Never partial-commit without showing that table first.

---

### 5. Category management

**Today categories are not an entity.** `getCategories()` groups products by `gender + "-" + subcategory`, borrows `variants[0].images[0]` as the tile image and counts rows. There is no description, banner, slug, SEO or ordering anywhere, and the tile order is object-insertion order.

**Decision: promote Category to a real entity; keep the wire shape backwards-compatible.** Products keep emitting `category:"bags"` and `subcategory:"handbags"` strings so the cutover needs zero `ShopPage` changes.

```ts
type Category = {
  id: string; slug: string; name: string      // "handbags"
  description: string | null                  // no storefront consumer yet
  imageId: string | null                      // falls back to the derived product image
  metaTitle: string | null; metaDescription: string | null
  isFeatured: boolean; position: number       // 10,20,30 sparse
  archivedAt: Date | null
}
```

`parentId` is **cut**. Five flat rows, one nesting level that would be unused; a nullable column is a one-line migration the day a real hierarchy appears.

**Gender vs category — committed:** gender stays a **product field**; categories stay gender-agnostic. Folding gender into a two-level tree (Women › Handbags) would duplicate copy and SEO the moment a second men's subcategory appears. Stated plainly: the homepage `CategorySection` keeps showing per-gender tiles, because the public `/categories` endpoint keeps emitting `{gender, name, filter, image, count}` per gender+subcategory pair that actually has products — **5 tiles today**, not 10, since the men's catalogue is wallets only. The admin edits one record and the API fans it out. The Category list therefore carries **two count columns (Women / Men)** plus total, each clickable into `/products?category=wallet&gender=men`.

Honest caveat: those tiles link to `/shop?gender=…&subcategory=…` and **ShopPage ignores `gender`**, so the men's-wallet tile and a future women's-wallet tile resolve to the same list. That is a storefront defect the admin cannot fix; it is logged as a post-cutover task and surfaced as an info note on the category screen so nobody files it as an admin bug.

**UI** — a single flat sortable list (dnd-kit `SortableContext`, drag handle, optimistic reorder, one `reorderCategories` action taking the ordered ids). Five rows do not justify a tree widget. Columns: drag handle, thumb, name, slug, products (Women / Men / total), featured toggle, position, updated, actions. The detail page is a plain form (name, slug with the same collision check, description, image, SEO, featured, position).

**Delete** — blocked while `productCount > 0`. The AlertDialog offers *"Reassign N products to [Combobox] and delete"* as one transactional action, or *Archive instead* (dropped from the public `/categories` response while products retain the string value). Categories are never cascade-deleted with their products.

**Honest note on ordering:** `position` and `description` have no storefront consumer today — the tile order is object-insertion order — so ordering is stored for the cutover and the screen says exactly that.

---

### 6. Reviews: two entities, not one

**There is no review entity, no review API and no submission form anywhere on the storefront.** `rating` and `reviewCount` are hand-typed numbers on products; the homepage carries three hardcoded testimonials with only `name`, `location`, `text`. The mistake to avoid is conflating two different objects.

| Entity | Purpose | Source | Ship |
|---|---|---|---|
| `Testimonial` | Homepage "Loved by Women Everywhere" strip | curated by admin | **[NOW]** — full CRUD |
| `ProductReview` | UGC tied to product + user + order | nothing produces these yet | **[LATER]** — Prisma model and state machine defined now; UI is a single placeholder page |

**Committed:** ship Testimonials CRUD now. For `ProductReview`, ship the schema plus one read-only page whose empty state names the blocker — *"Customer reviews will appear here once the storefront ships a review form and a PDP review section. Neither exists today."* The draft proposed building the full moderation queue (bulk actions, `j/k` and `a/r` shortcuts, five-state machine UI) behind that empty state; that is months of unusable screen. The moderation UI is unlocked by a single trigger: the storefront shipping a submit form.

The model is still specified now so nothing is redesigned later:

- States: `PENDING → APPROVED | REJECTED`; `APPROVED → HIDDEN` (reversible); any → soft `DELETED`. `isFeatured` is orthogonal and only settable on `APPROVED`.
- Reserved fields: `moderationNote` (admin-only, ships with the model), `reply` and `repliedAt` (columns reserved, hidden).
- **No public replies.** There is no PDP review section to render one into, and a reply implies notifying the customer — there is no email provider in the stack, and storefront auth today is `localStorage` fake auth with plaintext passwords in `niyaUsers`. Promising a reply channel would be a lie in three directions at once.
- **Rating rollup**, when reviews exist: `product.rating` and `reviewCount` become denormalised columns recomputed on every status transition, and the product form flips them read-only. The public payload must carry **`numReviews`** (quirk #1) or every PDP shows no count.

#### Testimonials and the three legacy rows

```ts
type Testimonial = {
  id: string; name: string; location: string; text: string   // exact homepage shape
  rating: number | null        // required 1-5 for new entries
  isVerifiedBuyer: boolean
  status: 'DRAFT' | 'APPROVED'; isFeatured: boolean; position: number
  source: 'SEED' | 'ADMIN' | 'REVIEW_PROMOTION'
}
```

`productId` is **cut** — the homepage component renders no product link, and an unused foreign key on three rows is decoration. It returns with `REVIEW_PROMOTION`.

Migrate the three legacy testimonials as `source:'SEED'`, `rating: null`, `status:'APPROVED'`, `isFeatured: true`, positions 10/20/30 — do not delete real social proof. Then surface the two traps verified in `CustomerReviews.jsx`:

1. `review.rating || 5` means a null rating **silently displays five stars**. The admin therefore requires a rating on all new testimonials and shows an amber *"displays as 5★ on the storefront"* badge on the three legacy rows until they are backfilled.
2. `{review.location} · Verified Customer` is hardcoded, so **every** testimonial claims verified status. `isVerifiedBuyer` is captured but labelled *cannot suppress the storefront's hardcoded label* — a documented post-cutover storefront change, not something the admin can fix.

**Homepage feed and its uncomfortable truth.** `GET /api/content/reviews` returns `Testimonial WHERE status='APPROVED' AND isFeatured=true ORDER BY position LIMIT 3`, shaped `{id, name, location, text, rating}`. The `LIMIT` is load-bearing: the component maps every row into a 3-column grid with no slice, so 3 or 6 render cleanly and 4 or 5 leave an orphan. The admin warns below 3 and at any featured count that is not a multiple of 3.

**And the cutover for this feed is not zero-change.** `CustomerReviews.jsx` calls `getReviews()` **synchronously** and renders the result immediately. Repointing `homeApi.js` at HTTP makes it return a Promise, `reviews?.length` becomes `undefined`, and the section disappears without an error. So the testimonial cutover needs a small storefront edit (state + `useEffect`) in a component, not only in `src/api/`. `homeApi.js` is also **not** exported from the `src/api/api.js` barrel, and the commented-out `contentApi.js` already contains a matching `getReviews()` against `/reviews` — so the cleanest cutover is: uncomment `contentApi.js`, point `VITE_MOCKOON_API_BASE_URL` at `https://<admin>/api/content`, switch `CustomerReviews.jsx` to import from `contentApi` and await it. Three edits, all outside this deliverable, all listed in the cutover runbook. The draft's claim of "zero component changes" was wrong.

When ProductReviews eventually go live, an approved 4★+ review gains a `Promote to homepage` action creating a `Testimonial` with `source:'REVIEW_PROMOTION'` and a back-link — one curation surface, two intakes.

---

### 7. API contract

**Public read API** — mounted so that setting the storefront's existing env vars is enough. `VITE_API_BASE_URL=https://<admin>/api` makes the already-written, commented-out axios calls in `productApi.js` resolve verbatim; `VITE_MOCKOON_API_BASE_URL=https://<admin>/api/content` does the same for `contentApi.js`. Public routes are unauthenticated, read-only, CORS-restricted to the storefront origin, and cached with `revalidateTag`.

| Method | Path | Mirrors |
|---|---|---|
| GET | `/api/products` | `getAllProducts()` — array of the product shape below |
| GET | `/api/products/:idOrSlug` | `getProductById` (accepts id today, slug after cutover) |
| GET | `/api/products?featured=true` | `getFeaturedProducts()` — **no default limit**, matching today |
| GET | `/api/products?bestSeller=true&limit=8` | `getBestSellerProducts` — `orderCount desc` |
| GET | `/api/products?newArrival=true&limit=8` | `getNewArrivalProducts` — `createdAt desc` |
| GET | `/api/products?search=&subcategory=&minPrice=&maxPrice=` | the remaining helpers |
| GET | `/api/products/:id/suggestions` | first 6 others |
| GET | `/api/categories` | `[{gender, name, filter, image, count}]`, fanned out per gender+subcategory with products |
| GET | `/api/content/reviews` | `[{id, name, location, text, rating}]`, `LIMIT 3` |

Public product payload — deliberately identical to `products.js` plus exactly three additions:

```
{ id, slug, title, gender, category: "bags", subcategory, price,        // whole ₹ int
  description, isOnSale, salePrice, discountPercentage, orderCount,
  rating, reviewCount, numReviews,            // ADDED: alias, see quirk #1
  createdAt: "2026-08-14", isFeatured,
  thumbnail,                                  // ADDED: optional card image
  variants: [ { id, name, colorHex, images: [...] } ] }  // ADDED: id, colorHex
```

Never serialised publicly: `costPrice`, `stock`, `sku`, `tags`, `metaTitle`, `metaDescription`, `status`, `archivedAt`, `moderationNote`, audit rows.

**Admin surface** — Server Actions for every mutation (`createProductDraft`, `updateProduct`, `publishProduct`, `archiveProduct`, `deleteProduct`, `bulkProductOp`, `upsertCategory`, `reorderCategories`, `deleteCategoryWithReassign`, `upsertTestimonial`, `reorderTestimonials`), each re-checking the ADMIN session and writing `AuditLog`. Route handlers exist only where a Server Action cannot serve: `GET /api/admin/products/slug-available`, `GET /api/admin/products/facets`, `GET /api/admin/products/export.csv`, `POST /api/admin/media/presign`. Lists and detail pages read Prisma directly from Server Components.

---

### 8. Scope register

| Item | Verdict | One-line reason |
|---|---|---|
| Rich-text description | **[LATER]** | PDP renders a plain string; storing HTML twice buys nothing today |
| SERP preview, `ogImage`, `canonicalPath` | **[LATER]** | SPA renders no per-route meta at all; the two meta columns are stored regardless |
| `SCHEDULED` status + publish cron | **[LATER]** | Nothing is publicly visible pre-cutover, so scheduling schedules nothing |
| Variant `priceOverride` | **[LATER]** | PDP prices from the product level; an override would silently not apply |
| Category `parentId` / tree widget | **[LATER]** | Five flat rows; a nullable column is a one-line migration |
| Product `badges` field | **Cut** | `ProductCard` takes its badge from the rendering section, not the product |
| Cross-page "select all matching" | **Cut** | The default page size holds the entire catalogue |
| IndexedDB autosave snapshots | **Cut** | Debounced sessionStorage gives the same crash safety with no new dependency |
| Import wizard + dry run | **[LATER]** | Seeding is a one-off script; revisit past ~200 SKUs |
| Review moderation queue UI | **[LATER]** | Unlocked by the storefront shipping a submit form; schema ships now |
| AVIF/WebP derivative pipeline | **[LATER]** | 39 products, `next/image` covers the admin, the storefront serves its own files |
| Public review replies | **Cut** | No PDP review section, no email provider, fake storefront auth |


**Decisions**

- FIX: Corrected the catalogue numbers the draft invented. Verified in products.js: 39 products (36 women / 3 men, all men's rows are wallets), price span is Rs.999-Rs.3,599 (the draft claimed Rs.999-Rs.12,000), 10 on sale, 16 featured, 5 live category tiles (the draft claimed 10 nodes). Every downstream design choice (price inputs, per-page default, category count columns) now follows the real data.
- FIX: The draft claimed variants have NO id at all. Verified false: the 7 tote products already carry variant ids shaped `tote-001-brown` (14 in total); the other 32 products have none. Seed now mints ids as `<productId>-<colorSlug>` and preserves the existing tote ids verbatim, rather than random cuids, so cart lines already sitting in a shopper's localStorage are not orphaned.
- FIX: Added the biggest missed defect. ProductDetails.jsx:115 computes `finalPrice = salePrice || price` and IGNORES isOnSale, so a leftover salePrice with isOnSale=false silently sells at the stale sale price while the card shows MRP. Escalated the invariant from a UI nicety to a DB check constraint, and added a `Clear sale` bulk action that writes all four pricing fields together.
- FIX: Killed the draft's dishonest claim that the testimonial cutover needs 'zero component changes'. CustomerReviews.jsx calls getReviews() synchronously and renders the result immediately; repointing homeApi at HTTP returns a Promise, reviews?.length is undefined, and the homepage section silently vanishes. Documented the real three-edit cutover (uncomment contentApi.js, set VITE_MOCKOON_API_BASE_URL, make the component await).
- FIX: Corrected the colour-drift rationale. ShopPage DOES `.trim()` variant names, so the draft's `'black '` example is wrong; the real drift is case-sensitivity plus synonyms. Replaced the invented palette (Maroon, Olive, Navy, White) with the palette actually present in the data (Black, Brown, Tan, Beige, Pink, Gold, Coffee) and used the real Coffee-vs-Brown collision as the justification.
- FIX: Corrected the featured threshold. The draft warned above 8 for a 'fixed grid'; FeaturedProducts.jsx actually slices each section to 4, and 16 products are flagged featured today, so 12 never appear. Warning is now 'N featured, homepage renders the first 4', plus a low warning below 4.
- FIX: Added two verified storefront routing defects the draft missed and the admin cannot fix: ShopPage handles only filter=new-arrivals|best-sellers|sale, so FeaturedProducts' `View All -> /shop?filter=featured` lands on an unfiltered shop; and ShopPage never reads ?gender= although CategorySection links with it, so per-gender tiles of the same subcategory resolve to identical lists. Both logged as post-cutover storefront tasks and surfaced as info notes so they are not filed as admin bugs.
- FIX: Added the seed constraint the draft skipped: ShopPage's New Arrivals filter is a 30-day createdAt window, so the seed must preserve the original createdAt strings; stamping import date would make all 39 products new arrivals. Added `created_at` to the CSV contract with that note.
- FIX: Added the media-origin problem entirely absent from the draft. Existing images are storefront-relative paths under the Vite public/ dir, so they 404 inside an admin panel on a different domain. Committed to storing them verbatim, rendering them in the admin via NEXT_PUBLIC_STOREFRONT_ORIGIN + next.config remotePatterns, and emitting a mix of relative and absolute URLs (both valid to the only consumer).
- FIX: Cut the Tiptap rich-text editor to [LATER] and committed to a plain Textarea. The draft itself admitted the storefront renders description as a plain string, then stored the field twice anyway - dead complexity for zero visible benefit.
- FIX: Cut the SERP preview, ogImageId and canonicalPath. Verified there is no per-route title or meta anywhere in src/ and index.html carries one static <title>, so these are unrenderable even post-cutover. Kept two nullable meta columns so no authored text is lost.
- FIX: Cut SCHEDULED status and the Vercel Cron, reducing status to DRAFT|PUBLISHED|ARCHIVED. Nothing is publicly visible before cutover, so scheduling schedules nothing. Kept the read-time enforcement rule documented for when it lands.
- FIX: Cut variant priceOverride (the PDP prices only from the product level, so an override would silently never apply), Category.parentId (five flat rows), and the product `badges` field (ProductCard takes its badge from the rendering section via a prop, not from the product).
- FIX: Cut the cross-page 'select all 63 matching' escalation strip - the draft's own numbers were invented (63 rows, 25 per page) and with per=50 the entire 39-row catalogue is one page. Set the default page size to 50 accordingly.
- FIX: Replaced the IndexedDB autosave snapshot with a debounced sessionStorage snapshot - identical crash safety, no new dependency, no keying by userId for a single-admin panel.
- FIX: Demoted the full ProductReview moderation queue (state-machine UI, bulk actions, j/k and a/r shortcuts) to [LATER], keeping only the Prisma model and one placeholder page naming the blocker. The draft built months of unusable screen for a queue that no storefront form can populate.
- FIX: Replaced the draft's `Import from storefront seed` empty-state button with a link to the seed runbook - the script reads a file in the storefront repo that does not exist on the deployed admin, so the button could never work in production.
- FIX: Replaced the nightly purge cron for empty drafts with a lazy purge on product-list load - one fewer moving part at this scale.
- FIX: Added the access-control and data-flow paragraph the draft omitted entirely, reconciling the section with the blueprint direction: middleware plus per-action ADMIN session checks, Server Components reading Prisma directly, mutations as Server Actions, and route handlers only for the public API, client-polled helpers, export and presigning.
- FIX: Added a consolidated API contract section the draft lacked, and corrected the endpoint mounting. Public routes are mounted at /api/products, /api/categories and /api/content/reviews so that setting VITE_API_BASE_URL and VITE_MOCKOON_API_BASE_URL makes the already-written commented-out axios calls resolve verbatim - the draft's /api/admin-flavoured paths would have forced extra storefront edits.
- FIX: Added a 20-row 'verified storefront quirks' table with the source behaviour and its schema consequence, replacing the draft's scattered and partly wrong asides, including the numReviews alias, the CustomerReviews LIMIT (the component maps every row into a 3-column grid with no slice) and the need to emit `id` in the testimonial feed (the component keys on review.id || review.name).
- FIX: Corrected the public featured/bestseller/new-arrival limits - getFeaturedProducts has no default limit while the other two default to 8; the public API must match or section contents shift at cutover.
- FIX: Replaced every invented number in the draft's UI copy (142 valid / 6 invalid, reassign 12 products, all 25 of 63) with real or generic placeholders.
- FIX: Cut Testimonial.productId (the homepage renders no product link) and added a scope register table making every cut, deferral and its one-line reason auditable.

**Open assumptions**

- The public read API is mounted at /api on the admin's own domain and the storefront cutover is done by setting VITE_API_BASE_URL and VITE_MOCKOON_API_BASE_URL plus uncommenting productApi.js/contentApi.js - confirm the admin domain will be CORS-allowed to serve the storefront origin.
- Bags have exactly one option axis (colour). /size-guide is an informational page, not a variant dimension, so no size or option matrix is built.
- Prices stay whole rupees (every price in products.js is an integer). The DB stores minor units; the UI and the public API round to whole rupees.
- The colour palette is seeded from the seven names actually in the data (Black, Brown, Tan, Beige, Pink, Gold, Coffee). Confirm whether Coffee should be merged into Brown at seed time, which would change one product's swatch.
- Low-stock threshold defaults to 3 units per variant - a guess suited to small-batch handbags; confirm with the merchandiser.
- orderCount, rating and reviewCount stay hand-seeded until real orders and reviews exist, and the client accepts manually authored interim social proof (16 products currently claim ratings from no reviews).
- The three legacy homepage testimonials are genuine enough to migrate and keep publishing rather than delete, and someone will backfill their star ratings (they currently display as 5 stars regardless).
- The cutover will let the PDP resolve by id or slug; until then slug is stored and kept unique but is dead data, since the storefront routes /product/:id via getProductById.
- Legacy product images stay in the storefront's public/ folder and are referenced by relative path; only newly uploaded images go to object storage. Confirm this rather than a full migration of the existing JPEGs.
- Uploads go to the same S3-compatible bucket the rest of the blueprint uses, via presigned PUT; this section mandates slugified keys, not a provider.
- The seed script may read e-commerce_frontend-main/src/data/products.js read-only; reading that folder is not a modification.
- Only one ADMIN account uses these screens, so there are no per-user saved views, no record locking and no approval workflow.

**Risks**

- The post-cutover fix list is now non-trivial and lives in the forbidden folder: CustomerReviews.jsx must become async, ShopPage must read ?gender= and handle filter=featured, and the hardcoded 'Verified Customer' label must become conditional. If the user expects the cutover to be a pure env-var flip, that expectation is wrong and should be corrected before build starts.
- Quirk #2 (PDP prices from salePrice regardless of isOnSale) is a live mispricing risk the moment the API goes live. The DB check constraint protects new writes, but the seed must also normalise the 29 non-sale rows; verify none of them carries a stray salePrice.
- Variant id minting is a one-way door. Once shoppers' localStorage carts contain a variantId, changing the id format orphans those lines. The `<productId>-<colorSlug>` format must be frozen before the first public API response.
- Category identity is subcategory-scoped while products carry a separate `category: "bags"` string that is constant across all 39 rows. If a non-bag line (scarves, belts) ever appears, that constant becomes a real second axis and the Category entity needs revisiting.
- Stock, SKU, cost price and tags are being captured with no consumer and no verification path. Data entered against an unused schema tends to be wrong by the time something reads it; the Low Stock view is the only thing exercising stock, and it exercises it weakly.
- Storing metaTitle/metaDescription that literally cannot render invites a later 'why is our SEO not working' conversation. The inline 'stored, not yet displayed' hints mitigate but do not remove this.
- The seed is a one-way import from a file that stays editable. If anyone edits products.js after the seed runs, the two catalogues silently diverge with no reconciliation path; the runbook must state that products.js is frozen at seed time.
- 39 products in a single unpaginated page makes bulk actions cheap and safe today, but there is no tested behaviour at 500 rows. The keyset-pagination swap is documented, not exercised.
- The audit log is the sole accountability mechanism with two roles and no approvals; if it is not written inside the same transaction as the mutation, a partially failed bulk op leaves an audit trail that disagrees with the data.
- ProductReview ships as schema only. If the storefront review form is never built, that model is dead weight and the product rating fields stay permanently hand-edited - worth an explicit decision date rather than an open-ended [LATER].

---

## Order Management and Customer Management UX

### 0. The honest starting position

There is no order backend and no customer backend. Every claim below was re-verified by reading the storefront.

| Fact | Evidence (file:line) |
|---|---|
| Orders live only in the buyer's browser | `OrderPage.jsx:163-167` writes `localStorage["niyaOrders"]`; `MyOrders.jsx:75-97` reads it |
| The order API file does not exist | `OrderPage.jsx:20` `// import { createOrder } from "../api/orderApi";` — `src/api/orderApi.js` is **absent** |
| The call site is commented out | `OrderPage.jsx:144` `// await createOrder(orderPayload);` |
| One status value exists | `OrderPage.jsx:159` `status: "ORDER PLACED"` — a display string, not an enum |
| `date` is not a timestamp | `new Date().toLocaleString("en-IN")` — unsortable, unparseable without a bespoke parser |
| Orders carry no user link | payload has `shippingDetails` only; no `userId`, no `customerId` |
| Email is optional at checkout | `OrderPage.jsx:95-101` requires `fullName, phone, address, city, pinCode` |
| **`state` is also optional** | it is **not** in that required list, yet it is written into `shippingDetails` |
| Money model | `subtotal`; `shippingFee = subtotal >= 2000 \|\| subtotal === 0 ? 0 : 100`; `totalAmount`. **No discount field, no tax field** |
| **Sale prices are not charged** | `CartPage.jsx:130-139` and `OrderPage.jsx:75-79` sum `item.price` / `product.price`; `salePrice` is read only in `ProductDetails.jsx:115` for display |
| Variants have no ids | `CartContext.jsx:103` `variantId: selectedVariant?.id ?? null` → always `null` for local products; the dedupe key collapses to `productId` |
| Line items do snapshot the variant | `OrderPage.jsx:129` sends `selectedVariant` — the whole `{name, images[]}` object |
| Customers are fake and device-local | `authApi.js` = `localStorage["niyaUsers"]` (plaintext `password`), login keyed on **email**; signup collects name, email, phone, password |
| Cart/wishlist are device-local | `niya_cart`, `niyaWishlist` — the server has never seen them |
| The half-built cart API is variant-blind | `cartApi.js` `DELETE /remove/:productId` — no variant in the path; and its base URL is a placeholder with no verified server behind it |

**Two corrections to earlier drafts of this blueprint.** (1) There is **no 7-day return window anywhere in this codebase**. `footerData.js:227-231` states only that "eligible products may be exchanged according to our exchange terms" — an *exchange* policy with no stated window and no refund promise. Any return-window countdown must be a setting the owner fills in, defaulting to *off*. (2) `niyaOrders` and `niyaUsers` sit in **each shopper's own browser**. They are not a dataset anyone can export. The only copies reachable are the ones on the owner's own machine. So there is no "customer import" to build, and the order import is a paste-JSON escape hatch for the owner's own test/manual orders, nothing more.

So: **Orders and Customers in the admin are the system of record from day one, not a mirror of anything.** Day-one inputs are manual order entry (Instagram DM / WhatsApp / phone, which is the brand's actual channel) and, optionally, one paste of the owner's local `niyaOrders` blob.

**Money is integer paise** (`totalPaise: 299900`), never floats. Ingest does `Math.round(rupees * 100)`. Display uses `Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" })` with 0 fraction digits when the paise remainder is 0 and 2 when it is not — refunds can be partial rupees even though every storefront total is whole. All timestamps are stored UTC and rendered IST.

---

### 0.1 The cutover, stated precisely (this is where earlier drafts were sloppy)

The blueprint's general claim is that the storefront cutover is confined to `src/api/*.js`. **For orders that is false, and pretending otherwise would burn a day later.** `OrderPage.jsx` itself mints `NIYA-${Date.now()}`, stamps the locale-string date, sets `status: "ORDER PLACED"`, and writes localStorage. `MyOrders.jsx` reads localStorage directly.

The admin API is therefore designed so the storefront cutover stays as close to mechanical as possible:

| Cutover step | File | Nature |
|---|---|---|
| Add `createOrder(payload)` | new `src/api/orderApi.js` | pure addition, mechanical |
| Uncomment one line | `OrderPage.jsx:144` | one-line change **outside** `src/api/` |
| Read orders from the server | `MyOrders.jsx` | a real page change — requires customer auth first |

To keep step 2 to one line, `POST /api/public/orders` **accepts the storefront's own client-generated id** as `clientOrderRef` (unique-if-present) and an `Idempotency-Key` header, and returns the canonical `orderNumber` in the response. The storefront may ignore that response entirely and keep showing its own `NIYA-...` string; the admin resolves the two. Step 3 is a separate, later project, gated on customer auth existing server-side. **None of this happens now. Zero files in `e-commerce_frontend-main/` are touched by this section.**

---

### 1. Folder slice

```
admin_panel/src/
  app/
    (dashboard)/
      orders/page.tsx                    # list; all state in the URL
      orders/new/page.tsx                # manual / phone / DM order entry
      orders/import/page.tsx             # [LATER-lite] paste niyaOrders JSON
      orders/[orderId]/page.tsx          # detail
      orders/[orderId]/documents/route.ts# GET ?doc=packing-slip|invoice -> application/pdf
      customers/page.tsx
      customers/[customerId]/page.tsx
    api/
      admin/orders/counts/route.ts       # one grouped-count aggregate
      public/orders/route.ts             # POST: storefront ingest (post-cutover), API-key + idempotency
  features/orders/
    components/  OrderTable OrderStatusTabs OrderFilterBar OrderOmnibox
                 BulkActionBar StatusTransitionMenu OrderTimeline
                 TimelineComposer MoneySummary RefundRecordDialog
                 LinkCustomerDialog OrderEditDialog
    lib/         transitions.ts        # the single shared table (client renders, server enforces)
                 omnibox-parse.ts  ingest-map.ts  money.ts
    schemas/     order.ts              # zod: ingest payload, edit forms, filter params
    server/      queries.ts  actions.ts   # "use server"
  features/customers/
    components/  CustomerTable CustomerProfileCard AddressList
                 CustomerOrderHistory CustomerStats PiiRevealButton
                 CustomerMergeBanner
  lib/audit/log.ts   lib/pii/mask.ts
```

Libraries, and why each earns its place at this size: `@tanstack/react-table` v8 headless inside shadcn `Table` (column visibility, selection, no styling opinions), `nuqs` (URL-synced filters), `react-hook-form` + `zod` (one schema shared by form and server action), `date-fns` (IST formatting and the one nasty locale-string parser), `@react-pdf/renderer`, `sonner`. **Not added:** a charting lib (dashboard section owns that), a state manager (server components + URL), a table virtualiser (50-row pages), a websocket layer.

---

### (a) Order list — `/orders`

Filter state lives entirely in the URL via `nuqs`: `?status=SHIPPED&payment=PENDING&from=2026-08-01&q=98765`. Not cosmetic — the operator pastes "the RTO queue" link into their own notes or a WhatsApp message to a helper, and browser Back must not lose a filter set.

| Column | Field | Notes |
|---|---|---|
| ☐ | — | shadcn `Checkbox`, drives the bulk bar |
| Order | `orderNumber` | monospace; click = detail; shows a small link icon if `clientOrderRef` differs |
| Date | `placedAt` (ISO, UTC) | `dd MMM, HH:mm` IST; `title` = full IST; a `~` prefix when `placedAtApproximate` |
| Customer | `customer.name` | second line: phone as `98•••••210` + copy-full button |
| Items | `itemCount` | `HoverCard` shows snapshot thumbnails from `selectedVariant.images[0]` |
| Total | `totalPaise` | right-aligned, `tabular-nums` |
| Payment | `paymentMethod` + `paymentStatus` | `COD · Pending` / `ONLINE · Pending` / `COD · Paid` |
| Status | `fulfilmentStatus` | `Badge`, coloured by group (§c) |
| Age in status | derived from `statusChangedAt` | "3d in PACKED" — the single most actionable column for a COD store; amber past 2d, red past 5d |
| ⋯ | — | `DropdownMenu` |

`statusChangedAt` is an explicit column on `Order`, written by every transition. Without it the Age column is a lie.

**Status tabs** (shadcn `Tabs`) with live counts: `All · New · Confirmed · Packed · Shipped · Delivered · Returns · Cancelled`. Tabs are coarse **groups**, not one tab per raw status — 10 statuses will not fit and `Returns` deliberately merges RTO and customer returns because they land in the same physical pile. Counts come from **one** `GET /api/admin/orders/counts` grouped-count query, not N list queries; the list shell is a Server Component, so mutations call `revalidatePath` / `router.refresh()` rather than holding a client cache.

**Filters:** status (multi), paymentStatus, paymentMethod (COD | ONLINE), date range (`Popover` + `Calendar`, presets Today / 7d / 30d / This month), amount range, tags, "has internal note", "source" (Storefront | Manual | Imported).

**Omnibox** — one `Command` input, not five fields. Parsed client-side, sent to the server as a typed hint the server re-validates:

| Input pattern | Interpreted as |
|---|---|
| starts `NIYA-` | exact `orderNumber` **or** `clientOrderRef` |
| 10 digits starting 6–9 | phone (exact on normalised E.164 + last-4 suffix) |
| 13 digits | epoch suffix of a storefront order ref |
| contains `@` | email |
| 6 digits | pin code |
| anything else | customer name / product title snapshot, `ILIKE %q%` |

Committed search implementation: plain `ILIKE` with a lowercased expression index on name and title snapshot. At a few thousand orders that is instant. **`pg_trgm` is [LATER]** — it needs raw SQL through Prisma and buys nothing at this volume.

**Sorting and paging:** default `placedAt` desc. Also `totalPaise` and age-in-status. Keyset pagination on `(sortKey, id)` tuples, 50 rows per page — offset paging drifts when a new order lands mid-browse. Sort key and cursor both live in the URL.

**Bulk actions** (sticky `BulkActionBar` at ≥1 selection, hard cap 100 rows per action): *Mark Confirmed*, *Mark Packed*, *Mark Shipped* (`Dialog` for one shared courier + per-row AWB), *Print packing slips*, *Export CSV*, *Add tag*. Every bulk transition runs the **same** `transitions.ts` validation per row inside one transaction per row (not one giant transaction — a single illegal row must not roll back 40 good ones). The result toast is a partial-success summary — "8 marked Shipped · 2 skipped: already Delivered" — with a link that re-filters the list to exactly the skipped ids. Never silently drop a row.

**Row quick actions:** View · Advance status (labelled with the next legal state) · Print packing slip · Copy address block · Copy WhatsApp update · Add note · Cancel.

**Responsive:** below `md` the table collapses to a card list (order number, customer, total, status, age). The owner will check orders from a phone; a horizontally scrolling 10-column table is not an answer.

**States:** empty (no orders yet → primary CTA "Create manual order" plus one line explaining the storefront is not yet connected), filtered-empty (with a "clear filters" action), loading (skeleton rows, not a spinner), error (inline retry, filters preserved).

---

### (b) Order detail — `/orders/[orderId]`

Grid `lg:grid-cols-[1fr_360px]`.

**Header:** `NIYA-1756392011432` with copy · placed 24 Aug 2026, 19:14 IST · fulfilment `Badge` · payment `Badge` · `COD` chip · source chip (Storefront / Manual / Imported) · tag chips. Right side: the primary button **is the next legal transition**, labelled as the action ("Mark Packed"); then a `DropdownMenu` of every other transition; then Documents.

**Left column**

1. **Line items** — 64px image from the snapshotted `selectedVariant.images[0]`, title, `variantName`, SKU *if the linked product has one* (the storefront product model has no SKU; the admin product model introduces it, so historic lines will show `—`), qty ×, unit price, line total. Every line stores its own snapshot (`titleSnapshot`, `variantName`, `unitPricePaise`, `imageUrlSnapshot`) so history survives catalogue edits. `variantId` is nullable and `variantName` is the durable value, because storefront variants have no ids. A `Tooltip` warning icon marks any line whose `productId` no longer resolves to a live product.
2. **Money summary** — Subtotal · Shipping · Discount · Tax · **Total**. Discount and Tax rows render only when non-zero; today's checkout sends neither and fabricating a ₹0 tax row implies a tax regime that does not exist. `compareAtPricePaise` is stored per line where known, so a sale saving stays visible historically. **Data-integrity note surfaced in the UI:** the storefront charges `price`, not `salePrice`, so an ingested line may exceed the product's current sale price. Ingest never "corrects" the amount — the customer was charged what they were charged — but flags `priceMismatch` and shows an info icon reading "Charged ₹X; catalogue sale price is ₹Y".

**Right column** (stacked `Card`s)

- **Customer** — name, link to `/customers/[id]`, phone (full, see PII rules), email or "no email on file", `ordersCount`, `lifetimeValue`, `firstOrderAt`. If the order is unlinked, this card is a **"Link to customer"** `Command` search instead.
- **Shipping address** — the `shippingDetails` block verbatim, with an **amber "state missing" flag** when `state` is empty, because state is optional at checkout and is required for a courier manifest and for any future GST place-of-supply logic. Actions: **Copy for courier** (a plain formatted text block for manual entry into Delhivery/Shiprocket — no integration is claimed or built) and **Open in Maps**.
- **Payment** — method, status, `amountPaidPaise`, manual reference field, "Record payment" action.
- **Tags** — free-form (`fragile`, `gift-wrap`, `repeat`, `rto-risk`), filterable from the list.

**Editing an order** (the draft had an `ORDER_EDITED` event but never said what was editable; committed scope):

| Field | Editable until | Effect |
|---|---|---|
| Shipping address, phone | `SHIPPED` | field-level diff in timeline |
| Line quantity / remove line | `PACKED` | totals recomputed; stock reservation adjusted |
| Add line | `PACKED` | manual-entry price required; no catalogue price is assumed |
| Shipping fee, discount | `SHIPPED` | reason required |
| Tags, internal notes | always | — |

Everything else is immutable. After `SHIPPED`, corrections happen as a refund/return record, not an edit.

**Concurrency:** `Order.version` increments on every write; a stale submit returns 409 and the UI shows "This order changed in another tab — reload to see it" rather than clobbering. Transitions are idempotent on `(orderId, fromStatus, toStatus)`.

#### Timeline

One **append-only** feed. Entries are never edited or deleted; an internal note can be *retracted*, which appends a retraction rather than removing text. Rendered as a left-rail vertical line with typed icons, day separators, **newest first, no auto-scroll** (an ops tool is read top-down; auto-scrolling to the bottom of a 40-entry feed is hostile).

| Type | Actor | Rendering |
|---|---|---|
| `ORDER_PLACED` | system | "Order placed via storefront · COD · ₹4,998" |
| `ORDER_IMPORTED` | admin | "Imported from niyaOrders JSON · date approximate" |
| `STATUS_CHANGED` | admin | "Priya changed **Packed → Shipped**" + courier / AWB chips |
| `PAYMENT_RECORDED` | admin | "₹4,998 recorded as paid · UPI · ref 4419…" |
| `REFUND_RECORDED` | admin | amber block: amount, method, reference |
| `NOTIFICATION_SENT` | admin | "WhatsApp update copied · shipped template" |
| `NOTE_ADDED` | admin | amber-tinted card, `Badge` "Internal" |
| `ORDER_EDITED` | admin | field-level diff |
| `CUSTOMER_LINKED` | admin/system | "Linked to customer #c_81f" |
| `DOCUMENT_ISSUED` | system | "Invoice NIYA/26-27/0117 issued" |

**Composer:** a `Textarea` with an explicit segmented control — **Internal note** (default, amber, never leaves the admin) vs **Message to customer** (which today only *stages* text and produces a `wa.me` deep link, §c). The distinction is colour + label, never a checkbox: the failure mode is sending "customer sounds like a fraud, hold this" to the customer. `@`-mentions are out of scope — there is one operator, at most two ADMIN accounts.

---

### (c) The state machine

Two independent axes. Collapsing fulfilment and payment into one enum makes "Delivered, but the courier has not remitted the COD cash" unrepresentable — and that gap is exactly where a small Indian D2C brand loses money.

**Fulfilment (10):** `PLACED · CONFIRMED · PACKED · SHIPPED · DELIVERED · RETURN_REQUESTED · RETURNED · RTO_IN_TRANSIT · RTO_RECEIVED · CANCELLED`

`OUT_FOR_DELIVERY` is **cut** and demoted to **[LATER]**: it is only meaningful when a courier webhook sets it, and there is no courier integration. A status only a human can set, that changes nothing, will simply rot. `RTO_*` stays — undelivered COD parcels returning to origin is the dominant operational reality here, and without those states an RTO gets mis-filed as `CANCELLED` and stock is restored at the wrong moment.

**Payment (5):** `PENDING · PAID · PARTIALLY_REFUNDED · REFUNDED · VOID`

| From | To | Irreversible | Side effects |
|---|---|---|---|
| PLACED | CONFIRMED | no | timeline, audit |
| PLACED / CONFIRMED / PACKED | CANCELLED | **yes** | release reservation; payment → VOID if never PAID; reason required |
| CONFIRMED | PACKED | no | timeline |
| PACKED | SHIPPED | **yes** | reservation → sold (`onHand` decrement commits); courier + AWB required; invoice number allocated if not already; WhatsApp update offered |
| SHIPPED | DELIVERED | **yes** | if COD: prompt "record ₹X collected"; starts the return window **only if one is configured** |
| SHIPPED | RTO_IN_TRANSIT | **yes** | timeline, audit |
| RTO_IN_TRANSIT | RTO_RECEIVED | **yes** | **restock** `onHand`; payment → VOID if COD never collected |
| DELIVERED | RETURN_REQUESTED | no | reason required |
| RETURN_REQUESTED | RETURNED | **yes** | **restock** after condition check; refund becomes due if payment was PAID |
| RETURN_REQUESTED | DELIVERED | no | request rejected or withdrawn; reason required |

**Return window.** There is no 7-day rule in this codebase — the only policy text is a vague exchange clause in the footer. `settings.returnWindowDays` therefore defaults to **null**, and the DELIVERED card shows no countdown until the owner sets a number. `DELIVERED → RETURN_REQUESTED` is always allowed regardless; the window drives a badge, never a hard block, because the owner will always override for a good customer. Same treatment for the free-shipping threshold, which *is* real in code (`>= ₹2000`) and is mirrored as `settings.freeShippingThresholdPaise = 200000` for manual order entry — but the storefront keeps its own hardcoded copy until the cutover, so **the settings screen must say "affects admin-created orders only, until the storefront is connected."** Anything else is the dishonesty this blueprint exists to avoid.

**Stock model.** Products have no stock field today; the admin product model introduces `onHand` and `reserved` (`available = onHand − reserved`). Reserve at `PLACED`, commit the decrement at `SHIPPED`, restock at `RTO_RECEIVED` / `RETURNED`, release on `CANCELLED`. Reserving at `PLACED` prevents two buyers taking the last piece of a one-off bag; committing only at `SHIPPED` means fake COD orders never corrupt real counts. Because reservations on never-confirmed COD orders would silently leak inventory, the list ships a saved view **"Unconfirmed > 72h"** — a filter, not a cron job. Honest caveat: **before the cutover, reservations only ever come from admin-entered orders**, since the storefront never calls the API.

**Every transition is one server action inside one DB transaction:** status write → `statusChangedAt` → stock movement row → timeline event → audit row (→ invoice number allocation where applicable). Partial application is what produces phantom stock.

**Illegal transitions are shown, disabled, and explained** — never hidden. A hidden action teaches the operator that the app is unreliable; a disabled item with a `Tooltip` reading *"Cannot cancel a shipped order — mark it RTO instead"* teaches the model. Irreversible transitions additionally require an `AlertDialog` naming the consequence ("Stock will be permanently decremented"). Client and server render from the same `transitions.ts`; the server never trusts the client.

**Cancel / return / refund with COD and no gateway — stated plainly.** There is no payment gateway anywhere in this codebase; `ONLINE` is a radio button with nothing behind it, so **`ONLINE` orders ingest as `paymentStatus: PENDING`** exactly like COD, until an admin records a UPI/bank reference. Therefore:

- Cancelling a never-collected COD order refunds nothing: payment `PENDING → VOID`, UI reads "No refund due (COD, never collected)".
- An RTO on a never-collected COD order likewise refunds nothing.
- Only a **delivered, cash-collected** order that comes back can owe money. That refund is **a bookkeeping record, not an API call**: `RefundRecordDialog` captures `amountPaise` (defaulting to the full total, editable down for partials), `method` (UPI | Bank transfer | Cash), `reference` (UTR / UPI txn id, free text), `reason`, `refundedAt`, `refundedBy`. Saving appends `REFUND_RECORDED` and moves payment to `PARTIALLY_REFUNDED` or `REFUNDED`. The dialog says, in body copy: *"This records a refund you have already paid out. It does not move any money."* Anything else is a lie rendered in a UI.

**Notifications.** No email provider exists in the ground truth. Do not draw a "customer notified" checkmark that nothing backs. The honest version: transitions to `SHIPPED` and `DELIVERED`, plus a manual button on any order, render **Copy WhatsApp update** — a prefilled `wa.me/91<phone>?text=…` deep link built from a small set of stored templates (shipped / delivered / delayed) with order number, status and AWB interpolated — and log `NOTIFICATION_SENT` with `channel: "whatsapp_manual"`. Templates are editable in settings. When transactional email arrives (recommend `resend` + `react-email`), the same event type absorbs it as `channel: "email"` and no UI changes.

---

### (d) Documents: three of them, deliberately

| | Storefront `OrderReceipt.jsx` | Admin **packing slip** | Admin **invoice** |
|---|---|---|---|
| Audience | customer, post-checkout + My Orders | picker/packer, box insert | seller record, accounting |
| Generation | `window.open` + copied stylesheets, browser print (`OrderReceipt.jsx:11-111`) | server-rendered PDF | server-rendered PDF |
| Numbering | reuses `orderId` | **none** | fiscal-year series `NIYA/26-27/0117` |
| Availability | after checkout | any status | from `SHIPPED`, or on explicit "Generate invoice" |
| Mutability | renders whatever order object it is handed | live | **frozen at issue** |

`OrderReceipt` already works and is not ours to change or replace.

Earlier drafts contained a real contradiction: invoice numbers allocated at `SHIPPED`, yet a bulk "Print invoices" action offered on any selection — which would either mint numbers for unshipped orders or print unnumbered "invoices". **Resolved by splitting the document:** the *packing slip* is unnumbered and printable at any status (that is the one that goes in the box at packing time); the *invoice* is numbered and is allocated lazily at the first of {the `SHIPPED` transition, an explicit "Generate invoice" click}, inside that same transaction. Cancelled orders never consume a number, and gaps in a fiscal-year series are an audit problem.

Both are `GET /orders/[orderId]/documents?doc=…` Route Handlers streaming `application/pdf`, built with **`@react-pdf/renderer`** — chosen over Puppeteer/Chromium because it runs in a Vercel serverless function without a ~200MB browser binary, and over client-side jsPDF because invoice numbers must be allocated server-side. Bulk printing merges N documents into one PDF in list order. Order numbers are epoch-millisecond strings and non-sequential by construction, so they can never double as invoice numbers.

**GST:** the ground truth contains no GSTIN, no HSN codes, no tax field. Do not fabricate tax lines. Build the invoice template with an optional seller block (`GSTIN`, per-line `hsnCode`, CGST/SGST/IGST split) that is **off by default** behind `settings.taxInvoiceEnabled`. Note the trap discovered above: the intra/inter-state split needs the ship-to **state**, and `state` is optional at checkout, so enabling the tax block must also enable a "state required" validation on order edit and manual entry — and will leave historic orders needing a manual state fill. Flag those orders in the list when the flag is turned on.

---

### (e) Customers

#### List — `/customers`

| Column | Source |
|---|---|
| Name | `name` + initials avatar |
| Email | `email` or "—" (nullable: checkout does not require it) |
| Phone | **masked** `98•••••210` |
| Orders | `ordersCount` |
| Lifetime value | `lifetimeValuePaise` |
| AOV | `ltv / paidOrdersCount` |
| Last order | relative + tooltip |
| Type / status | `Guest` / `Registered` · `Active` / `Disabled` |
| Joined | `createdAt`, or "first ordered" for guests |

**LTV is committed to one definition:** the sum of `totalPaise` for orders whose `paymentStatus` is `PAID` or `PARTIALLY_REFUNDED`, **minus** recorded refunds. It excludes `PENDING` (an unshipped COD order is not revenue), `VOID`, cancellations and RTOs. Earlier drafts said "delivered + shipped only", which counts money that may never arrive — for a COD store with real RTO rates that overstates the top customers, which is the exact number this list exists to rank.

Filters: type, status, orders-count range, LTV range, last-order date range, city/state, tags. Search: name, email, phone, order number. **Default sort: LTV desc** — at ~40 SKUs and low volume, the top 20 customers *are* the business.

LTV / AOV / `ordersCount` are **derived**, computed in a single grouped join over orders — never a per-row query. Recomputing on read is correct at this volume; a materialised counter would drift on every refund and is not worth it yet.

#### Detail — `/customers/[customerId]`

Tabs: **Overview · Orders · Addresses · Activity**.

- **Overview** — name, email, phone, gender, dateOfBirth, avatar (exactly the fields `EditProfile.jsx` collects, and nothing invented beyond them), account status, joined date, tags, internal notes. Stat tiles: orders, LTV, AOV, first order, last order, cancellations, returns, **RTO count** — the one number that should change how the operator treats the next COD order from this person.
- **Orders** — the order table component, pre-filtered, same badges.
- **Addresses** — the profile carries **one flat address** (`address, city, state, pincode`), not an address book. Show that single profile address plus the distinct `shippingDetails` blocks harvested from past orders, deduped and labelled "used in 3 orders". A real address book is a later schema change; do not pretend one exists.
- **Activity** — only events the admin API actually produces: customer created, merged/linked, tag added, note added, disabled/enabled, PII revealed. **No "password reset requested"** — there is no server-side password flow for customers until the storefront auth cutover, and listing an event that can never fire is the same class of lie as a fake "notified" checkmark.

#### Cart and wishlist — where the line is

**Stated bluntly: `niya_cart` and `niyaWishlist` are localStorage on the customer's device. The server has never seen them and cannot see them.** Any admin UI for them is impossible until they are server-persisted, which means `cart`/`wishlist` tables *plus* a storefront cutover of `CartContext` and `WishlistContext` — and note that the existing `cartApi.js` cannot be reused as-is: `DELETE /remove/:productId` has no variant in the path, so a variant-aware server cart needs a different contract. Until then, render an explicit empty state — *"Cart and wishlist are stored on the customer's device and are not visible to the admin"* — never a fake empty list.

Once persisted, the judgement (all of this is **[LATER]**, gated on that work):

| Surface | Verdict | Reason |
|---|---|---|
| Aggregate "most wishlisted products" | Show | merchandising signal, no individual exposed |
| Wishlist count on a customer | Show | one number, low intrusion, useful on a call |
| Wishlist items on the detail page only | Show | needed on a support call; keep it off the list view |
| Live cart contents, read-only, with `updatedAt` | Show | answers "I added a bag and it vanished" |
| Editing a customer's cart from admin | **Do not build** | mutating someone's session without consent; place a manual order instead |
| Abandoned-cart outreach | **Do not build** | needs consent plus a channel, neither exists; not the operating model of a 40-SKU brand |

#### PII rules

1. **Passwords are never read, stored, displayed or exported.** The `niyaUsers` array holds plaintext passwords but lives on shoppers' own devices, so there is no import path to harden — and if a JSON blob is ever pasted in by hand, the parser drops `password` before anything is written, and flags the account `requiresPasswordSetup`. There is no "view password" and no admin-set-password affordance, ever.
2. **Masking rule, committed:** phone and email are masked in **every list and every export**. They are shown in full on the **order detail** and **customer detail**. The order detail is unmasked and *not* audited, because dispatching every single parcel requires the number — auditing it would write one row per order and drown the log. The customer module's `PiiRevealButton` unmasks for the session and **does** write an audit row, because there is no operational reason to sweep the customer database.
3. **Audit-logging — argued and committed.** Logging every page view at one or two operators produces a log nobody reads and, worse, an audit table so noisy that the one row that matters is invisible. Logging nothing leaves an unanswerable question if the customer list leaks. **Commit: do not log ordinary detail-page views. Do log (a) PII reveals in the customer module, (b) every CSV export with its row count and the exact filter that produced it, (c) every mutation, (d) account enable/disable, (e) customer merges, (f) invoice-number allocation.** Exports are the actual exfiltration path; a screenshot of one customer is not.
4. **Exports are masked by default.** "Include full contact details" is a checkbox requiring a typed confirmation, and that choice is recorded in the audit row.
5. **Delete vs disable.** **Disable** (blocks login post-cutover, preserves orders) is the normal action. Hard delete destroys financial records, so it exists only as "Erase personal data": nulls name/email/phone/address on the customer row, replaces order `shippingDetails` with a tombstone, and keeps line items and totals for accounting. Two-step `AlertDialog` with typed confirmation.
6. **Disabling never cancels in-flight orders.** They are separate decisions; coupling them will surprise the operator at exactly the wrong moment.

---

### (f) Guest vs registered identity

The checkout payload has **no `userId`** and email is **optional**, so email cannot be the identity key for orders. Phone is the only always-present, always-required field — and for an India-focused COD store, phone *is* identity in practice. (Note the asymmetry: the storefront's fake *login* is keyed on **email**, and signup collects name, email, phone, password. So `User` keeps a unique email; `Customer` keeps a unique phone. They are not the same key and must not be conflated.)

**Three entities, exactly two roles.**

```ts
User      { id, email (unique), role: "ADMIN" | "USER", ... }   // Auth.js; today only ADMIN rows exist
Customer  { id, phoneE164 (unique, required), email (nullable),
            name, userId (nullable, unique), isGuest: boolean,
            status: "ACTIVE" | "DISABLED",
            firstOrderAt, lastOrderAt, tags[], internalNotes[] }
Order     { id, orderNumber (unique), clientOrderRef (unique, nullable),
            customerId (required), userId (nullable),
            source: "STOREFRONT" | "MANUAL" | "IMPORTED",
            fulfilmentStatus, paymentStatus, statusChangedAt, version, ... }
```

`USER` rows only start existing after the storefront auth cutover; until then every `Customer` is a guest or a manually created record, and `Order.userId` is always null. No third role is introduced anywhere — merges, links and disables are all ADMIN actions.

**Resolution on ingest, in order:**

| Step | Rule |
|---|---|
| 1 | Payload carries a session `userId` (post-cutover only) → link directly, `isGuest = false` |
| 2 | Else match on normalised `phoneE164` → link to that customer, still `isGuest` if no user |
| 3 | Else match on lowercased email, if present |
| 4 | Else create a new `Customer` with `isGuest: true` |

Phone normalisation is committed: strip spaces/dashes, strip a leading `0`, strip `+91`/`91` when the remainder is 10 digits starting 6–9, store as `+91XXXXXXXXXX`. Anything that fails to normalise is stored raw and the customer is flagged `phoneUnverifiedFormat` rather than silently matched — bad merges are far more expensive than a duplicate row.

Guest orders are therefore **never orphaned**: they hang off a guest customer keyed by phone, so a repeat guest buyer accrues real order history and LTV without registering. That is the common case for this store and the design serves it first.

**Claiming and merging.** The storefront has **no phone OTP and no phone verification of any kind**, so a phone match must never auto-merge a stranger's order history into an account. A match surfaces as `CustomerMergeBanner` — *"3 guest orders share this phone number — Link / Dismiss"* — on the customer detail. Linking attaches `userId`, sets `isGuest = false`, keeps all orders, appends `CUSTOMER_LINKED` to every affected order, and is audit-logged. A merge is **not reversible by design**, so it is an `AlertDialog` naming the order count being moved. Dismissals are remembered so the banner does not nag.

**Manual linking** on the order detail ("Link to customer" → `Command` search) is the escape hatch for WhatsApp and phone orders — the brand's real day-one channel.

---

### (g) Ingest contract, manual entry, and the one-time import

**`POST /api/public/orders`** — the endpoint the storefront will call after cutover, built now, callable now by nothing. Server API key + `Idempotency-Key` header (retries on a flaky mobile connection must not double an order). Body is the storefront's existing payload verbatim, so no storefront-side reshaping is needed:

| Incoming | Stored as |
|---|---|
| `shippingDetails.*` | `shippingSnapshot` (state may be empty → flagged) |
| `items[].productId` | `productId` (resolved against catalogue; unresolved is allowed, flagged) |
| `items[].variantId` (always null) | `variantId` null; `variantName` from `selectedVariant.name` |
| `items[].selectedVariant.images[0]` | `imageUrlSnapshot` |
| `items[].price` (rupees) | `unitPricePaise = Math.round(price * 100)`; `priceMismatch` flag vs catalogue |
| `subtotal / shippingFee / totalAmount` | `subtotalPaise / shippingPaise / totalPaise`; server **re-derives** and rejects a mismatch |
| `paymentMethod` | `paymentMethod`; `paymentStatus = PENDING` for both COD and ONLINE |
| `orderId` (`NIYA-<epoch>`) | `clientOrderRef` |
| `date` (locale string) | ignored; server stamps `placedAt` in UTC |
| — | `fulfilmentStatus = PLACED`, `source = STOREFRONT` |

**Manual order entry — `/orders/new`.** One form: customer (search existing by phone, or create inline with name + phone, email optional), line items (product search from the admin catalogue, variant by name, quantity, unit price prefilled from the catalogue but **editable**, because DM haggling is real), shipping address, shipping fee prefilled from the threshold setting, payment method, optional "already paid" with reference, internal note. Saves at `PLACED` with `source: MANUAL` and a `NIYA-M-<seq>` order number so manual and storefront orders are distinguishable at a glance.

**The `niyaOrders` import — scoped down and made honest.** This can only ever import a blob the owner pastes from their own browser; other people's orders are unreachable. It is therefore a small paste-JSON page, not an "import pipeline": paste → parse → preview table with per-row validity → import. Dedupe on `clientOrderRef`. The `date` field is a `toLocaleString("en-IN")` string; the importer attempts one explicit `dd/mm/yyyy, hh:mm:ss am/pm` parse and, on failure, sets `placedAt` to the import time with `placedAtApproximate: true` — which the list renders with a `~`. Every imported order lands at `PLACED` with `source: IMPORTED` and an `ORDER_IMPORTED` timeline entry. **If the owner has no real orders on their machine, drop this page entirely** — it is one screen, not a foundation.

---

### (h) Cross-cutting

| Concern | Commitment |
|---|---|
| Access | The whole `(dashboard)` group is `ADMIN`-only, enforced in middleware **and** re-checked in every server action; `USER` sessions get 404, not 403 (do not confirm the admin exists) |
| Data fetching | Server Components for list/detail shells and all reads; server actions for every mutation; no client fetching library |
| Timezone | Store UTC, render IST everywhere, label it once in the header |
| Empty / loading / error | Every list and tab specifies all four states; skeletons over spinners; errors preserve filters and offer retry |
| Accessibility | Every status badge carries text, not colour alone; the bulk bar is keyboard-reachable; destructive dialogs focus the cancel action; the omnibox is a `Command` with full keyboard nav |
| Density | One "compact rows" toggle persisted per admin; no configurable column builder |
| Not built | courier/tracking integration, SLA timers, saved-segment builder, per-admin assignment or queues, order-level chat, customer messaging inbox, abandoned-cart flows, loyalty, per-field permissions — none fit one operator and ~40 SKUs |


**Decisions**

- FIX: Deleted the hallucinated '7-day return window read from OrderPage.jsx'. Grep of the repo shows no return window anywhere; footerData.js:227-231 has only a vague *exchange* clause with no days. Replaced with settings.returnWindowDays defaulting to null (no countdown UI until the owner sets one).
- FIX: Corrected the cutover story, which the draft (and the blueprint direction) claimed was confined to src/api/*.js. OrderPage.jsx itself mints NIYA-${Date.now()}, the locale date, the status string and the localStorage write; MyOrders.jsx reads localStorage. Added an explicit 3-row cutover table and designed the ingest endpoint to accept clientOrderRef + Idempotency-Key so step 2 stays a one-line uncomment.
- FIX: Removed the 'one-time niyaOrders JSON import' and 'niyaUsers password-dropping import path' as if they were real datasets. Both live in each shopper's own browser and are unreachable. Rescoped to a single paste-JSON page for the owner's own device, explicitly droppable, and rewrote the password rule to a defensive parser guard rather than an import feature.
- FIX: Caught that `state` is NOT in OrderPage.jsx's required-field list (line 95-101) while the draft's GST section derived the CGST/SGST/IGST split from ship-to state. Added an amber 'state missing' flag on the address card and a rule that enabling the tax block also enables state validation and flags historic orders.
- FIX: Resolved a real internal contradiction: invoice numbers allocated at SHIPPED vs a bulk 'Print invoices' action on any selection. Split into an unnumbered packing slip (any status, goes in the box) and a numbered invoice (allocated at first of SHIPPED / explicit Generate).
- FIX: Cut OUT_FOR_DELIVERY from the state machine (11 -> 10 states) and demoted it to [LATER]; it is only meaningful from a courier webhook, and no courier integration exists, so a hand-set status that changes nothing would rot.
- FIX: Redefined LTV. The draft counted 'delivered + shipped', which books COD money that may never arrive in a market with real RTO rates. Committed to sum(totalPaise) where paymentStatus is PAID or PARTIALLY_REFUNDED, minus recorded refunds.
- FIX: Added the missing statusChangedAt column. The draft's 'Age in status' column had no field behind it.
- FIX: Generalised keyset pagination from '(placedAt, id)' to '(sortKey, id)' tuples, since the draft also offered sorting by total and by age-in-status, which the stated cursor cannot express.
- FIX: Demoted 'trigram' search to [LATER] and committed to lowercased-expression-index ILIKE. pg_trgm needs raw SQL through Prisma and buys nothing at this volume.
- FIX: Removed 'SKU' as a plain line-item column; storefront products have no SKU field. It now renders as em-dash for historic lines and is fed by the admin product model going forward.
- FIX: Removed the invented 'password reset requested' event from the customer Activity tab; no server-side customer password flow exists until the auth cutover. Activity now lists only events the admin API actually emits.
- FIX: Replaced the draft's reasoning-from-'two admins' (an assumption, not ground truth, and inconsistent with a one-person store) with 'one operator, at most two ADMIN accounts', and rebuilt the audit-noise argument so it does not depend solely on head count.
- FIX: Made the PII masking rule non-contradictory and specific: masked in every list and export; unmasked and unaudited on order detail (dispatch needs it on every order, auditing it would drown the log); unmasked and audited via PiiRevealButton in the customer module. Added masked-by-default CSV export with a typed-confirmation opt-in that is itself audited.
- FIX: Added a committed order-edit scope table. The draft emitted an ORDER_EDITED timeline event but never said what was editable or until when.
- FIX: Added optimistic-concurrency handling (Order.version, 409 + reload toast) and transition idempotency on (orderId, fromStatus, toStatus) - absent from the draft despite a two-operator, multi-tab workflow.
- FIX: Changed bulk transitions from one shared transaction to one transaction per row, so a single illegal row cannot roll back 40 valid ones; added a 100-row cap.
- FIX: Flipped the timeline to newest-first with no auto-scroll; the draft's 'newest last, auto-scrolled to bottom' is hostile in an ops tool.
- FIX: Corrected the claim that 'the server-side cart is half-built already'. cartApi.js points at a placeholder base URL with no verified server, and DELETE /remove/:productId has no variant segment, so it cannot back a variant-aware cart. The [LATER] cart/wishlist work now says a new contract is needed.
- FIX: Documented a genuine money bug found in the repo: CartPage.jsx:130-139 and OrderPage.jsx:75-79 charge item.price, never salePrice (which is read only for display in ProductDetails.jsx:115). Ingest now stores the charged amount verbatim and raises a priceMismatch flag instead of silently 'correcting' it.
- FIX: Made ONLINE explicitly ingest as paymentStatus PENDING alongside COD, since no gateway exists - the draft implied 'ONLINE - Paid' as a normal list value.
- FIX: Specified phone normalisation to +91 E.164 with an explicit failure flag, rather than the draft's undefined 'normalised phoneE164'; bad merges cost more than duplicate rows.
- FIX: Clarified the identity asymmetry the draft missed: storefront login is keyed on email (authApi.js) while orders are keyed on phone. User keeps a unique email, Customer a unique phone; they are separate keys.
- FIX: Added the full ingest field-mapping table (rupees -> paise via Math.round, locale date discarded, server re-derives totals and rejects mismatches, unresolved productId allowed but flagged) - the draft asserted 'the ingest adapter multiplies by 100' and stopped there.
- FIX: Added missing cross-cutting commitments the brief demanded: ADMIN-only middleware plus per-action re-check with 404 (not 403), empty/loading/error states for every surface, responsive card layout below md, accessibility rules, IST/UTC handling, and an explicit 'not built' list.
- FIX: Added a 'Unconfirmed > 72h' saved filter to stop stock reservations leaking on abandoned COD orders, and stated plainly that pre-cutover reservations can only come from admin-entered orders.
- FIX: Added the settings-honesty rule: the free-shipping threshold setting affects admin-created orders only until the storefront is repointed, and the settings screen must say so.
- FIX: Added NIYA-M-<seq> numbering for manual orders so DM/WhatsApp orders are distinguishable from storefront orders at a glance.
- FIX: Tightened money display - 0 fraction digits for whole rupees, 2 when a paise remainder exists, since partial refunds can be non-integral even though every storefront total is whole.

**Open assumptions**

- Return/exchange policy: the repo states no window and promises exchange, not refund. Confirm the real policy (days, refund vs exchange only, who pays return shipping) before returnWindowDays is switched on.
- The store is operated by one person, with at most a second ADMIN login later. No per-admin scoping, assignment queues, or timeline @-mentions are designed for.
- 'ONLINE' orders stay paymentStatus PENDING until an admin records a UPI/bank reference, because the storefront collects no payment. Confirm no gateway is coming in this phase.
- The brand is not currently issuing GST tax invoices from this system; the GSTIN/HSN block is built but defaults off. Confirm GST registration status - if registered, the ship-to state field must become mandatory before go-live.
- Manual order entry is genuinely wanted, because Instagram DM and WhatsApp are the real day-one channel. If all orders will come from the storefront post-cutover, /orders/new can shrink to an edge-case tool.
- The niyaOrders paste-import is worth one screen only if the owner has real orders in their own browser. If not, drop it entirely.
- Product variants will get stable ids in the admin product model; until then order lines store variantName as the durable value and variantId stays null.
- Free shipping at >= Rs 2000 and the Rs 100 flat fee (read from OrderPage.jsx:82) are the actual current policy and should be settings, not constants - but they stay duplicated in the storefront until cutover.
- The admin ships its own backend (Next.js Route Handlers + Postgres/Prisma); no external order or customer service exists to consume.
- WhatsApp update templates are acceptable as manual copy-paste for now, with transactional email (resend + react-email) deferred until a provider and a sender domain exist.

**Risks**

- Nothing in this module affects a single shopper until the storefront cutover. If the owner expects orders to start appearing in the admin on launch day, that expectation must be corrected in writing before build, not after.
- The orders cutover is NOT confined to src/api/*.js: OrderPage.jsx mints the id/date/status and writes localStorage, and MyOrders.jsx reads it. Two files outside src/api must eventually change, and the 'zero storefront changes' constraint has to be lifted for that step.
- Phone-keyed identity with no OTP anywhere means a wrong or shared number silently merges two people's order histories. The admin-suggested (never automatic) merge reduces but does not eliminate this; merges are irreversible by design.
- The storefront charges list price, not salePrice. Once real orders flow in, discounted items will be overcharged and the admin will only be able to flag, not fix, it. This is a storefront bug that will surface as customer complaints and refunds.
- Reserve-at-PLACED leaks stock on abandoned COD orders. The 'Unconfirmed > 72h' saved filter is a manual mitigation; if order volume grows, this needs a scheduled release job.
- Invoice numbering is a monotonic per-fiscal-year sequence. Serverless concurrency plus retries can produce gaps or duplicates unless allocation stays inside the same transaction as the status write and uses a DB sequence or SELECT ... FOR UPDATE. Getting this wrong is an audit problem, not a UI bug.
- Fiscal-year rollover (1 April) must reset the invoice series. If nobody remembers, year 26-27 numbers keep being minted in year 27-28.
- @react-pdf/renderer must produce a valid Rs glyph and Devanagari-safe fallbacks; the default fonts do not embed the rupee sign reliably. A font must be bundled and the PDF checked on a real invoice before this is called done.
- Refunds are honour-system bookkeeping with a free-text UTR. Nothing reconciles the recorded refund against a bank statement, so a mistyped or fabricated entry is undetectable inside this system.
- COD cash remitted by the courier is not modelled at all. paymentStatus PAID at DELIVERED means 'the customer handed over cash', not 'the money reached the seller's account'. If courier remittance becomes a real reconciliation problem, a third axis (or a remittance record) will be needed.
- Cart and wishlist admin views are blocked on server persistence plus a new variant-aware cart contract; the existing cartApi.js cannot be reused as-is. Do not promise these in a launch scope.
- Derived LTV/AOV recomputed on read is fine at a few thousand orders and will become the slowest query on the customers list first. Watch it before adding any dashboard that also aggregates orders.
- The niyaUsers array holds plaintext passwords on shoppers' devices. Nothing this admin does can fix that; it is only resolved when storefront auth is repointed at a real password-hashing backend, and that risk stays live until then.

---

## CMS Architecture — Homepage Sections, Static Pages, Media, Reels, Footer

### 1. The honest starting position

**Nothing in this module reaches the live storefront on day one, and one env var will not change that.**

Verified: `src/api/homeApi.js` imports seven objects from `src/data/homeData.js` and returns them. `src/api/footerApi.js` imports from `src/data/footerData.js`. `src/api/contentApi.js` is 100% commented out — including a `getNotFoundBags` that duplicates the live one in `notFoundApi.js`. So `export * from "./contentApi"` in `src/api/api.js` currently exports **nothing**.

The admin CMS is therefore built **standalone**: it owns a content database and publishes a public read API. The storefront keeps rendering its static files. Cutover is a later, separate change confined to `src/api/*.js` plus a short, *enumerated* list of component fixes (§14) — not hand-waved.

#### 1.1 What makes cutover cheap

`axiosClient.js` defines `contentApi` with `baseURL = import.meta.env.VITE_MOCKOON_API_BASE_URL || "http://localhost:3001"` — **the bare origin, no `/api` suffix** — and the commented-out functions call `/hero-banners`, `/promo-banners`, `/announcements`, `/campaign`, `/reels`, `/craftsmanship`, `/reviews`, `/not-found-bags` against it.

> **D-1 — the public read API mirrors those eight paths verbatim**, mounted at `https://admin.niyabags.com/api/public`. Setting `VITE_MOCKOON_API_BASE_URL` to that value makes `notFoundApi.js` hit us with **zero file edits** (it already does real HTTP), and makes `contentApi.js` work by uncommenting a file that is already written. We fit the client that exists rather than inventing a REST shape and forcing the storefront to adapt.

Also verified: `contentApi` is created **without `withCredentials`**. The public API therefore needs only a plain origin allowlist and no credentialed-CORS complexity.

#### 1.2 What makes cutover *not* free — four verified landmines this design must own

**(a) The env var is shared with auth.** `axiosClient.js` builds `authApi` as `` `${mockoonBaseURL}/api/auth` `` from the *same* variable. Repointing `VITE_MOCKOON_API_BASE_URL` today is safe only because `authApi.js` is 100% localStorage and never touches that axios instance. The day auth goes to HTTP, the two collide. **Cutover must split the variable** (introduce `VITE_CONTENT_API_BASE_URL`, one line in `axiosClient.js`) — see C-1b. Anyone who claims "cutover is a single env var" has not read `axiosClient.js`.

**(b) Two consumers call their API function *synchronously*.** This is the biggest trap in the whole module:
- `BrandCraftsmanship.jsx` line 5: `const data = getCraftsmanship();` — no state, no `await`.
- `CustomerReviews.jsx` line 5: `const reviews = getReviews();` — no state, no `await`.

Both work today because `homeApi.getCraftsmanship` / `getReviews` are plain (non-`async`) functions returning objects. The moment they return a Promise, `data.eyebrow` is `undefined` (craftsmanship silently renders an empty section) and `reviews?.length` is `undefined` (**the reviews section disappears entirely**). Converting these two components to `useState` + `useEffect` is a mandatory cutover item (C-6), not optional polish. Every other consumer (`AnnouncementBar`, `HeroBanner`, `PromoBanner`, `CampaignSpotlight`, `ReelsSection`, `Footer`, all seven footer pages, `NotFoundPage`) already `await`s and is Promise-safe.

**(c) Several fields we let admins edit are not rendered today.** Editing them changes nothing until a storefront edit. The registry marks each one `INERT` and the form shows a muted "not yet used by the live site" hint. Enumerated in §4.

**(d) `footerApi.js` has no commented axios version.** It must be written at cutover (~15 lines, two functions). Flag it; do not pretend it exists.

#### 1.3 Verified consumer inventory

| Storefront reader | Import path | Reads today | Public endpoint we ship | Promise-safe? | Cutover cost |
|---|---|---|---|---|---|
| `common/AnnouncementBar.jsx` | `api/homeApi` | `announcementsData` | `GET /announcements` | yes | uncomment `contentApi.js`, repoint `homeApi.js` |
| `home/HeroBanner.jsx` | `api/homeApi` | `heroBannersData` | `GET /hero-banners` | yes | same |
| `home/PromoBanner.jsx` | `api/homeApi` | `promoBannersData` | `GET /promo-banners` | yes | same |
| `home/CampaignSpotlight.jsx` | `api/homeApi` | `campaignData` | `GET /campaign` | yes | same |
| `home/ReelsSection.jsx` | `api/homeApi` | `reelsData` | `GET /reels` | yes | same |
| `home/BrandCraftsmanship.jsx` | `api/homeApi` | `craftsmanshipData` | `GET /craftsmanship` | **NO — sync call** | same **+ convert to async** (C-6) |
| `home/CustomerReviews.jsx` | `api/homeApi` | `reviewsData` | `GET /reviews` | **NO — sync call** | same **+ convert to async** (C-6) |
| `pages/NotFoundPage.jsx` | `api/notFoundApi` | live HTTP already | `GET /not-found-bags` | yes | **env var only** |
| `common/Footer.jsx` | `api/footerApi` | `footerData` | `GET /footer` | yes | write `footerApi.js` axios version |
| 7 routed pages in `src/pages/footer/` | `api/footerApi` | `footerPagesData[slug]` | `GET /pages/:slug` | yes | same file |
| `home/CategorySection.jsx` | `api/api` (barrel) | `getCategories()` over products | — (product module owns it) | yes | none in this module |
| `home/FeaturedProducts.jsx` | product helpers | 3 hardcoded rails | — | yes | none in this module |
| `home/TrustBadges.jsx` | **none** | **hardcoded in component** | `GET /trust-badges` (ships unconsumed) | n/a | component rewrite (C-8) |
| Newsletter block in `pages/HomePage.jsx` | **none** | **hardcoded in the page** | `GET /home` payload | n/a | component rewrite (C-9) |
| `pages/footer/FooterPage.jsx` | `api/api` (barrel) | — | — | — | **dead file, unrouted** — see below |

**Correction to a claim worth stating precisely:** there are eight files under `src/pages/footer/`, but only **seven** are routed and call `getFooterPage`. The eighth, `FooterPage.jsx`, is a generic slug-driven renderer that imports `getFooterPage` from `../../api/api` — the barrel, which does **not** re-export `footerApi`. It would resolve to `undefined` and hang on "Loading…" forever. It is unrouted dead code, so this is a latent bug, not a live one. Do not treat it as a consumer, and do not delete it (we touch nothing). Fixing the barrel is a cosmetic cutover nicety (C-5), not a requirement, because every live consumer imports `api/homeApi` and `api/footerApi` **directly**.

---

### 2. Storage model: one polymorphic table, typed payloads, no migration per section type

```txt
cms_section
  id                cuid
  page_key          enum  HOME | SHOP | WISHLIST | SALE | NOT_FOUND    (HOME is all v1 needs)
  type              text  registry key, e.g. "brand_craftsmanship"
  position          int   dense 0..n within page_key
  enabled           bool
  publish_at        timestamptz null
  unpublish_at      timestamptz null
  draft_payload     jsonb            -- always writable
  published_payload jsonb null       -- what /api/public reads; null = never published
  published_at      timestamptz null
  updated_at        timestamptz      -- optimistic-concurrency token
  updated_by        userId
  @@unique([page_key, position])     -- deferred within the reorder transaction
```

Payload is **JSONB validated by a Zod discriminated union on `type`**, not by columns. A new section type is a registry file plus a form component — no `ALTER TABLE`, no Prisma migration, no downtime. Postgres validates nothing about the payload; Zod does, on every write *and* on every read out of the DB. A `safeParse` guard on read means a payload written by an older registry version degrades to a "needs re-save" card in the builder instead of crashing it, and the public serializer falls back to the last valid `published_payload`.

Trade-off stated plainly: we give up SQL-level querying inside payloads. For ~12 homepage sections that is worth nothing, and the registry pattern is what makes the module extensible without a developer touching the schema.

---

### 3. What the storefront actually renders — the constraint table behind every payload

Every payload below was derived by reading the consuming component, not the data file. Fields marked **INERT** exist in the data but are never rendered today.

| Component | Verified rendering behaviour | Consequence for the CMS |
|---|---|---|
| `HeroBanner.jsx` | `slides[current].image` drives the carousel, but **`slides[0]` alone supplies the heading and subtitle** (`const heroText = slides[0]` — comment in the file says so). The CTA is a **hardcoded** `<Link to="/shop">EXPLORE THE COLLECTION →</Link>`. `title` is split on `\n` and rendered as separate lines. `alt` = `item.title.replace("\n", " ")`. | Slides 2..n: only the image renders. `buttonText` / `buttonLink` are **INERT** on every slide. The form must say "Heading and subtitle come from slide 1 only" and mark the CTA fields inert. Anything else is a lying UI. |
| `AnnouncementBar.jsx` | **Not a marquee.** Desktop: a 28px-tall `flex justify-around` rendering **all** items simultaneously. Mobile: a CSS carousel (`.announcement-carousel`) cycling them. | Hard cap of 5 items, soft-warn at 4, with a live character-budget meter. Six short items already crowd the desktop row; eight is a broken bar, not a fuller one. |
| `PromoBanner.jsx` | `data.find(item => item.page === page && item.position === position && item.isActive === true)`. Renders `banner.image`, `alt: banner.alt \|\| banner.title \|\| "Promo Banner"`. | A second active banner on the same `(page, position)` is **silently invisible**. Enforce uniqueness in the DB (D-9). Serializer must emit a flat `image` URL string. |
| `PromoBanner` mount point | `<PromoBanner page="home" position="after-hero" />` is rendered **inside `HeroBanner.jsx` (line 372)**, not from `HomePage.jsx`. | Promo banners are not draggable homepage cards. They live under **Placements** (§10). |
| `BrandCraftsmanship.jsx` | Reads `data.eyebrow`, `data.title` (`whitespace-pre-line`), `data.description?.map(...)` — an **array**, `data.stats`, `data.image`, `data.imageAlt \|\| data.title`, `data.buttonText` + `data.buttonLink`. | Public payload field is `description: string[]`, **not** `paragraphs`. Title newlines are load-bearing. |
| `CampaignSpotlight.jsx` | `campaign.image`, `alt = campaign.title`, `eyebrow`, `title` (`whitespace-pre-line`), `description` (a **single string**), `buttonText` + `buttonLink`. | Same newline rule. `description` is one string, not an array — do not unify it with craftsmanship. |
| `CustomerReviews.jsx` | Eyebrow **"THE NIYA EXPERIENCE"** and heading **"Loved by Women Everywhere"** are **hardcoded**. Per card it renders `review.rating \|\| 5` stars, `review.text`, `review.name`, and `` `${review.location} · Verified Customer` ``. Key is `review.id \|\| review.name`. | `rating` **is** consumed (defaulting to 5) — it is a real optional field, not an invention. Section-level `eyebrow`/`title` are **INERT**. The literal "Verified Customer" is hardcoded — we cannot mark a review unverified, so the form must not offer a "verified" toggle it cannot honour. |
| `ReelsSection.jsx` | `data.filter(reel => reel?.video)`. Hover autoplays muted; click opens a modal with a mute toggle. | Serializer must emit a `video` field for **both** upload and external sources, or the reel is dropped. |
| `NotFoundPage.jsx` | `setBags([...data, ...data])`, key `` `${bag.id}-${index}` ``, `src={bag.image}`. | Contract is `[{ id, image }]`. `alt` may be stored but is **not read** — an accessibility gap to fix at cutover, not a field to claim works. |
| `Footer.jsx` | `iconMap = { Instagram, Facebook, YouTube, Email }` only. `social.url`, `social.id`, `brand.name/description`, `customerService.heading/description/email`, `copyright`, `legalLinks`, `sections[].links[]`. | The platform enum is **exactly those four**. Offering WhatsApp/Pinterest/X would render an invisible link. Adding one is a storefront change. |

---

### 4. The section registry

`src/features/cms/registry/index.ts` exports `SECTION_REGISTRY: Record<SectionType, SectionDefinition>`, each `{ key, label, icon, description, schema, defaults, form, preview, constraint, serializer, inertFields }`.

| Key | Display name | Icon | Constraint | Payload (admin-side) | Inert today |
|---|---|---|---|---|---|
| `announcement_bar` | Announcement Bar | `Megaphone` | singleton; 1–5 items | `{ items: [{ id, text ≤60, isActive, startsAt?, endsAt? }] }` | `href` not offered — the component renders a `<span>`, not a link |
| `hero` | Hero Banner | `Images` | singleton; 1–5 slides | `{ slides: [{ id, mediaRef, alt, title, subtitle, buttonText, buttonLink }] }` | `buttonText`/`buttonLink` on all slides; `title`/`subtitle` on slides 2+ |
| `categories` | Category Grid | `LayoutGrid` | singleton | `{ }` — **no editable content** | whole section: derived from products, headings hardcoded |
| `featured_products` | Product Rails | `Sparkles` | singleton | `{ }` — **no editable content** | whole section: 3 rails with hardcoded eyebrows/titles |
| `trust_badges` | Trust Badges | `ShieldCheck` | singleton; 2–6 items | `{ items: [{ id, iconKey: box\|shield\|refresh\|help\|truck\|gift, title ≤24, text ≤32 }] }` | whole section until C-8 |
| `campaign_spotlight` | Campaign Spotlight | `Flame` | singleton | `{ eyebrow, title (\n kept), description: string, mediaRef, buttonText, buttonLink }` | — |
| `reels` | Reels | `Clapperboard` | singleton | `{ mode: all_active \| curated, reelIds?, limit }` | `heading` not offered — component has none |
| `brand_craftsmanship` | Craftsmanship | `Gem` | singleton | `{ eyebrow, title (\n kept), description: string[1..3], stats: [{value ≤6, label ≤30}] ×2–4, mediaRef, imageAlt, buttonText, buttonLink }` | — |
| `customer_reviews` | Customer Reviews | `Quote` | singleton; 2–6 items | `{ items: [{ id, name, location, text ≤240, rating: 1..5 default 5 }] }` | section `eyebrow`/`title` not offered |
| `promo_banner` | Promo Banner | `Image` | managed under **Placements**, unique per `(page, position)` while active | `{ page: home\|shop\|wishlist, position: after-hero\|after-products, mediaRef, title, alt, isActive, startsAt?, endsAt? }` | — |
| `newsletter_signup` | Newsletter | `Mail` | singleton | `{ eyebrow, title, description, placeholder, buttonText }` | whole section until C-9; **no subscriber storage exists** |

Three registry rules that come straight from the repo:

- **`categories` and `featured_products` carry no content at all.** `CategorySection.jsx` renders `getCategories()` (a computed facet over products, with its own women/men toggle) and `FeaturedProducts.jsx` builds three rails whose eyebrow/title pairs — "CURATED FOR YOU / Featured Pieces", "MOST LOVED / Best Sellers", "JUST IN / New Arrivals" — are hardcoded at lines 240–265. The draft's idea of a `source` selector and editable headings would be a form that does nothing. They appear in the builder as **locked presence-and-order rows** with a one-line explanation and a link to the product module. Honest beats impressive.
- **`customer_reviews` is editorial copy, not user-generated content.** No reviews API exists anywhere in the repo. This is marketing text the owner writes. **No moderation queue, no reply threads, no verification workflow** — there is no pipeline to moderate.
- **Multi-line titles are load-bearing.** `craftsmanshipData.title` is `"The Art of\nCraftsmanship"` and `campaignData.title` is `"Made for\nYour Moment"`; both render under `whitespace-pre-line`. Hero splits on `\n` manually. These fields are plain `Textarea`s that preserve `\n`, **never** rich text, with a "line breaks are preserved" hint and a live two-line render.

#### Registry entry sketch

```txt
brand_craftsmanship:
  key         "brand_craftsmanship"
  label       "Craftsmanship"          icon  Gem
  constraint  { kind: "singleton" }
  schema      eyebrow      string ≤40
              title        string ≤80          // \n preserved
              description  string[1..3], each ≤400
              stats        { value ≤6, label ≤30 }[2..4]
              mediaRef     MediaRef             // { assetId } | { externalUrl }
              imageAlt     string ≥4            // required, storefront passes it to <img alt>
              buttonText   string ≤30
              buttonLink   InternalPath         // validated against AppRoutes + CMS slugs
  form        CraftsmanshipForm        // react-hook-form + zodResolver
  preview     CraftsmanshipPreview     // approximate, admin-side
  serializer  -> { eyebrow, title, description[], stats[], image, imageAlt,
                   buttonText, buttonLink }     // exact homeData.js shape
```

Note `MediaRef → image` in the serializer. **The public payload never leaks internal ids** — it emits the flat, resolved URL strings the storefront already reads.

#### Adding a new section type later — five steps, no migration

1. `registry/<type>.ts` — schema + defaults + constraint.
2. Register in the union in `registry/index.ts`.
3. `forms/<type>-form.tsx` (shadcn `Form`/`Input`/`Textarea`/`Switch`/`MediaPicker`).
4. `preview/<type>-preview.tsx`.
5. A serializer entry, if it needs a legacy-compatible public endpoint.

---

### 5. Builder interactions

- **Reorder** — `@dnd-kit/core` + `@dnd-kit/sortable` (React 19 compatible; `react-beautiful-dnd` is unmaintained). Optimistic local reorder, then one `POST /api/admin/cms/sections/reorder` with the full ordered id array; dense integers rewritten inside a transaction with the unique constraint deferred. With ≤12 sections, fractional indexing buys nothing and costs rebalancing logic. Revisit above ~100 blocks on one page.
- **Enable / disable** — shadcn `Switch`; disabled cards stay in place, greyed, with a `Badge` "Hidden".
- **Duplicate** — deep-copies `draft_payload`, inserts at `position + 1`, forces `enabled = false`, and regenerates every nested item `id` (hero slides, review items, badge items) so React keys stay unique. Blocked by the API for singletons — which, given the table above, is nearly all of them, so this is a low-value affordance kept only because it is ~20 lines.
- **Scheduling** — `publish_at` / `unpublish_at` stored UTC, displayed `Asia/Kolkata` via shadcn `Popover` + `Calendar`. There is **no scheduler daemon**: visibility is evaluated at read time in the public API — `enabled AND (publish_at IS NULL OR publish_at <= now()) AND (unpublish_at IS NULL OR unpublish_at > now())`. Stated plainly: with `s-maxage=60` a scheduled item goes live up to ~60 s late. Fine for a handbag brand's Diwali banner. **The date picker is exposed only on announcements, promo banners and reels** (real INR sale windows). Whole-section scheduling shares the same columns and predicate at zero cost but its UI is **[LATER]** — one person editing 12 sections does not schedule a craftsmanship block.
- **Constraints** — enforced twice: the "Add section" `Command` palette hides types already at max, and the API re-checks (`409 SECTION_LIMIT`).
- **Concurrency** — every `PATCH` carries the row's `updated_at`; a mismatch returns `409 STALE_WRITE` with a "reload" prompt. One admin means this almost never fires, but "almost never" is the reason it must not be silent.

---

### 6. Preview — ranked honestly

**Next.js draft mode does not work here.** Draft mode sets a cookie read during a Next server render; the storefront is a Vite SPA on a different origin rendering from bundled JS. There is no Next render of the storefront to put into draft.

| # | Option | Fidelity | Storefront change? | Verdict |
|---|---|---|---|---|
| 1 | **In-admin approximate preview** — a preview component per registry type, styled with the storefront's CSS custom-property names, rendered in a width-constrained container at 390 / 768 / 1440 px | ~80%: order, copy, images, rough layout right; exact typography, marquee and animations not | **None** | **Ship for v1** |
| 2 | **iframe the real storefront + preview token** — storefront reads `?preview=<token>` and fetches drafts | 100% | **Yes** — `axiosClient.js` plus every content reader must honour a preview flag | Forbidden today. Post-cutover at best |
| 3 | **Staging deployment** — a second Vercel project of the storefront with the content base URL pointed at admin-staging | 100% | None beyond cutover | **The real answer, but only exists after cutover** |

> **D-2 — v1 ships option 1**, in a shadcn `Resizable` split pane (form left, preview right) with a persistent `Badge`: *"Approximate preview — final styling comes from the storefront."* An admin who trusts a lying preview publishes a broken hero.
>
> **Committed detail:** the preview renders into a **scoped container with a CSS reset and a `preview-tokens.css` copy of the storefront's custom properties** (`--color-accent`, `--color-dark-section`, `--color-text-muted`, `--color-bg-tertiary`, `--color-border`) — **not** an `iframe srcDoc`. `srcDoc` requires re-injecting the whole stylesheet on every keystroke and blocks style inheritance for no fidelity gain at 80%. One file to update if the storefront restyles.
>
> Post-cutover, option 3 becomes near-free and becomes primary; option 1 stays as the fast inline check.

---

### 7. Draft vs published, revisions, rollback

Three models were considered: (a) a single live payload, (b) draft + published payload on the same row, (c) immutable version entities with branches. (a) makes every save live — unacceptable for a hero image. (c) is Contentful-grade and unjustified for one person editing ~12 sections.

> **D-3 — (b) dual payload on the row, plus an append-only revision log.**

```txt
cms_revision
  id, entity_type ("section"|"page_block"|"page"|"footer"|"faq_item"|"reel"),
  entity_id, payload jsonb,   -- exactly what was published
  label text null,            -- e.g. "Diwali hero"
  batch_id text null,         -- groups one "Publish all"
  published_by, created_at
```

| Action | Behaviour |
|---|---|
| Save | writes `draft_payload` only; card shows `Badge` "Unpublished changes" (structural diff of draft vs published) |
| Publish section | `published_payload = draft_payload`, `published_at = now()`, append `cms_revision`, `revalidateTag` for the affected public routes |
| Publish all | one transaction over every dirty section on the page under a shared `batch_id`; the confirm `AlertDialog` lists what changes ("Hero: image + title", "Reviews: 1 item added") |
| Discard draft | `draft_payload = published_payload` |
| Rollback | pick a revision in a `Sheet` → copies its payload into `draft_payload` → normal publish flow. **Rollback never writes live silently**; it lands in draft so it can be previewed |
| Retention | keep the last 30 revisions per entity, prune older than 180 days (a nightly Vercel Cron; this is the module's only cron) |

**The public API reads `published_payload` only.** That single rule is what makes the draft workflow trustworthy, and it is why an admin can safely experiment before a launch.

---

### 8. Static pages

Verified in `footerData.js`: `footerPagesData` has **eight slugs** — `about`, `our-story`, `contact`, `shipping-returns`, `size-guide`, `faq`, `privacy-policy`, `terms-of-use` — consumed by **seven** routed components across **nine** routes.

**Route-to-slug mapping is not 1:1, and the CMS must model it correctly:**

| Route | Component | Slug it requests |
|---|---|---|
| `/about` | `AboutPage` | hardcoded `"about"` |
| `/our-story` | `OurStoryPage` | hardcoded `"our-story"` |
| `/contact` | `ContactPage` | hardcoded `"contact"` |
| `/shipping-returns` | `ShippingReturnsPage` | hardcoded `"shipping-returns"` |
| `/size-guide` | `SizeCarePage` | hardcoded `"size-guide"` |
| **`/care-guide`** | `SizeCarePage` | **also hardcoded `"size-guide"`** |
| `/faq` | `FAQPage` | hardcoded `"faq"` |
| `/privacy-policy` | `LegalPage` | derived from pathname → `"privacy-policy"` |
| `/terms-of-use` | `LegalPage` | derived from pathname → `"terms-of-use"` |

So **`care-guide` is a route, not a page** — it renders the size-guide document, which contains a `care-guide` anchor. The link validator must accept `/care-guide` as a route while refusing to let anyone create a `care-guide` CMS slug.

Six of the eight share the shape `{ slug, eyebrow, title, intro, sections: [{ id?, title, content }] }`. The real deviations: `about` adds `values[]`, `our-story` adds `quote`, `faq` replaces `sections` with `faqs[]`, `contact` has **no `sections`** and an **empty `contactDetails: []`**.

**One nuance the shape summary hides:** `our-story`'s `sections` entries have **no `id` field at all** (only `title` + `content`), while `about`, `shipping-returns`, `size-guide`, `privacy-policy` and `terms-of-use` do. `FooterPage`-style renderers key on `section.id || section.title || index`. So `anchorId` is **optional**, and generating one for `our-story` would be a new anchor, not a restoration.

Two strategies were on the table: **one rich-text blob per page** (simple, but destroys the `id` fields) versus **eight bespoke schemas** (accurate, eight forms, zero reuse, every new page an engineering ticket).

The blob loses on a concrete fact: **six live footer links deep-link into anchors** — `/shipping-returns#shipping`, `/shipping-returns#exchange`, `/size-guide#size-guide`, `/size-guide#care-guide`, `/privacy-policy#privacy-policy`, `/terms-of-use#terms-of-use`. Those come from `sections[].id`. A prose blob silently breaks all six.

> **D-4 — a `cms_page` record plus an ordered list of typed blocks** (`cms_page_block` mirrors `cms_section` column for column), reusing the same builder, drag-and-drop, revision and publish machinery. `anchorId` is a first-class **optional** field, slugified from the block title, editable, and **unique within a page** (Zod refinement + DB partial unique index). Deleting or renaming a block whose anchor is referenced by a footer link raises a blocking `AlertDialog` naming the link.

| Block type | Fields | Backs today's data |
|---|---|---|
| `anchored_section` | `anchorId?`, `title`, `body` (rich text) | `sections[]` on about, our-story, shipping-returns, size-guide, privacy-policy, terms-of-use |
| `value_grid` | `items: [{ id, title, content }]` 2–6 | `about.values` |
| `pull_quote` | `text` | `our-story.quote` (a plain string today — no attribution field exists; don't add one the page can't render) |
| `faq_embed` | `groupId \| all` | `faq.faqs` |
| `contact_details` | `items: [{ type: email\|phone\|instagram\|address, title, content, value?, url? }]` | `contact.contactDetails` — **empty today**, so nothing renders |
| `rich_text` | `body` | any |
| `image` | `mediaRef`, `alt`, `caption?` | any |
| `cta` | `text`, `href` | any |

**Correction worth calling out:** `ContactPage.jsx` reads `iconMap[detail.type]` and renders `detail.title`, `detail.content`, and a link from `detail.value` + `detail.url`, plus two `.find(item => item.type === "email" | "phone")` lookups in the sidebar. A generic `{ icon, label, value, href }` shape would render nothing. The block schema above matches what the component actually reads — including the fact that `type` is both the icon key and the sidebar lookup key, so it must be a **unique enum per page**.

Page-level fields: `slug`, `eyebrow`, `title`, `intro`, `status`, `isSystem` (blocks deleting a slug the router hardcodes — all eight are system), and `seo: { metaTitle, metaDescription }`. **SEO fields are marked INERT**: the storefront is a Vite SPA with no per-route head management and no SSR, so nothing consumes them until that changes. Store them; do not imply they work. `ogImageId` is **[LATER]** for the same reason.

**Public serialization preserves today's shape exactly**, so the seven page components render unchanged:

```txt
GET /api/public/pages/shipping-returns
{ slug, eyebrow, title, intro,
  sections: [ { id: "shipping", title: "Shipping", content: "<p>…</p>" }, … ],
  values:  [...],          // only when value_grid blocks exist (about)
  quote:   "…",            // only when a pull_quote exists (our-story)
  contactDetails: [...],   // only for contact
  faqs:    [...] }         // flattened from FAQ groups (faq)
```

`content` becomes sanitized HTML instead of a plain string. Today those components render `{section.content}` inside a `<p>`, which would display raw tags. Swapping to `dangerouslySetInnerHTML` is required in **six render sites**: `AboutPage` (sections + `values[].content`), `OurStoryPage`, `ShippingReturnsPage`, `SizeCarePage`, `LegalPage`, `FAQPage` (answers), plus `ContactPage` if contact details ever get prose. Cutover item **C-7**. Until then the API can emit plain text and everything renders correctly — the serializer takes a `format=text|html` decision at cutover time, defaulting to `text`.

---

### 9. Rich text

The corpus is short structured prose: two-to-four-sentence paragraphs, occasional bold, list or link. Nobody needs tables, embeds or collaborative cursors.

| Option | Verdict |
|---|---|
| Markdown (`react-markdown`) | Rejected — a non-technical brand owner should not type `**` and `[](…)`, and it adds no structure the block model lacks |
| Lexical | Rejected for v1 — excellent, but its React bindings are lower-level; more code for the same restricted toolbar |
| **Tiptap v3** (`@tiptap/react`, `starter-kit`, `extension-link`) | **Chosen** — headless (styling is ours, matches shadcn), schema is a hard allowlist, server-side HTML generation, mature React 19 support |

> **D-5 — Tiptap, with ProseMirror JSON as the source of truth and generated sanitized HTML as the delivery format.** Both persist: `body_json jsonb` + `body_html text`.
>
> JSON is authoritative: it is structured (a future "rewrite legacy image URLs" pass is a tree walk, not a regex over markup), round-trips into the editor losslessly, and cannot smuggle a `<script>`. HTML is stored alongside so the Vite storefront needs **zero** ProseMirror dependency and no renderer — it injects a string. Generating HTML per read would burn CPU on a cache-hit-heavy public API.

**Sanitization is a write-time chokepoint, not a read-time hope.** On `POST`/`PATCH`: (1) Zod validates the JSON tree against the allowlist `doc, paragraph, heading(2–3), text, bold, italic, bulletList, orderedList, listItem, link, hardBreak` — anything else is **rejected with a field error**, not silently stripped, so the admin learns what was disallowed; (2) `generateHTML()` from `@tiptap/html`; (3) `sanitize-html` with an explicit tag/attribute allowlist that drops every `style` and `on*` attribute and forces `rel="noopener noreferrer nofollow"` + `target="_blank"` on external `href`s. Only the sanitized output is stored.

On read the public API returns stored HTML as-is. **The storefront has no sanitizer and must never be asked to grow one.** The one place read-time sanitization runs is the migration importer (§12), because that content never passed through the editor. A CSP header on the admin (`script-src 'self'`) is defence in depth.

---

### 10. Media library

#### Storage decision

| Option | For this store | Against |
|---|---|---|
| Vercel Blob | Zero config, same platform | **No transforms, no responsive variants**; video is just bytes |
| S3 / Cloudflare R2 | Cheapest at scale, no egress on R2 | Needs a separate transform service — infrastructure this project does not want |
| UploadThing | Nice DX | Thin S3 wrapper, still no transforms, another vendor |
| **Cloudinary** | **Chosen** | Finite free tier; URL-syntax lock-in |

> **D-6 — Cloudinary behind a `MediaProvider` interface** (`upload`, `signUpload`, `destroy`, `url(publicId, transform)`) in `lib/media/provider.ts`, so R2 + ImageKit is a swap, not a rewrite.
>
> Three grounded reasons. **(1)** The storefront is a Vite SPA using plain `<img src>` with no `next/image` and no build-time image pipeline — and there never will be one without touching it. Responsive delivery therefore has to come from the URL, and `f_auto,q_auto,w_…` in the CDN path is the only way to get it with zero storefront change. For a luxury handbag brand where the photograph *is* the product, that is decisive. **(2)** Reels are video: Cloudinary transcodes, caps bitrate, and extracts a poster frame automatically; otherwise posters become a manual chore. **(3)** Vercel serverless request bodies cap at 4.5 MB, which a 15-second reel exceeds — signed direct-from-browser upload bypasses the Next route entirely. Volume is small: 47 of the 52 files in `public/` are content assets, plus a handful of CMS images and reels — comfortably inside the free tier.

#### Asset model and flow

```txt
media_asset
  id, provider ("cloudinary"|"external"), public_id null, folder,
  url, secure_url, format, bytes, width, height, duration null,
  sha256 (unique where not null), original_filename, legacy_path null,
  alt, title null, tags text[], resource_type (image|video|raw),
  uploaded_by, created_at, archived_at null
```

Upload: browser hashes the file (`crypto.subtle.digest('SHA-256')`) → `POST /api/admin/media/check-hash` → **on a hit, skip the upload entirely** and return the existing asset with a toast ("Already in your library") → on a miss, `POST /api/admin/media/sign` (server-signed, folder-scoped, size- and format-constrained) → direct browser upload to Cloudinary → `POST /api/admin/media` registers the row.

**Alt text is required before an asset can be referenced by a *published* section** — a Zod refinement on the section schema, not a nag banner. `BrandCraftsmanship`, `PromoBanner` and `HeroBanner` all pass `alt` straight into `<img>`, so an empty alt is a real defect on a public site. (Exception, stated honestly: `not-found-bags` renders no `alt` today, so alt there is stored for the future and enforced only as a warning.)

Organisation: one `folder` path (`hero/`, `promo/`, `campaign/`, `reels/`, `pages/`, `products/…`) plus free-form `tags[]`. **Search is a plain case-insensitive `ILIKE` over `original_filename` + `alt` and array-containment on `tags`** — at a few hundred rows, `pg_trgm` + GIN is ceremony. Add them if the library ever passes ~5k assets. Filters: type, folder, tag, unused-only, date. Grid is cursor-paginated 60 per page; **no virtualisation** at this scale.

**Reference tracking.** A `media_reference (asset_id, entity_type, entity_id, field_path)` table, rewritten by one `syncMediaRefs(entityType, entityId, payload)` call inside every content-save transaction — it walks the payload for `MediaRef` values, so no per-form bookkeeping and no way to forget.

> **D-7 — deleting a referenced asset is blocked, not warned.** The `AlertDialog` lists every usage with deep links ("Homepage → Hero → slide 2"). The only action available is **Archive** (`archived_at` set, hidden from the picker, URL still resolves so nothing 404s mid-publish). An "Unused assets" view plus a manual purge handles genuine cleanup. This matters more than usual here: the storefront caches nothing and has no fallback image — a dead URL is a visible hole on the homepage.

**Picker.** `<MediaPicker value onChange accept folder />` — a shadcn `Dialog` with `Tabs`: *Library* (grid, search, filters), *Upload* (dropzone), *By URL* (external reference). Returns `{ assetId | externalUrl, url, alt }`. One component serves hero slides, promo banners, campaign, craftsmanship, reel posters, page image blocks and product images. **The *By URL* tab is not optional**: current content already points at Unsplash (craftsmanship, campaign), Pexels (three reels) and slidesdocs.com (the shop promo banner). Forcing a re-host at import is needless migration risk. External refs are `provider: "external"` rows with no transforms and a "not managed" badge.

---

### 11. Reels, announcements, promo banners, trust badges

**Reels** are their own entity; the `reels` section only selects and orders them.

```txt
cms_reel
  id, source ("upload"|"external"),
  asset_id null | external_url null,
  poster_asset_id null, title, position int, is_active bool,
  publish_at null, unpublish_at null
```

> **D-8 — both sources stay first-class.** Current data mixes one local mp4 with three `pexels.com/download/video/…` hotlinks. Those URLs are fragile (redirects, no CORS or cache-header guarantees); the importer should re-host them, but `external` remains supported because forcing a re-host is not our call to make. **`ReelsSection.jsx` filters on `reel?.video`, so the serializer must emit a `video` field for either source** — an asset URL or the external URL — or the reel silently vanishes.
>
> `caption`, `cta_label` and `cta_href` are **not** modelled: `ReelsSection.jsx` renders `title` and a video, nothing else. Adding unconsumed columns invites an admin to write copy no one will ever see.

Video rules enforced client-side **before** upload (a shadcn `Alert` plus hard validation): H.264 MP4, `+faststart`, ≤15 s, ≤20 MB, 9:16 (1080×1920), audio track stripped — the storefront autoplays muted on hover — poster auto-extracted at ~1 s. **Never route video bytes through a Next route handler**: the 4.5 MB body cap and function timeout make that a guaranteed failure on serverless.

**Announcement bar** — today `{ id, text }`. Add `isActive`, `position`, `startsAt`/`endsAt` (genuinely useful for INR sale windows). **No `href`**: `AnnouncementBar.jsx` renders a `<span>`, not a link, so a URL field would be dead. Because the desktop bar shows **all** items at once in a 28px row (verified: `flex justify-around`, not a marquee), the form caps at 5 and shows a live combined-character meter with a warning past ~120 characters.

**Promo banners** — the existing `page` + `position` targeting is already the right model; **preserve it exactly**.

> **D-9 — a unique partial index on `(page, position) WHERE is_active`**, because `PromoBanner.jsx` uses `.find()` and a second active banner on the same tuple is **silently invisible**. The form says "This will replace the current *home / after-hero* banner" and swaps atomically.

Because `<PromoBanner page="home" position="after-hero" />` is rendered **inside `HeroBanner.jsx` (line 372)**, not from `HomePage.jsx`, banners are managed under **Placements**. The homepage builder shows them as a **locked ghost row pinned at their true render point** — directly beneath Hero — rather than a draggable card. A draggable promo banner would be a lie about what the storefront does.

The three known placements are `home/after-hero`, `shop/after-hero`, `wishlist/after-products`. Placements is a **fixed grid of those three slots**, each either filled or empty — not free-form creation, because only components that already exist can render one.

**Trust badges** — `TrustBadges.jsx` hardcodes four benefits **including React component references** (`FiBox`, `FiShield`, `FiRefreshCw`, `FiHelpCircle` from `react-icons/fi`) and repeats the array three times for a CSS marquee. Data cannot carry a component, so the data-driven version needs an `iconKey` string enum plus a `Record<string, IconType>` map **inside the storefront component**. **That is a storefront edit — cutover item C-8.** The admin ships the editor and `GET /trust-badges` now; it simply has no consumer until then, and the builder card says so.

**Newsletter** — identical story (hardcoded in `HomePage.jsx`, cutover C-9), with one extra piece of honesty: **there is no subscriber storage of any kind, and no email provider is integrated.** The form on the live site does nothing with a submitted address today. The CMS lets the owner edit the copy; a `Subscriber` entity and an ESP integration are **[LATER]** and out of this module's scope. The builder card states this in one line so nobody assumes signups are being captured.

---

### 12. Seeding and import — one-off, read-only against the storefront

Two scripts in `admin_panel/scripts/`, both of which **only read** `e-commerce_frontend-main/` and never write to it.

**`import-storefront-media.ts`** — 47 of the 52 files in `public/` contain spaces or parentheses (`WhatsApp Image 2026-08-17 at 5.37.34 PM (1).jpeg`); the other five (`favicon.svg`, `icons.svg`, `7580808.jpg`, `8269403.jpg`, `image.png`) are clean. Worse, references are **inconsistently encoded**: `heroBannersData` uses percent-encoded paths (`%20`, `%281%29`) while `reelsData` uses a raw space (`/products/bags/WhatsApp Video 2026-09-03 at 13.31.42.mp4`).

1. Walk `public/` read-only.
2. Slugify each filename → `whatsapp-image-2026-08-17-5-37-34-pm-1.jpeg`; upload to the matching Cloudinary folder with a deterministic `public_id`.
3. Record `sha256` and `legacy_path`, storing **both** the raw and the percent-decoded form as lookup keys.
4. Seed `alt` from surrounding data (`promoBannersData.alt`, `craftsmanshipData.imageAlt`); flag the rest as needing review.
5. Re-host the three Pexels reel URLs; keep `provider: "external"` rows as a fallback if a fetch fails.

**`seed-cms-content.ts`** — imports `homeData.js` and `footerData.js` into `cms_section`, `cms_page`, `cms_page_block`, `cms_reel` and the footer singleton, rewriting URL strings through the `legacy_path → asset` map (decoding `%20`/`%28` before lookup) and running every string through the read-time sanitizer, because this content never passed through the editor. It seeds `draft_payload` **and** `published_payload` identically, so the public API returns byte-comparable output to `homeData.js` from minute one.

**Acceptance gate for the whole module:** a diff script that fetches every public endpoint and compares it against the corresponding object in `homeData.js` / `footerData.js`. Until that diff is empty, cutover does not begin. Nothing in the storefront is deleted or moved; the originals keep serving the live site.

---

### 13. Folder tree

```txt
admin_panel/src/
  app/(admin)/
    content/
      homepage/page.tsx            # section builder
      pages/page.tsx
      pages/[slug]/page.tsx
      faq/page.tsx
      footer/page.tsx
      reels/page.tsx
      placements/page.tsx          # the 3 fixed promo slots
    media/page.tsx
  app/api/
    admin/cms/{sections,pages,faq,footer,reels,announcements,promo-banners}/…
    admin/media/{route.ts,sign,check-hash,[id],[id]/references}/…
    public/{hero-banners,promo-banners,announcements,campaign,reels,
            craftsmanship,reviews,not-found-bags,footer,faq,trust-badges,
            pages/[slug],home}/route.ts
  features/cms/
    registry/{index.ts,types.ts,hero.ts,announcement-bar.ts,…}
    components/{section-list.tsx,section-card.tsx,add-section-dialog.tsx,
                inert-field-hint.tsx,forms/*,preview/*,preview-shell.tsx}
    server/{section-service.ts,publish-service.ts,revision-service.ts,
            serializers/legacy.ts}     # the single source of public shapes
  features/{pages,faq,footer,reels,media}/…
  lib/{media/provider.ts,
       richtext/{schema.ts,to-html.ts,sanitize.ts},
       validation/{links.ts,routes.ts},   # routes.ts mirrors AppRoutes.jsx
       cache/tags.ts}
  scripts/{import-storefront-media.ts,seed-cms-content.ts,verify-parity.ts}
```

`serializers/legacy.ts` is deliberately one file. Every public response shape lives there, next to a comment naming the storefront component that consumes it. When someone later changes a payload, the compile error lands in the file that documents why the shape is frozen.

---

### 14. Endpoints

**Admin** — every route gated on `session.user.role === "ADMIN"` (the only two roles are ADMIN and USER), checked in middleware **and** re-checked in each handler, because middleware is not an authorization boundary for route handlers reachable by direct fetch.

| Method | Path |
|---|---|
| GET / POST | `/api/admin/cms/sections?pageKey=HOME` |
| PATCH / DELETE | `/api/admin/cms/sections/[id]` |
| POST | `/api/admin/cms/sections/[id]/{duplicate,publish,discard-draft}` |
| POST | `/api/admin/cms/sections/reorder` |
| POST | `/api/admin/cms/pages/[pageKey]/publish` (batch) |
| GET / POST | `/api/admin/cms/revisions?entityType=&entityId=` · `/revisions/[id]/restore` |
| GET/POST/PATCH/DELETE | `/api/admin/cms/static-pages[/slug]`, `…/blocks[/id]`, `…/blocks/reorder` |
| GET/POST/PATCH/DELETE | `/api/admin/cms/faq/groups[/id]`, `/faq/items[/id]`, `…/reorder` |
| GET / PUT | `/api/admin/cms/footer` |
| CRUD + reorder | `/api/admin/cms/reels`, `/announcements`, `/promo-banners` |
| POST | `/api/admin/media/sign`, `/api/admin/media/check-hash` |
| GET / POST | `/api/admin/media` — GET supports `q,folder,tag,type,unused,cursor` |
| PATCH / DELETE | `/api/admin/media/[id]` (DELETE = archive when referenced) |
| GET | `/api/admin/media/[id]/references` |

**Public** — unauthenticated `GET` only, CORS allowlisted to the storefront origins (no credentials needed — `contentApi` sets none), `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`, ETag, invalidated on publish via `revalidateTag`. Paths match `contentApi.js` verbatim (D-1).

| Endpoint | Response shape (frozen to match the consumer) |
|---|---|
| `/announcements` | `[{ id, text }]` |
| `/hero-banners` | `[{ id, image, title, subtitle, buttonText, buttonLink }]` |
| `/promo-banners` | `[{ id, page, position, image, title, alt, isActive }]` |
| `/campaign` | `{ eyebrow, title, description, image, buttonText, buttonLink }` |
| `/reels` | `[{ id, video, title, isActive }]` — `video` resolved from either source |
| `/craftsmanship` | `{ eyebrow, title, description: string[], stats: [{value,label}], image, imageAlt, buttonText, buttonLink }` |
| `/reviews` | `[{ id, name, location, text, rating }]` |
| `/not-found-bags` | `[{ id, image, alt }]` — `alt` unread today |
| `/footer` | `{ brand, socialLinks, sections, customerService, legalLinks, copyright }` |
| `/pages/[slug]` | the shape in §8 |
| `/faq` | `{ faqs: [{ question, answer }] }` — flattened |
| `/trust-badges` | `[{ id, iconKey, title, text }]` — ships unconsumed |
| `/home` | `{ sections: [{ type, payload }] }` in stored order — **[LATER] consumer**, see C-10 |

**Two projections over one store.** The legacy fragment endpoints make cutover mechanical today; `/home` unlocks true admin-driven ordering whenever the storefront is ready. `/home` costs one extra serializer and is worth shipping now so the data model is proven before the storefront asks for it.

---

### 15. FAQ and footer managers

**FAQ** — today six flat Q&As inside `footerPagesData.faq.faqs`, no groups, no ids. Model `faq_group (id, title, position, isActive)` + `faq_item (id, groupId, question, answer_json/html, position, isActive, updatedAt)`, seeded with a single **"General"** group so the flat reality is represented honestly rather than dressed up. The public serializer **flattens to `faqs: [{ question, answer }]`** so `FAQPage.jsx` renders unchanged. UI: shadcn `Accordion`, `@dnd-kit` reorder within and across groups, `Switch` per item, debounced search over question + plain-text answer. Groups exist so six questions can become thirty without a schema change; the UI hides group management until a second group is created.

**Footer** — a singleton document plus child tables mirroring `footerData` exactly: `brand {name, description}`, `socialLinks [{platform, url}]`, `sections [{title, links [{label, path}]}]`, `customerService {heading, description, email}`, `legalLinks`, `copyright`.

| Link validation rule | Why it matters here |
|---|---|
| A value starting `/` is internal and must match a route from `AppRoutes.jsx` — `/`, `/sale`, `/shop`, `/craftsmanship`, `/account`, `/profile`, `/cart`, `/wishlist`, `/order`, `/my-orders`, `/about`, `/our-story`, `/contact`, `/shipping-returns`, `/size-guide`, **`/care-guide`**, `/faq`, `/privacy-policy`, `/terms-of-use` — or a published CMS page slug | The storefront uses react-router `<Link>`; an unknown path silently renders the 404 page with no error anywhere. `/care-guide` must be accepted as a route even though no `care-guide` document exists |
| A `#anchor` suffix is validated against that page's block `anchorId`s and offered through a `Command` picker | Six live footer links already depend on anchors; a typo is invisible until a customer clicks |
| External links must be `https:`, `mailto:` or `tel:`; `rel="noopener noreferrer"` and `target="_blank"` are added automatically | `socialLinks` currently holds **three `"#"` placeholders** (Instagram, Facebook, YouTube) — the form flags them as incomplete rather than shipping dead icons |
| `platform` is an enum of **exactly `Instagram, Facebook, YouTube, Email`** | `Footer.jsx` has `iconMap` with those four keys and renders `iconMap[social.platform]`. Any other value renders **nothing at all**. Adding WhatsApp or Pinterest is a storefront change (C-11), and the form says so instead of silently offering a broken option |
| `copyright` supports a `{year}` token | Today it is the literal `"© 2026 Niya Bags. All rights reserved."` — a token removes an annual manual edit |

The route list in `lib/validation/routes.ts` is a hand-maintained mirror of `AppRoutes.jsx` with a comment saying so. It cannot be derived — the storefront is a separate deployment we are forbidden to import from. A drift check is part of the cutover runbook.

---

### 16. Cutover checklist — nothing below happens now

| # | Storefront file | Change | Trigger |
|---|---|---|---|
| C-1 | Vercel env | `VITE_MOCKOON_API_BASE_URL = https://admin.niyabags.com/api/public` | first cutover; alone this repoints `/not-found-bags` and nothing else |
| C-1b | `src/api/axiosClient.js` | split the shared var: give `contentApi` its own `VITE_CONTENT_API_BASE_URL`, leave `authApi` on the mockoon base | **do this with C-1** — otherwise the day auth goes to HTTP it inherits the CMS base URL |
| C-2 | `src/api/contentApi.js` | uncomment the file (already written) | first cutover |
| C-3 | `src/api/homeApi.js` | re-export from `contentApi` instead of `../data/homeData` | first cutover |
| C-4 | `src/api/footerApi.js` | **write** the axios version (does not exist) | first cutover |
| C-5 | `src/api/api.js` | add `footerApi` / `homeApi` to the barrel | optional — only `FooterPage.jsx` (unrouted) needs it |
| **C-6** | `home/BrandCraftsmanship.jsx`, `home/CustomerReviews.jsx` | **convert the synchronous `getCraftsmanship()` / `getReviews()` calls to `useState` + `useEffect`** | **mandatory at first cutover — these two silently blank out otherwise** |
| C-7 | 6 render sites across `src/pages/footer/` | `content` string → `dangerouslySetInnerHTML` | only when rich-text HTML is switched on; API emits plain text until then |
| C-8 | `home/TrustBadges.jsx` | fetch + `iconKey → IconType` map | when badges go data-driven |
| C-9 | `pages/HomePage.jsx` (newsletter block) | fetch copy from `/home`; wire the form to a real subscriber endpoint | when a `Subscriber` entity exists |
| C-10 | `pages/HomePage.jsx` (section order) | render `/home` sections dynamically instead of fixed JSX | when true drag-order is wanted end to end |
| C-11 | `common/Footer.jsx` | extend `iconMap` | only if a new social platform is needed |
| C-12 | `home/HeroBanner.jsx` | use `slides[current]` for heading/subtitle; use `buttonText`/`buttonLink` instead of the hardcoded `/shop` CTA | when per-slide copy is wanted |

**Say the gap in the product, not just the doc.** Until C-10, the builder shows a persistent `Alert`: *"Section order is saved here, but the live site currently renders a fixed order. Ask your developer to enable dynamic ordering."* Fields marked INERT in §4 carry the same treatment at field level. An admin panel that quietly lies about what it controls is worse than one that admits the gap — and this module has eleven honest gaps, all listed above.

---

### 17. Explicitly deferred — [LATER], with reasons

| Deferred | Why |
|---|---|
| Whole-section publish scheduling UI | One person editing 12 sections does not schedule a craftsmanship block. Columns exist; the picker is only on announcements, promos and reels |
| Review moderation queue, ratings pipeline, verified-purchase badges | No reviews API, no order-to-review link, and "Verified Customer" is a hardcoded string. Nothing to moderate |
| `pg_trgm` + GIN on media search | A few hundred assets. `ILIKE` is faster to ship and to reason about. Revisit past ~5k |
| Media grid virtualisation | Same reason; cursor pagination at 60/page is enough |
| A/B testing or personalisation of sections | No analytics or event tracking exists anywhere in the storefront. There is no metric to test against |
| i18n / locale dimension | Content is English-only; the storefront has no locale routing |
| `ogImageId` and per-page OG tags | Vite SPA, no SSR and no head management — nothing would consume them |
| Multi-user editing locks, presence, field-level merge | Exactly one admin. Optimistic `updated_at` concurrency is included; anything beyond it is theatre |
| Content approval workflows | Two roles only, one of which is the customer. There is nobody to approve to |
| `/home` dynamic ordering on the storefront | Ships as an endpoint now, consumed at C-10 |


**Decisions**

- FIX (hallucination): Draft claimed '8 pages under src/pages/footer/ → getFooterPage(slug)'. Verified: 8 files but only 7 are routed and call it. The 8th, FooterPage.jsx, is UNROUTED dead code that imports getFooterPage from the barrel (src/api/api.js), which does not re-export footerApi — so it would resolve to undefined and hang on 'Loading…' forever. Documented as a latent bug, and C-5 (barrel fix) demoted from 'first cutover' to optional because every live consumer imports api/homeApi and api/footerApi directly.
- FIX (missing, highest-impact): Draft treated cutover as uniformly mechanical. Verified that BrandCraftsmanship.jsx (line 5, `const data = getCraftsmanship();`) and CustomerReviews.jsx (line 5, `const reviews = getReviews();`) call their API functions SYNCHRONOUSLY with no useState/useEffect/await — they work only because homeApi's versions are non-async. At cutover both return Promises: craftsmanship renders an empty section, reviews disappears entirely. Added as mandatory cutover item C-6 and a Promise-safe column on the consumer inventory table.
- FIX (missing): Draft said cutover is an env var plus uncommenting. Verified axiosClient.js builds authApi as `${mockoonBaseURL}/api/auth` from the SAME VITE_MOCKOON_API_BASE_URL that contentApi uses. Repointing it today is safe only because authApi.js is 100% localStorage and never touches the instance — the day auth goes HTTP the two collide. Added C-1b: split the variable (VITE_CONTENT_API_BASE_URL) as part of the same cutover.
- FIX (hallucination): Draft's `contact_details` block used `{ icon, label, value, href? }`. Verified ContactPage.jsx reads `iconMap[detail.type]`, `detail.title`, `detail.content`, `detail.value` + `detail.url`, and does two `.find(item => item.type === 'email'|'phone')` sidebar lookups. Corrected to `{ type: email|phone|instagram|address, title, content, value?, url? }` with `type` unique per page because it doubles as the lookup key.
- FIX (hallucination): Draft proposed a social platform enum of Instagram, Facebook, YouTube, Email, WhatsApp, Pinterest, X. Verified Footer.jsx's iconMap has EXACTLY four keys (Instagram, Facebook, YouTube, Email) and renders iconMap[social.platform] — anything else renders nothing. Enum restricted to four; adding one is cutover item C-11.
- FIX (hallucination): Draft said AnnouncementBar 'renders all items into a CSS marquee' and justified the 5-item cap by marquee width. Verified: desktop is a 28px `flex justify-around` showing ALL items simultaneously; only mobile is a CSS carousel. Cap justification rewritten to a desktop row character-budget meter. Also removed the proposed `href` field — the component renders a <span>, not a link.
- FIX (hallucination): Draft's craftsmanship payload used `paragraphs: string[]`. Verified BrandCraftsmanship.jsx reads `data.description?.map(...)`, `data.image` and `data.imageAlt`. Serializer contract corrected to emit `description`, `image`, `imageAlt`, and a rule added that public payloads never leak internal ids (MediaRef → flat URL string).
- FIX (missing): Draft listed hero `buttonText`/`buttonLink` as ordinary editable content. Verified HeroBanner.jsx hardcodes `<Link to="/shop">EXPLORE THE COLLECTION →</Link>` and uses `slides[0]` alone for heading and subtitle (the file's own comment says 'ONLY FIRST API ITEM'). Introduced an explicit INERT field concept across the registry, an inert-field-hint component, and cutover item C-12.
- FIX (hallucination): Draft asserted reviewsData has 'no rating' and treated rating as a new invention. Verified CustomerReviews.jsx renders `review.rating || 5` stars and the literal string 'Verified Customer'. Rating is a real consumed optional field; the section eyebrow/title ('THE NIYA EXPERIENCE' / 'Loved by Women Everywhere') are hardcoded and therefore INERT, and no 'verified' toggle is offered because the string is unconditional.
- FIX (over-engineering): Draft gave `categories` and `featured_products` editable eyebrow/title plus a `source: featured|best_sellers|new_arrivals|subcategory|manual` selector with productIds and limit. Verified both components are fully hardcoded (FeaturedProducts rails at lines 240–265; CategorySection has its own women/men toggle). Replaced with locked presence-and-order rows carrying zero editable fields — a source selector would be a form that does nothing.
- FIX (hallucination): Draft claimed 'All 52 files in public/ use spaces and parentheses'. Verified 47 of 52 do; favicon.svg, icons.svg, 7580808.jpg, 8269403.jpg and image.png are clean. Corrected, and the inconsistent-encoding finding (heroBannersData percent-encoded vs reelsData raw space) kept because it is real.
- FIX (missing): Draft ignored that /size-guide AND /care-guide both route to SizeCarePage, which hardcodes getFooterPage('size-guide'), and that LegalPage derives its slug from pathname for two routes. Added the full route→slug mapping table and a link-validation rule that accepts /care-guide as a route while forbidding a care-guide CMS slug.
- FIX (accuracy): Draft claimed our-story's sections share the id-bearing shape. Verified our-story's section entries have NO id field at all. anchorId is now explicitly optional, and generating one for our-story is called out as creating a new anchor rather than restoring one.
- FIX (over-engineering): Cut pg_trgm + GIN media search and virtualised grid — a few hundred assets. Replaced with ILIKE + array containment and cursor pagination at 60/page, with a stated revisit threshold (~5k assets).
- FIX (under-specified → committed): Draft's preview said 'iframe srcDoc at 390/768/1440'. srcDoc requires re-injecting the whole stylesheet on every keystroke for zero fidelity gain at 80%. Committed instead to a scoped container with a reset plus a single preview-tokens.css mirroring the storefront's CSS custom properties.
- FIX (over-engineering): Removed cta_label/cta_href/caption from cms_reel and `heading` from the reels section payload — ReelsSection.jsx renders only a video and a title. Unconsumed columns invite admins to write copy nobody will see.
- FIX (dishonesty): Draft said 'C-6: one-line-per-file change in 5 files' for rich-text HTML. Counted 6 real render sites (AboutPage sections + values[].content, OurStoryPage, ShippingReturnsPage, SizeCarePage, LegalPage, FAQPage answers). Also made the serializer take an explicit `format=text|html` decision defaulting to text, so the API is correct before and after C-7 rather than emitting raw tags into a <p>.
- FIX (dishonesty): Draft mentioned the newsletter has no subscriber storage in passing. Promoted to an explicit statement that the live form does nothing with a submitted address today, surfaced in the builder UI, with the Subscriber entity and ESP integration named as out of scope.
- FIX (over-engineering, demoted not cut): Whole-section publish scheduling UI moved to [LATER]; the columns and the single read-time predicate stay (zero cost) but the date picker is exposed only on announcements, promo banners and reels where INR sale windows are real.
- FIX (missing): Added §12 seeding — a seed-cms-content.ts alongside the media importer, plus a verify-parity.ts acceptance gate that diffs every public endpoint against homeData.js/footerData.js. Cutover does not begin until that diff is empty. The draft imported media but never said how the CMS gets its initial content.
- FIX (missing): Added an explicit [LATER] register (§17) with one-line reasons — A/B testing (no analytics exists anywhere), i18n, OG images (no SSR/head management), approval workflows (two roles, one is the customer), multi-user locks (one admin).
- FIX (structure): Renumbered decisions D-1..D-9 so the inline markers match a single coherent set, added an optimistic-concurrency token (updated_at + 409 STALE_WRITE) to cms_section, reduced revision retention from 50 to 30 per entity, and named the nightly prune as this module's only cron.
- FIX (consistency): Added the explicit note that ADMIN role is re-checked in every handler because Next middleware is not an authorization boundary for directly-fetched route handlers, and that the public API needs no credentialed CORS since axiosClient's contentApi instance sets no withCredentials.

**Open assumptions**

- Database is PostgreSQL with Prisma (jsonb, partial unique indexes, deferrable unique constraints). If another section picks MySQL or MongoDB, the JSONB-payload and index details need restating — the registry pattern itself survives.
- Admin is deployed on Vercel serverless. This drives the 4.5 MB body-cap argument for direct-to-Cloudinary video upload and the read-time scheduling evaluation instead of a daemon.
- The storefront's production origin(s) are known and can be added to a CORS allowlist; a staging origin is added at cutover. Confirm the exact Vercel domain(s) before freezing the allowlist.
- Cloudinary's free tier is acceptable and creating an account is allowed. If the user prefers a single vendor, R2 + ImageKit behind the same MediaProvider is the fallback and changes nothing above the interface.
- The mockoon /not-found-bags response shape could not be verified (no mock file in the repo). NotFoundPage.jsx reads only bag.id and bag.image, so that is the contract we ship — confirm before freezing, and note the page renders no alt attribute today.
- The admin's production domain is assumed to be admin.niyabags.com in the endpoint examples. Any domain works; the value only has to match VITE_CONTENT_API_BASE_URL at cutover.
- Exactly one person edits content, so last-write-wins on draft_payload with an updated_at check is acceptable and no locking or presence is built.
- Content is English-only; no locale dimension on sections, pages, or footer.
- Rich-text HTML delivery (C-7) is assumed to be a LATER switch, not part of first cutover — the serializer emits plain text until the six storefront render sites are converted. Confirm the user is happy shipping plain-text page bodies initially.
- The three Pexels reel hotlinks are assumed safe to re-host to Cloudinary. If there is any licensing constraint on redistribution, keep them as external rows and accept the fragility.

**Risks**

- C-6 is the single highest-risk cutover item and is easy to miss: BrandCraftsmanship.jsx and CustomerReviews.jsx call their API synchronously. Flipping homeApi.js to HTTP without fixing them blanks two homepage sections with no console error and no visible failure — it just renders nothing. The parity script must include a rendered-DOM check, not only an endpoint diff.
- The route allowlist in lib/validation/routes.ts is a hand-maintained mirror of AppRoutes.jsx across a deployment boundary we are forbidden to import from. It will drift. A footer link to a route the storefront removed silently renders the 404 page. Mitigation is a manual drift check in the cutover runbook — there is no automated one available.
- VITE_MOCKOON_API_BASE_URL is shared between contentApi and authApi. If the auth module ships HTTP before C-1b lands, auth requests will be sent to the CMS public API base. Sequencing between this module and the auth module needs an owner.
- Freezing the public API to homeData.js's exact shapes buys a mechanical cutover but locks in that shape's flaws — notably a hero payload whose per-slide copy is unreachable and a reviews payload with no product linkage. Every future improvement to those sections is a coordinated two-repo change, not an admin-only one.
- The admin owns the content database while the storefront owns the product data (still a static JS file). Until the product module also has a real API, media reference tracking for product images is aspirational — the media_reference rows for products cannot be populated from anything authoritative.
- Cloudinary URL syntax leaks into stored `url` / `secure_url` values. The MediaProvider interface abstracts the write path but not the ~400 rows of already-persisted transform-capable URLs. A provider swap later means a data migration, not just a code swap — the interface reduces that cost but does not remove it.
- Read-time scheduling with s-maxage=60 means a scheduled banner can be up to ~60s late and, more subtly, that an unpublish is also up to ~60s late. For a legal or pricing correction that lag is a real exposure; the fix (Vercel Cron hitting a revalidate route) is cheap but is not in v1.
- Zod safeParse-on-read degrades gracefully to 'needs re-save' in the admin, but the public serializer's fallback to the last valid published_payload can mask a registry regression for a long time — a payload can be silently stale while the builder looks fine. Needs an alert or at least a count surfaced on the dashboard.
- The 'INERT field' pattern is honest but only as good as its maintenance. Every one of the eleven cutover items removes inert markers from specific fields; if that bookkeeping lapses, the admin UI starts lying again — the exact failure the design is built to avoid.

---

## Inventory Architecture and Marketing / Discounts

All of this is greenfield inside `admin_panel/`. Nothing in `e-commerce_frontend-main/` is edited by this section. Everything below is **ADMIN-only**; the two-role model (`ADMIN`, `USER`) is unchanged and `USER` gets no route, endpoint or field here.

### 0. Verified starting position

Five facts, re-read from the repo. Three of them change the design, so they carry file:line evidence.

| # | Fact | Evidence |
|---|---|---|
| 1 | **No stock concept exists.** A repo-wide grep for `stock` / `inventory` / `inStock` returns **zero** hits in `src/`. `ShopPage.jsx:35` declares `availabilityFilter`, but `:210-228` filters on `isOnSale`, `isFeatured`, best-seller ids and a 30-day `createdAt` window; its four options are hardcoded at `:549-553`. A merchandising filter wearing an inventory name. |
| 2 | **Quantity is unbounded.** `ProductDetails.jsx:351` clamps only the lower bound (`Math.max(1, q - 1)`); `CartContext.updateQuantity` rejects only `newQty <= 0`. |
| 3 | **Sale price is display-only and is never charged.** `CartPage.jsx:133-137` prices a line as `item.variant.price` then `product.price`; `OrderPage.jsx:76-80` sums `Number(item.price)`. Neither reads `salePrice`. `enrichedProducts` (products.js:1794) computes `finalPrice` and no page consumes it. |
| 4 | **A coupon input already exists, and it is fake.** `CartPage.jsx:30-32, 185-209, 692-736`: a promo field whose placeholder reads `Try 'NIYA10'`, hardcoded to 10 percent off subtotal, client-side, unlimited, no expiry, no server call. `OrderPage` ignores it. |
| 5 | **Free shipping is hardcoded twice, inconsistently.** `CartPage.jsx:164` sets `FREE_SHIPPING_LIMIT = 2000` for a progress bar but then sets `estimatedShipping = 0` (always free); `OrderPage.jsx:82` charges `subtotal >= 2000 ? 0 : 100`. |

Scale, counted rather than estimated: **39 products, ~78 variants**, subcategories handbags 6 / minibags 14 / sling 9 / tote 7 / wallet 3, gender 36 women / 3 men. This is a two-digit catalogue run by one owner. Every decision below is sized for that, not for a marketplace.

---

### A. Inventory

#### A.1 Grain: stock lives on the variant

Niya Bags sells one physical object per (product, colour). `handbag-001` in Black is a different thing on a shelf than in Brown, so stock lives on the **variant**; product-level stock would keep selling Black after Black ran out. At ~78 variants this is not a scale decision, it is a correctness one.

That forces stable variant ids, because `products.js` variants are `{ name, images[] }` with no id.

**What stable variant ids actually fix, and what they do not.** The claim "the storefront bug is fixed by data shape alone" is **wrong**, and the difference is a fixed cart versus a cart that silently deletes a line.

- `CartContext.getVariantKey` (`CartContext.jsx:27-36`) reads `selectedVariant?.id || selectedVariant?._id || product.variantId || ""`. Emitting `variants[].id` makes that branch live, so **Black and Brown stop merging their quantities**. Real win, zero storefront edits.
- But `addToCart` (`CartContext.jsx:86-107`) has a second branch: when no exact key matches and any line with the same `productId` prefix exists, it **filters those lines out and inserts the new one**. Adding Brown after Black replaces Black rather than adding a line. `isInCart` (`:60-66`) likewise returns true for any variant of the product.
- **Honest statement: stable variant ids are necessary but not sufficient.** They fix quantity-merge; the remaining last-variant-wins replacement is a `CartContext.jsx` edit, outside `src/api/*.js` and therefore outside the mechanical cutover. Logged as a post-cutover storefront ticket, not claimed as solved here.

**Two identifiers are public contract and must never be regenerated:**

- `Product.id` keeps its existing slug-style value verbatim (`handbag-001`). It is the `/product/:id` route key, the `localStorage "niya_cart"` line key, and part of the `"niyaWishlist"` key. Reissuing ids would orphan every device-local cart and wishlist in existence.
- `ProductVariant.name` is **also** a public key, which is easy to miss: `ShopPage.jsx:201-207` matches the colour facet on `variant.name.toLowerCase()`, and `WishlistContext.jsx:29-31` builds its key as `productId + "-" + color`. Renaming Black to Jet Black in the admin silently breaks shared filter URLs and drops wishlist entries. The variant editor therefore treats `name` as slug-like: rename is allowed but raises an `AlertDialog` naming the consequence, and `name` is never auto-normalised.

#### A.2 Entities

| Entity | Key fields | Notes |
|---|---|---|
| `ProductVariant` | `id`, `productId`, `name`, `sku`, `images[]`, `costPricePaise?`, `position` | `sku` suggested as `NB-<SUBCAT3>-<NNN>-<COLOUR3>` derived from the existing product id (`handbag-001` Black gives `NB-HAN-001-BLK`), editable, unique. `name` stays the wire field the storefront already reads. |
| `InventoryItem` | `id`, `variantId`, `locationId`, `onHand`, `reserved`, `lowStockThreshold`, `lastCountedAt`, `lowStockNotifiedAt?`, `version` | One row per (variant, location), unique on the pair. `available = onHand - reserved` is **computed on read, never stored**. |
| `StockMovement` | `id`, `inventoryItemId`, `type`, `delta` (signed, never 0), `reason`, `note?`, `orderId?`, `actorUserId`, `balanceAfter`, `createdAt` | Append-only. No update path, no delete path, no exceptions. |

**Money rule.** All currency is stored as integer **paise** (`299900`). Percent arithmetic on rupee floats produces `2498.9999`-class drift, and this store's whole discount story is percentages. The public read serializer converts back to **whole rupees** (`price: 2999`) because the storefront does `Number(item.price)` and `toLocaleString("en-IN")` on the raw value. Rounding is committed: compute in paise, round **half-up to the whole rupee** at the discount and shipping level, never per line, so emitted totals are integral and match the storefront's naive addition exactly.

#### A.3 Ledger versus counter, committed

| Option | For | Against |
|---|---|---|
| Counter only | One int, trivial | Cannot answer "why is this 3?". With COD, refused-at-door parcels come back weekly and an unexplained count becomes a weekly argument with no audit trail. |
| Ledger only (`SUM(delta)` on read) | Perfect audit | Availability is needed on every product read once the storefront is cut over. Aggregating per variant on every listing is wrong at 78 rows and unfixable at 780. |

**Decision: append-only ledger as source of truth plus a cached counter on `InventoryItem`, written in the same Prisma `$transaction`.** Never one without the other. Each movement stores `balanceAfter`, so drift is bisectable by eye rather than by replay. A **Recount** action recomputes `SUM(delta)` per item, compares to `onHand`, and on mismatch writes a `correction` movement with `reason: SYSTEM_RECONCILE` and `actorUserId = system` — the drift is recorded, never silently patched.

**Cadence, committed:** Recount is a manual button plus a **weekly** Vercel Cron job over all ~78 rows (a nightly job over 78 rows is ceremony). The design requires Postgres with real transactions and row-level locking, matching the blueprint's Postgres + Prisma direction; that is a hard requirement of the oversell guard, not a preference.

#### A.4 Movement types and reasons

| `type` | Sign | Trigger |
|---|---|---|
| `purchase` | + | Stock received from the maker. No supplier or PO system is in scope, so this is a manual receipt event. |
| `sale` | - | Reservation converted at fulfilment |
| `return` | + | Customer return accepted, or COD refused at door (RTO) |
| `adjustment` | +/- | Deliberate admin change (found, lost, gift, sample) |
| `correction` | +/- | Recount reconciling ledger against physical or against cache |
| `damage` | - | Written off, not sellable |

`reason` is a required enum so history is filterable and the low-stock story is explainable; free text goes in `note`. Committed set: `SUPPLIER_RECEIPT`, `CUSTOMER_RETURN`, `RTO_COD_REFUSED`, `CYCLE_COUNT`, `DAMAGED_IN_TRANSIT`, `SAMPLE_OUT`, `PHOTOSHOOT_OUT`, `MANUAL_FIX`, `SYSTEM_RECONCILE`. `RTO_COD_REFUSED` exists because COD is the storefront's default payment path and refusal is the most common restock event this store will have.

`delta` is never zero: a **Set to** edit whose target equals current `onHand` is a server-side no-op returning 200 with no movement, not a zero-delta row.

#### A.5 Order coupling: reserve on placement, deduct on fulfilment

"Decrement on placed versus on confirmed" is a false choice; two-phase reservation answers both.

| Order event | `onHand` | `reserved` | Movement |
|---|---|---|---|
| Order placed (COD or ONLINE) | unchanged | +qty | none |
| First transition past PLACED (confirmed / packed / shipped) | -qty | -qty | `sale` |
| Cancelled before fulfilment | unchanged | -qty | none, reservation released |
| Cancelled after shipping, or RTO | +qty | unchanged | `return` with `RTO_COD_REFUSED` |
| Return accepted, resellable | +qty | unchanged | `return` |
| Return accepted, damaged | unchanged | unchanged | `damage`, goods never re-enter `onHand` |

`onHand` moves only on a **physical** event: it is what is on the shelf. `reserved` is what is promised. For a COD store that is the whole point — an order placed at midnight is a promise, and the owner picking stock at 9am must see the physical count.

**Removed: the abandoned-payment TTL sweeper.** It assumed a payment gateway. There is none — `paymentMethod: "ONLINE"` is a radio label in `OrderPage.jsx` and nothing more — so no payment-pending state exists and nothing abandons a reservation. Reservations are released only by explicit admin cancellation. In its place, a cheap **stale-reservation report**: orders still in `PLACED` after N days (default 7) are listed on the inventory overview with one-click cancel-and-release. A report the owner reads beats a cron job that silently frees stock.

**The oversell guard.** Order-create runs one transaction: lock the affected `InventoryItem` rows **ordered by `variantId`** (fixed ordering prevents deadlock on multi-line orders), then per line issue a conditional update — `SET reserved = reserved + :qty WHERE id = :id AND (onHand - reserved) >= :qty`, implemented as Prisma `updateMany` and checking the returned count. Any line returning 0 aborts the whole transaction with `409 INSUFFICIENT_STOCK`, naming the `variantId` and current `available`. The conditional WHERE is the guard; the lock only fixes ordering and phantom writes. Order-create also requires an `Idempotency-Key` header, because a COD checkout retried on a flaky mobile connection must not double-reserve.

**Honesty about when this engages.** Today the storefront writes orders to `localStorage "niyaOrders"`, and the real call is the commented line `// await createOrder(orderPayload)` at `OrderPage.jsx:144`. **No order reaches this transaction until checkout is repointed.** Until then the admin's order table is empty and the only thing that moves stock is an admin adjustment. The reservation machinery is built now because retrofitting it after orders start flowing means reconciling a live ledger — but it must not be described as protecting anything yet.

#### A.6 Deliberate cuts and deferrals

Enterprise-grade means well-structured, not bloated.

| Cut | Reason |
|---|---|
| `Location` table with `type: WAREHOUSE / STORE / TRANSIT` | The single door-opening field `InventoryItem.locationId` (string, seeded `loc_default`, unique on `(variantId, locationId)`) is kept, because retrofitting a key across a movement ledger is expensive. The table and its enum are **[LATER]** — one row with a type enum is furniture. |
| `backorderPolicy` per item | **[LATER]**. The storefront cannot render "ships in 3 weeks", so ALLOW would only produce silent negative stock. |
| Nightly reconcile job | Weekly, over 78 rows. |
| "Inventory value at retail" KPI | Derivable from the table; one owner does not need two valuation tiles. |
| Per-event low-stock email | One daily digest (A.8). |

#### A.7 Admin API (Next.js route handlers, Auth.js v5 session, ADMIN-gated)

| Method + path | Purpose |
|---|---|
| `GET /api/admin/inventory` | List with filters (subcategory, gender, status, q) and cursor paging |
| `GET /api/admin/inventory/:id` | One item with variant and product context |
| `POST /api/admin/inventory/:id/adjust` | `{ mode: delta or set, value, reason, note?, version? }` — one movement plus counter, one transaction |
| `POST /api/admin/inventory/bulk-adjust` | `{ rows: [{ sku, delta, reason }] }`, one transaction, per-row results |
| `GET /api/admin/inventory/:id/movements` | Cursor-paginated per-variant history |
| `GET /api/admin/inventory/movements` | Global ledger, filterable, `?format=csv` |
| `POST /api/admin/inventory/recount` | `{ itemIds?: [] }`, writes `correction` movements on mismatch |
| `GET / PATCH /api/admin/settings/inventory` | Default `lowStockThreshold`, digest recipients |

Lists are fetched server-first in React Server Components; only mutations and the optimistic table use client-side TanStack Query.

#### A.8 Screens

```
admin_panel/src/app/(dashboard)/inventory/
  page.tsx                    # overview: KPI row + table
  movements/page.tsx          # global ledger
  [variantId]/page.tsx        # per-variant detail + history
admin_panel/src/features/inventory/
  components/  inventory-table.tsx, on-hand-cell.tsx, adjustment-sheet.tsx,
               bulk-adjust-dialog.tsx, movement-timeline.tsx,
               low-stock-badge.tsx, kpi-row.tsx, stale-reservations-card.tsx
  hooks/       use-adjust-stock.ts, use-bulk-adjust.ts
  schemas/     adjustment.schema.ts   # zod, shared by RHF and the route handler
```

**KPI row** — exactly five shadcn `Card`s with `Skeleton` loading:

| KPI | Formula |
|---|---|
| Variants tracked | count of `InventoryItem` for published products (~78) |
| Out of stock | `available <= 0` |
| Low stock | `0 < available <= lowStockThreshold`; click-through applies the filter |
| Units reserved | `SUM(reserved)` — promised, not yet shipped |
| Inventory value at cost | `SUM(onHand * costPricePaise)`; `costPricePaise` does not exist today, so while any variant lacks one the tile renders an em-dash plus a "Set cost prices" CTA rather than a misleading number |

**Inventory table** — TanStack Table in a shadcn `DataTable`: thumbnail, product title, variant name, SKU, **on hand (inline editable)**, reserved, available (read-only, computed), threshold, status `Badge`, last movement, row `DropdownMenu`. Making the computed `available` editable would contradict the "never stored" rule; the editable value is `onHand`. Filters live in the URL via `nuqs`, mirroring the storefront's own `?filter=` / `?subcategory=` idiom so links are shareable.

**Inline edit** — TanStack Query `useMutation` with `onMutate` snapshot, `onError` rollback plus a `sonner` toast naming the SKU, `onSettled` invalidate. The request carries `version`; the server does a compare-and-set and returns `409 STALE_INVENTORY` with the fresh row, and the toast offers "Reload row". `version` is required for **Set to** edits and ignored for **delta** edits, which are commutative and need no CAS. Every inline edit writes an `adjustment` movement with `reason: MANUAL_FIX`. There is no silent write path to `onHand`.

**Adjustment sheet** (`Sheet` + RHF + zod): Delta or Set-to toggle (Set-to is converted server-side into the implied signed delta so the ledger stays delta-only), required `reason` `Select`, optional `note`, live preview "12 to 17 on hand / 9 available", `AlertDialog` confirm when the result goes negative or the delta exceeds 50.

**Bulk adjustment** — row checkboxes apply one delta and reason to N variants, or paste / upload a `sku,delta,reason` CSV for a stock-take. This is also the **opening-stock seeding path**: the owner's first count enters as `purchase` movements. Executed as one transaction with per-row results, and the dialog renders a success/failure table, because a 40-row count with 3 failures must not look like total success.

**Movement history** — per-variant `Tabs` to History: cursor-paginated timeline filterable by type and date range, each entry showing delta, `balanceAfter`, reason, note, actor, and an order link when `orderId` is set. CSV export.

**Low-stock alerting** — per-item threshold defaulting from settings (start at **3**; a Rs 3,000 handbag with a slow maker needs earlier warning than a fast-moving consumable). Alerts fire **only on a downward crossing**, guarded by `lowStockNotifiedAt`, cleared when `available` rises back above the threshold — without that flag every later sale re-alerts and the owner mutes the channel inside a week. Surfaces: the Low stock tile, a count badge on the sidebar Inventory item, a dashboard widget, and **one daily digest email** to ADMIN users. Out-of-stock crossing is the single immediate notification.

#### A.9 Seeding

The importer reads a **committed JSON snapshot** in `admin_panel/prisma/seed/`, produced once by hand from the storefront's `products.js`. The admin build never imports across the folder boundary — the two projects deploy separately and must not share a module graph. The snapshot preserves `id`, `slug`, `title`, `gender`, `subcategory`, `price`, `salePrice`, `createdAt`, `isFeatured`, `orderCount`, `rating`, `reviewCount` and variant `name` + `images` verbatim, and mints one `ProductVariant.id` and one `InventoryItem` per variant with `onHand = 0`.

#### A.10 What the no-touch constraint blocks

The inventory module is **fully usable standalone on day one** because it is internal operations data: the owner can run real stock control against it immediately. What is blocked is only the customer-facing consequence.

| Capability | Blocked by | Inside `src/api/*.js`? |
|---|---|---|
| Admin sees and adjusts real stock | nothing | n/a — works now |
| Storefront shows sold-out / disables Add to Cart | needs `variants[].id`, `variants[].available`, product `inStock` in the read API **and** rendering in `ProductCard` / `ProductDetails` | **No** — component edits |
| Quantity capped at `available` | `ProductDetails.jsx:351`, `CartContext.updateQuantity` | **No** |
| "In stock" filter option on Shop | options hardcoded at `ShopPage.jsx:549-553`, branches at `:210-228` | **No** — this is not a free upgrade |
| Orders reserve stock at all | `OrderPage.jsx:144` `// await createOrder(...)` | **Yes** — but the payload also needs discount fields, see B |
| Black and Brown as two cart lines | `CartContext.jsx:86-107` replacement branch | **No** |

Until cutover the server-side oversell guard protects nothing, because nothing calls it. After cutover it will reject checkouts the storefront happily allowed, which is the correct failure mode and a rejection state the checkout must be ready to render.

---

### B. Marketing and discounts

#### B.0 What is actually there today

The marketing surface is not just three product fields, and a code input does exist. Both facts change the plan.

1. **A live, uncontrollable coupon.** `NIYA10` gives 10 percent off in the cart, hardcoded client-side, its own placeholder advertising it. Nothing the admin does — pausing, expiring, usage limits — can affect it until `CartPage.jsx:191-209` is edited. The discounts screen therefore carries an explicit "1 legacy code is hardcoded in the storefront and is not controlled here" banner until cutover, rather than listing `NIYA10` as if it were managed.
2. **Cart and checkout already disagree.** Cart applies the promo and charges zero shipping (`estimatedShipping = 0`, `CartPage.jsx:179`); checkout ignores the promo and charges Rs 100 under Rs 2,000 (`OrderPage.jsx:82`). Free shipping is hardcoded in two files.
3. **Sale price is not charged.** See fact 3 in section 0. Putting a product on sale changes badges and the PDP only; the customer still pays `price`.

**The discount-percentage hazard, stated accurately.** `ProductCard.jsx:37-41` prefers the **stored** `discountPercentage` over the computed one, while `ProductDetails.jsx:138-143` always computes its own. All 10 currently on-sale products have stored equal to computed, so this is a **latent** hazard, not a live mispricing. It becomes live the moment an admin can edit `salePrice` independently — which is exactly what this section builds — and the failure mode is a card claiming "30 percent OFF" beside a PDP claiming 17 percent for the same bag. **Committed: `discountPercentage` is never stored.** The serializer emits `round((price - salePrice) / price * 100)` into that field, so the storefront's preference for the stored value becomes correct by construction and both surfaces agree.

#### B.1 Level 1 [NOW] — product-level sale price

| Aspect | Design |
|---|---|
| Model | `Product.pricePaise`, `Product.salePricePaise?`. `isOnSale` and `discountPercentage` are **derived at serialization**, not columns |
| Scheduling | `SalePriceSchedule { id, productId, salePricePaise, startsAt, endsAt, status: SCHEDULED / ACTIVE / ENDED / CANCELLED }`; a Vercel Cron worker flips the effective price at the boundaries. Because projection happens at read time, a missed run degrades to a stale price, not a wrong one |
| Bulk action | Product-list selection to "Put on sale": percent-off or fixed price, optional window, preview of old, new and effective percent before commit |
| Sale page ordering | `Product.saleRank` int, sorted server-side |

**Ordering needs no storefront change.** `SalePage.jsx:16-21` calls `getAllProducts()` then `.filter(p => p.isOnSale)`, which preserves array order, so server-side `saleRank` gives drag-to-reorder for free. Same for `getFeaturedProducts` (products.js:1710, filter only). It does **not** hold for best-sellers, which `products.js:1716` sorts by `orderCount` — after cutover that helper is replaced by `GET /products?bestSeller` and ordering becomes the server's anyway.

**Blocking status, corrected.** Level 1 is *not* blocked only by the cutover. After the `src/api/*.js` cutover, sale prices still would not be **charged**, because `CartPage.jsx:133-137` and `OrderPage.jsx:76-80` read `item.price`.

| Level 1 capability | Status after cutover alone |
|---|---|
| Sale badge, strikethrough, correct percent on card and PDP | Works |
| Sale page membership and ordering | Works |
| Scheduling windows | Works, invisible to the storefront |
| **Customer actually pays the sale price** | **Blocked** — needs a two-line change in `CartPage` / `OrderPage` to price from `salePrice ?? price` |

Until that edit, the Sale screen shows a persistent warning on every on-sale row: *displayed only, not charged*. Shipping without that warning would let the owner believe she had run a promotion she had not.

A related trap for the serializer: `ShopPage.jsx:242-251` sorts low-to-high and high-to-low on `p.price`, and `:225-227` range-filters on `p.price`, so sale products sort and filter at their pre-discount price. That is storefront behaviour and the API must not paper over it by emitting a discounted `price` — that would break the strikethrough. Noted in the admin UI, fixed later alongside the same checkout edit.

#### B.2 Level 2 [NEXT] — discounts and coupons, built dark

```
Discount {
  id, code                  // uppercase, unique, matched case-insensitively
  type                      PERCENT | FIXED_AMOUNT
  value                     // percent 1-90, or paise
  maxDiscountPaise?         // caps PERCENT: 30 percent on a Rs 12,000 tote is Rs 3,600 otherwise
  minOrderPaise?
  usageLimitTotal?  usageLimitPerCustomer?  usedCount
  startsAt  endsAt?
  targetType                ALL | SUBCATEGORY | PRODUCT
  targetIds[]               // subcategory slugs or product ids
  firstOrderOnly            Boolean
  status                    DRAFT | ACTIVE | PAUSED | EXPIRED
}
DiscountRedemption { id, discountId, orderId, customerEmail, amountPaise, redeemedAt }
```

**Stacking: exactly one discount per order, full stop.** `FREE_SHIPPING` is **cut to [LATER]** rather than carved out as a stackable type, because shipping is computed client-side in two files and the cart already charges zero — a free-shipping code would be either a no-op or a lie. It returns when shipping rules become server-owned. Removing it removes the `stackable` flag entirely.

Sale price and a coupon do **compose** (the coupon applies to the already-discounted subtotal). That is pricing precedence, not stacking, and the create form states it in plain words, because "20 percent off" landing on an already-reduced bag is the classic merchant surprise.

**Concurrency.** `usedCount` is incremented inside the order transaction with a conditional `WHERE usedCount < usageLimitTotal`, exactly the stock-guard pattern; a limited launch code shared on Instagram is redeemed concurrently and read-then-increment overshoots. `usageLimitPerCustomer` keys on `customerEmail` from the shipping details, since no server-side customer session exists at checkout.

**Re-pricing is mandatory.** There is no server-side cart — `CartContext` is `localStorage "niya_cart"` — so validation accepts a client-supplied line list and **re-prices every line from the database**, ignoring posted prices entirely. Not defence in depth; the only defence.

**Blocking status: nothing can be redeemed today, and most blockers are outside `src/api/*.js`.**

| Needed | Where | In cutover scope? |
|---|---|---|
| Code input calls a real validate endpoint | `CartPage.jsx:191-209` (a literal comparison today) | No |
| Discount survives into checkout totals | `OrderPage.jsx:76-82`, which never sees the promo | No |
| `discountCode` + `discountAmount` in the payload | `OrderPage.jsx:114-138` | No |
| Admin-controlled shipping threshold | `OrderPage.jsx:82` **and** `CartPage.jsx:164` | No |
| Order reaches a server at all | `OrderPage.jsx:144` | Yes |

Level 2 therefore ships **dark**: model, CRUD, admin UI, validate endpoint and redemption ledger, exercised by the admin's own test harness, redeemable by nobody until checkout is touched. The discounts screen says so on the page, not in a footnote.

**Create-discount form** — one scrolling RHF + zod `Form` (one schema shared by client and route handler) in four `Card` sections: *Code* (auto-generate, live uniqueness check), *Value* (`RadioGroup` driving conditional fields; `maxDiscountPaise` appears only for PERCENT), *Conditions* (min order, limits, `firstOrderOnly`), *Targeting and schedule* (`Command` multi-select over `handbags / minibags / sling / tote / wallet` or products, `Calendar` range). A sticky rail shows a live worked example — "Cart Rs 5,998, discount Rs 1,200, shipping Rs 0, pays Rs 4,798" — badged *simulation* until redemption is live.

#### B.3 Level 3 [LATER] — campaigns

A `Campaign` groups `{ heroBannerId?, promoBannerIds[], campaignSpotlight?, discountId?, startsAt, endsAt, utmCampaign }` behind one date range and one switch. It maps onto `homeData.js` exactly: `heroBannersData`, `promoBannersData` (already `page` + `position` targeted: home/shop/wishlist by after-hero/after-products) and `campaignData`. Blocked by the `contentApi.js` cutover — that file is entirely commented out and its endpoint names (`hero-banners`, `promo-banners`, `campaign`) already match these objects. Conceptually free, mechanically gated.

**One genuinely free win.** `axiosClient.js:11-12` reads `VITE_MOCKOON_API_BASE_URL` from env, and `notFoundApi.js` already makes a **real HTTP call** to `/not-found-bags` on that instance — which today points at `http://localhost:3001` and therefore fails in production. Serving that endpoint from the admin API needs **an env var change on the storefront's Vercel project and zero file edits**. It is the natural canary for the whole cutover: one real endpoint, one merchandised surface (which bags the 404 page promotes), proving CORS, caching and payload shape before anything important moves.

#### B.4 Sale-page control and misconfiguration guards

`/marketing/sale` is a two-panel screen: candidates on the left, on-sale products on the right in `saleRank` order with `dnd-kit` drag-to-reorder, each row showing price, sale price, computed percent, schedule and **available stock**.

| Guard | Rule | Behaviour |
|---|---|---|
| Sale price too high | `salePrice >= price` | Block save — would render "0 percent OFF" or a higher sale price |
| Non-positive | `salePrice <= 0` | Block |
| Below cost | `salePrice < costPrice` | Warn and confirm; skipped when `costPrice` is null |
| Extreme discount | computed percent > 70 | Warn and confirm — catches a paise/rupee unit slip |
| Inverted window | `endsAt <= startsAt` | Block |
| Overlapping schedules | two SCHEDULED windows on one product | Block |
| On sale, no stock | `available <= 0` | Warn — the storefront has no sold-out badge, so it will advertise an unbuyable bag |
| No images | variant `images[]` empty | Warn — `ProductCard.jsx:20-26` falls back through `thumbnail`, `images[0]`, `variants[0].images[0]` to `""` |
| Empty sale | zero on-sale products | Info — `SalePage.jsx:76` renders "No sale products available right now." |
| Percentage drift | stored `discountPercentage` | Eliminated by design — computed at serialization |
| Not charged | any on-sale product, pre-cutover | Persistent banner — display only, the customer still pays `price` |

#### B.5 Marketing API

| Method + path | Purpose |
|---|---|
| `GET / POST / PATCH /api/admin/discounts`, `/:id` | CRUD, validation shared with the client schema |
| `POST /api/admin/discounts/:id/status` | Activate, pause, expire |
| `GET /api/admin/discounts/:id/redemptions` | Ledger, CSV export |
| `GET /api/admin/discounts/:id/performance` | Metrics in B.6 |
| `PATCH /api/admin/products/:id/sale` | Set or clear sale price, optional window |
| `POST /api/admin/products/bulk-sale` | Percent-off or fixed across a selection |
| `PATCH /api/admin/products/sale-order` | `saleRank` reorder |
| `POST /api/storefront/discounts/validate` | Public; re-prices supplied lines server-side. Built now, called by nobody until checkout changes |

Public storefront reads (`/api/storefront/products`, `/products/:id`, `/products/:id/suggestions`, `/categories`, `/not-found-bags`) keep the shapes the commented-out axios code already expects, are unauthenticated and cacheable, and are CORS-allowlisted to the storefront's production and preview origins — the two projects are separate Vercel deployments on separate domains.

#### B.6 Discount performance — what is honestly measurable

Measurable from the redemption ledger and orders, **once orders reach the API**:

| Metric | Source |
|---|---|
| Redemptions, unique customers, remaining uses | `DiscountRedemption` |
| Total discount given | `SUM(amountPaise)` |
| Revenue on discounted orders, AOV with and without | join `Order` |
| Units of targeted products in redeeming orders | order lines |
| COD versus ONLINE split | `paymentMethod` on the order |
| Cancellation and RTO rate on discounted orders | order status |

**Not measurable, and the UI says so instead of faking it:** impressions, CTR, view-to-purchase, incrementality (no control group), cannibalisation, and attribution for any banner campaign carrying no coupon. There is no analytics, pixel or click tracking anywhere in the repo, and this section does not add one. The performance view carries a fixed note — *Attribution: coupon code only* — and, until cutover, a second one: *No orders have reached this system yet.*

One free lever: `heroBannersData` and `campaignData` already hold `buttonLink` as a plain string, so UTM-tagging campaign links needs zero storefront change, and a GA4 or Plausible property added later reads them immediately.

---

### C. Cutover checklist for this section

Ordered by risk, and honest about which steps leave the mechanical `src/api/*.js` scope.

| Step | Change | Scope |
|---|---|---|
| 1 | Point `VITE_MOCKOON_API_BASE_URL` at the admin API so `/not-found-bags` is served for real | **Env var only, no file edit** |
| 2 | Uncomment the axios bodies in `productApi.js`; point `VITE_API_BASE_URL` at the admin API | Inside `src/api/*.js` |
| 3 | Uncomment `contentApi.js` for banners, campaign and announcements | Inside `src/api/*.js` |
| 4 | Uncomment `// await createOrder(orderPayload)` | Inside `src/api/*.js`, but see 5 |
| 5 | Price cart and checkout from `salePrice ?? price`; carry `discountCode` and `discountAmount`; read the shipping threshold from the API | `CartPage.jsx`, `OrderPage.jsx` — **outside** cutover scope |
| 6 | Replace the hardcoded `NIYA10` branch with the validate endpoint | `CartPage.jsx:191-209` — outside |
| 7 | Render availability: sold-out badge, quantity cap, "In stock" filter option | `ProductCard`, `ProductDetails`, `ShopPage` — outside |
| 8 | Fix the same-product replacement branch so two variants coexist | `CartContext.jsx:86-107` — outside |

Steps 1 to 4 are the mechanical cutover this blueprint promises. Steps 5 to 8 are a separate, explicitly scoped storefront ticket. Nothing in this section claims a customer-visible effect that depends on 5 to 8 having happened.

**Decisions**

- FIX: Corrected the draft's central variant-id claim. Emitting stable `variants[].id` does fix quantity-merge via the already-written `selectedVariant?.id` branch, but `CartContext.jsx:86-107` still deletes existing lines for the same productId when a second variant is added, so Black/Brown remain last-wins. Restated as necessary-but-not-sufficient and logged as an out-of-scope storefront ticket.
- FIX: Added the biggest missed fact - sale price is never charged. `CartPage.jsx:133-137` and `OrderPage.jsx:76-80` both price from `price`, and `enrichedProducts.finalPrice` is computed but unused. The draft's 'Level 1 is blocked by nothing except the cutover' is false; replaced with a per-capability blocking table and a persistent 'displayed only, not charged' warning on the Sale screen.
- FIX: Added the coupon UI that already exists. `CartPage.jsx:30-32,185-209,692-736` implements a hardcoded client-side NIYA10 at 10 percent, advertised in its own placeholder, unlimited and unexpirable, and ignored by OrderPage. The draft claimed no code input exists. Added a legacy-code banner and scoped the real blocker to CartPage.jsx:191-209.
- FIX: Corrected the shipping fact. The threshold is hardcoded in two files, not one - CartPage.jsx:164 (FREE_SHIPPING_LIMIT=2000, then estimatedShipping = 0 unconditionally) and OrderPage.jsx:82 (Rs 100 under Rs 2000) - so cart and checkout totals already disagree today.
- FIX: Demoted FREE_SHIPPING to [LATER] and deleted the `stackable` flag entirely. Shipping is client-computed in two files and the cart already charges zero, so a free-shipping code would be a no-op or a lie. The stacking rule is now simply one discount per order.
- FIX: Removed the 'In stock' filter freebie. The draft implied the existing availabilityFilter could gain the option post-cutover; the option list is hardcoded at ShopPage.jsx:549-553 with branches at :210-228, so it is a component edit outside src/api/*.js.
- FIX: Corrected the discount-drift severity. All 10 on-sale products currently have stored == computed percentage, so the bug is latent, not a live mispricing. Sharpened it instead: ProductCard.jsx:37-41 prefers the stored value while ProductDetails.jsx:138-143 always recomputes, so card and PDP diverge the moment an admin edits salePrice. 'Never store discountPercentage' is kept as the fix for both surfaces.
- FIX: Resolved a self-contradiction - the draft made the computed `available` column inline-editable while declaring it never stored. The editable cell is now `onHand`, with `available` read-only. Also specified that version-based CAS applies to Set-to edits only, since delta edits are commutative.
- FIX: Deleted the abandoned-payment TTL sweeper, which assumed a payment gateway that does not exist (ONLINE is a radio label only). Replaced with a stale-reservation report (orders in PLACED beyond N days) plus explicit admin cancel-and-release.
- FIX: Stated plainly that no order can reach the reservation transaction until OrderPage.jsx:144 is uncommented, so on day one the only thing that moves stock is an admin adjustment and the oversell guard protects nothing yet.
- FIX: Added a second public identifier the draft missed - ProductVariant.name is the colour facet key (ShopPage.jsx:201-207) and part of the wishlist key (WishlistContext.jsx:29-31), so an admin rename breaks shared filter URLs and device-local wishlists. Added a rename guard, plus the rule that existing product ids are preserved verbatim because they key routes, cart and wishlist.
- FIX: Over-engineering cuts - Location table and its WAREHOUSE/STORE/TRANSIT enum demoted to [LATER] (only the locationId column and unique constraint kept), backorderPolicy demoted (the storefront cannot render a backorder message), nightly reconcile reduced to weekly over 78 rows, retail-valuation KPI dropped.
- FIX: The draft's KPI row said 'Card x 5' then listed six. Committed to exactly five tiles and swapped in Units reserved, the number a COD owner needs at picking time.
- FIX: Replaced estimated scale with counted scale - 39 products, ~78 variants, subcategory and gender splits counted from products.js - so every sizing argument rests on real numbers.
- FIX: Added the endpoint tables the brief asked for and the draft omitted (admin inventory API, marketing API, public storefront reads), plus the CORS and separate-deployment note, plus an explicit server-first RSC-for-lists / client-query-for-mutations statement matching the blueprint direction.
- FIX: Added the seeding path - a committed JSON snapshot under admin_panel/prisma/seed/, never a cross-folder import, so the two deployments share no module graph.
- FIX: Compressed code creep - the StockMovement code block became an entity table, and the conditional-UPDATE guard is described inline as a Prisma updateMany count check rather than SQL.
- FIX: Added section C, a file-by-file cutover checklist marking which steps are inside src/api/*.js and which are not, and identified the one genuinely zero-edit win: /not-found-bags already makes a real HTTP call on an env-driven base URL, so the admin can serve it with an env var change alone - the natural canary for the cutover.
- Committed: money in integer paise, half-up rounding to whole rupees at the discount and shipping level (never per line), serializer emits integer rupees so the storefront's toLocaleString('en-IN') output is unchanged.
- Committed: delta is never zero - a Set-to edit matching the current value is a server no-op, not a zero-delta ledger row.

**Open assumptions**

- Postgres + Prisma is the persistence layer, as the data/API section commits. This is a hard requirement of the oversell guard and the ledger-plus-cache invariant, not a preference; a document store without multi-document transactions breaks the design.
- costPricePaise does not exist in any storefront data and will be owner-entered per variant. Until every variant has one, the cost-valuation KPI renders an em-dash with a CTA rather than a misleading number.
- SKUs do not exist today. The admin suggests NB-<SUBCAT3>-<NNN>-<COLOUR3> derived from the existing product id; the owner can override before first use, after which SKU is treated as stable.
- Opening stock is seeded by the owner through the bulk CSV stock-take (sku,delta,reason) recorded as `purchase` movements. There is no supplier or PO system in scope.
- Default lowStockThreshold of 3 and the existing Rs 2,000 free-shipping threshold are starting values the owner tunes. Confirm the owner accepts that the shipping threshold stays hardcoded in the storefront (two files) until step 5 of the cutover checklist is scheduled.
- Order status vocabulary beyond the storefront's single 'ORDER PLACED' value is owned by the orders section. A.5 consumes the first transition past PLACED as the fulfilment trigger and must stay in sync with whatever that section commits to.
- The legacy hardcoded NIYA10 coupon stays live and uncontrollable until CartPage is edited. Confirm whether the owner wants it mirrored in the admin as a read-only legacy row or simply flagged in a banner.
- Whether the storefront will call the admin's domain directly or through a proxy path - it determines the CORS allowlist and cookie posture for the otherwise unauthenticated public read endpoints.

**Risks**

- The largest risk is expectation, not engineering: the owner will use the inventory and sale screens on day one and see zero effect on the live site. Every affected screen needs its blocking banner in the first release, not added later.
- Steps 5 to 8 of the cutover checklist touch CartPage, OrderPage, ProductCard, ProductDetails, ShopPage and CartContext. That is a real storefront work package, and the 'only src/api/*.js changes' framing holds for reads but not for pricing, discounts or availability rendering. If that package is never scheduled, Level 2 never redeems anything and sale prices are never charged.
- Cart and wishlist live in each device's localStorage. Once variant ids ship, existing cart lines keyed by bare productId coexist with new composite keys; stale lines resolve oddly and cannot be migrated from the server. Expect a one-time cart oddity at cutover.
- getCartProduct (CartPage.jsx:78-96) splits the cart id on '-' and takes the first segment, which for ids like handbag-001 yields 'handbag' and only matches through its second fallback condition. Any change to the emitted product id shape breaks cart rendering silently.
- ShopPage sorts and range-filters on `price`, not the effective price, so a deeply discounted bag sorts as if full price. Fixing it is a component edit; leaving it makes the Sale page and the Shop page tell different stories.
- Interactive Prisma transactions with row locks on serverless Vercel functions need a pooled connection that supports them; a naive PgBouncer transaction-mode setup will fail the oversell guard under exactly the concurrency it exists to handle.
- orderCount and createdAt are static product fields today and drive best-sellers and the 30-day new-arrivals window. Once the admin owns products, an imported or edited createdAt silently changes storefront merchandising with no admin affordance saying so.
- Reserve-on-placement plus COD means reservations accumulate against orders that may never be paid. With one owner and no auto-sweeper, the stale-reservation report is the only thing preventing slow phantom stockouts, and it depends on someone reading it.
- The ledger is only as true as the manual counts feeding it. With no barcode scanning and one person adjusting stock between packing orders, MANUAL_FIX will dominate the movement history, and the weekly recount compares the ledger to itself, not to the shelf.

---

## Analytics Architecture

### 0. The honest starting position

Every number here is computed inside the admin panel, from the admin panel's own Postgres. Nothing in this section reads, calls, or depends on `e-commerce_frontend-main/`, and nothing here changes a file in it.

#### 0.1 Verified facts (read from the repo, not assumed)

| Fact | Evidence | Consequence for analytics |
|---|---|---|
| Orders never reach a server | `OrderPage.jsx:144` `// await createOrder(orderPayload);` — and its import at line 20 points at `../api/orderApi`, a file that **does not exist** in `src/api/` | No order history exists. The orders cutover needs a *new* storefront file, not merely an uncomment |
| Orders go to the shopper's own browser | `OrderPage.jsx:162-169` writes `localStorage["niyaOrders"]`; only `MyOrders.jsx:15` reads it | Real customer orders sit on **customers' devices**, unreachable by the merchant (see 0.4) |
| One status value | `OrderPage.jsx:159` `status: "ORDER PLACED"`; `MyOrders.jsx:97` defaults to the same string | The admin owns the real lifecycle; the legacy string maps to `PLACED` |
| Hard shipping cliff | `OrderPage.jsx:82` — `subtotal >= 2000 || subtotal === 0 ? 0 : 100` | Rs 100 below Rs 2,000, free at Rs 2,000 and above. Makes the threshold histogram a genuinely store-specific metric |
| **Checkout ignores sale price** | `CartPage.jsx:130-138` and `OrderPage.jsx:76-80` both total on `product.price`; `salePrice`/`finalPrice` is display-only (`ProductDetails.jsx:115`) | Legacy order lines carry the **list** price. Discount metrics are undefined for imported rows and must be excluded, not inferred |
| Variants have no id | variants are `{name, images[]}`; `CartContext.getVariantKey` (line 31) reads `selectedVariant?.id`, always `undefined` | Cart key collapses to `productId`. **But** the whole `selectedVariant` object is persisted into the cart item and the order payload, so the colour **name** survives. Per-colour analytics is possible by name, exact by id only after the admin issues variant ids |
| `state` and `email` are optional | `OrderPage.jsx:95-104` validates only `fullName, phone, address, city, pinCode` | Geography metrics must tolerate NULL/blank state; phone is the only always-present identity field, and it is unvalidated free text |
| No instrumentation at all | `index.html` has no analytics tag; `SearchOverlay`, `WishlistContext`, `CartContext` are pure client state | Every traffic/funnel metric is impossible today, and stays impossible until a storefront change we are not making now |

#### 0.2 The one thing this section must not pretend

The admin panel cannot see, change, or measure the live storefront. It owns its own database and API. Until `src/api/*.js` is repointed — a **later, separate, mechanical step** confined to that folder, plus one new `orderApi.js` — the only rows in the analytics database are:

1. **Orders the admin keys in manually** (WhatsApp / Instagram DM / phone orders). This is the realistic day-one data source, and it means the dashboard must be *correct and calm at n = 3 orders/day*, not just at scale.
2. **Optionally imported rows** from a `niyaOrders` dump on a device the merchant controls (0.4).
3. **Mock rows**, flagged and filtered (section e).

Analytics is therefore built to be *true from the first order*, not built to wait for a pipeline.

#### 0.3 Three upstream schema decisions everything below depends on

| Decision | Rule | What breaks without it |
|---|---|---|
| Money | Integer **paise** in `BIGINT`. Rs 2,999 → `299900`. Never `FLOAT`/`NUMERIC`-as-float | Float sums drift; totals stop reconciling |
| Line snapshot | `OrderItem` freezes `unitPricePaise`, `compareAtPricePaise`, `lineDiscountPaise`, `productId`, `variantId`, `variantNameSnapshot`, `titleSnapshot`, `subcategorySnapshot` at write time | The storefront sends no subcategory and re-resolves price from the live product; a later `price` edit would silently rewrite history |
| Variant identity | `ProductVariant.id` is stable and server-issued | Per-colour revenue is name-matched guesswork forever |

Two more fields the analytics section requires on `Order` and that the data-model section must carry:

- `source: STOREFRONT | ADMIN_MANUAL | IMPORTED` — lets every panel say where a number came from, and lets discount metrics exclude `IMPORTED`.
- `placedAtPrecision: EXACT | APPROX` — imported rows whose timestamp was reconstructed (0.4) are `APPROX` and are excluded from intraday and hour-of-day views.

Canonical lifecycle, owned by the orders section, consumed here:

`PLACED, CONFIRMED, PACKED, SHIPPED, OUT_FOR_DELIVERY, DELIVERED, CANCELLED, RTO_IN_TRANSIT, RTO_RECEIVED, RETURN_REQUESTED, RETURNED, REFUNDED`

`RTO` (return to origin — a COD parcel refused at the door) is not Amazon-envy: it is the largest revenue leak in Indian COD retail and is structurally different from a customer-initiated return.

#### 0.4 Backfill: what is actually recoverable

The draft assumption that the merchant can hand over a `niyaOrders` dump is **wrong for real orders**. That key is written in each *shopper's* browser and never transmitted; there is no email, no webhook, no server copy. Real customer orders placed through this storefront are unrecoverable, period.

So backfill is demoted to a small, honest tool, not a day-one pipeline:

- **Primary path: manual order entry in the admin.** The merchant re-keys whatever they have (a register, WhatsApp threads). Orders created this way are `source: ADMIN_MANUAL`, `isMock: false`.
- **Secondary path `[LATER, small]`: a paste-a-JSON-array importer** on `/settings/import`, for a `niyaOrders` dump from a device the merchant *does* control (their own test/demo phone or laptop). One screen, dry-run preview, idempotent on `orderId`.
- **Timestamp rule.** Do **not** parse `date: new Date().toLocaleString("en-IN")`. It is the *shopper's device* wall clock (not necessarily IST), day-first, and its exact shape — including a narrow no-break space before `pm` — varies by browser ICU version. Instead parse the epoch out of `orderId` (`NIYA-${Date.now()}`, `OrderPage.jsx:153`), which is an exact UTC instant. If `orderId` is malformed, fall back to a strict day-first parse with a timezone selector in the import UI (default `Asia/Kolkata`) and mark the row `placedAtPrecision: APPROX`.
- **Imported line rule.** `unitPricePaise = price` from the payload (a list price), `compareAtPricePaise = unitPricePaise`, `lineDiscountPaise = 0`, `variantId = NULL`, `variantNameSnapshot = selectedVariant.name`. `subcategorySnapshot` is resolved by joining `productId` to the admin's product table at import; unresolved ids land in `subcategorySnapshot = 'unknown'` rather than being dropped.

Also: checkout `state` is free-text and optional. Any geography metric needs an ingest-time normalisation map (28 states + 8 UTs, plus common misspellings and blank), or it is garbage.

---

### (a) Metric catalog

**Feasibility tags.** `[READY]` — computable the moment orders exist in the admin DB, including manually entered ones. `[NEEDS-HISTORY]` — mechanically simple, epistemically worthless before ~6 months. `[NEEDS-SCHEMA]` — blocked on a product field that does not exist anywhere today. `[NEEDS-EVENTS]` — blocked on storefront instrumentation that does not exist and is not being built now. `[N/A]` — not applicable to this store; must never be faked.

#### Revenue and orders

| Metric | Formula | Source | Granularity | Tag |
|---|---|---|---|---|
| Placed GMV | `SUM(totalAmountPaise)` where `status <> CANCELLED` | `Order` | day/week/month, range | `[READY]` |
| Merchandise revenue | `SUM(unitPricePaise * quantity)` — excludes shipping | `OrderItem` | day, product, subcategory | `[READY]` |
| Shipping revenue | `SUM(shippingFeePaise)` | `Order` | day, range | `[READY]` |
| **Net revenue (headline)** | `SUM(totalAmountPaise) WHERE status = DELIVERED` − `SUM(refundedAmountPaise)` | `Order` | day/week/month | `[READY]` |
| Realisation rate | net revenue ÷ placed GMV | derived | range | `[READY]` |
| Orders placed | `COUNT(*)` where `status <> CANCELLED` | `Order` | day/week/month | `[READY]` |
| AOV / Net AOV | placed GMV ÷ orders; net revenue ÷ delivered orders | derived | range | `[READY]` |
| Units sold | `SUM(quantity)` | `OrderItem` | day, product, variant | `[READY]` |
| Basket size | units ÷ orders | derived | range | `[READY]` |

**Headline commitment.** The hero tile is **Net Revenue (delivered − refunds)**; Placed GMV is a secondary tile with the realisation rate shown as a delta between them. For a COD-heavy Indian store a `PLACED` order is a promise, not money. A dashboard whose hero number is placed GMV overstates the business by roughly the RTO rate every day. *Caveat printed in the UI:* while volume is tiny and statuses are advanced by hand, both tiles are shown at equal visual weight, because a merchant who hasn't yet marked anything `DELIVERED` would otherwise stare at Rs 0.

**Attribution commitment.** Revenue is attributed to `Order.placedAt` (the day the order was taken), keeping cause and effect on the same day. A **Cash view** toggle re-attributes to `deliveredAt` for cashflow questions. The active mode is printed in every chart subtitle — leaving it ambiguous is the classic silent-wrongness bug, and it is precisely why a delivery confirmed six days later mutates a past day's net revenue (the reason the `[LATER]` rollup rebuild window is 35 days, not 1).

#### Customers

Identity first. Checkout is **guest-capable** and requires no login, so the key is not `userId`.

`customerKey = normalised E.164 phone (+91XXXXXXXXXX)`, lowercased email as fallback, `userId` linked opportunistically when the order was placed while authenticated. Phone is primary because it is required at checkout (`OrderPage.jsx:95-104`), delivery-critical, and courier-validated; email is optional and often blank. Normalisation (strip spaces/hyphens, drop `0`/`91`/`+91` prefixes, reject non-10-digit) happens once at ingest, in the order service, not in analytics queries.

| Metric | Formula | Granularity | Tag |
|---|---|---|---|
| New vs returning orders | new = no earlier `placedAt` for that `customerKey` | day, range | `[READY]` |
| New customers | distinct `customerKey` whose first order falls in range | day, range | `[READY]` |
| Top customers by net revenue | rank `customerKey` | range, top 20 | `[READY]` |
| Geography mix | net revenue and orders by normalised `state`, then top 3-digit pin prefixes | range | `[READY]` |
| Repeat purchase rate | customers with ≥2 delivered orders ÷ customers with ≥1, on a cohort acquired ≥90 days before range end | 30/60/90-day cohort | `[NEEDS-HISTORY]` |
| Realised CLV | net revenue ÷ distinct customers, per acquisition-month cohort | monthly cohort | `[NEEDS-HISTORY]` |
| Purchase frequency | delivered orders ÷ distinct customers | range | `[NEEDS-HISTORY]` |
| Predicted CLV | **do not build.** No BG/NBD, no arbitrary multiplier on ~40 SKUs | — | `[N/A]` |

Repeat rate and CLV stay behind the insufficient-data state (section d) until 90 days and 3 cohorts exist. Printing `CLV: Rs 2,999` off one order is how dashboards start lying.

#### Products, categories, inventory

| Metric | Formula | Source | Tag |
|---|---|---|---|
| Top products by revenue / units | group `OrderItem` by `productId`, delivered-only toggle | `OrderItem` | `[READY]` |
| Top colours | group by `variantId`, falling back to `variantNameSnapshot` | `OrderItem` | `[READY]` (exact after variant ids) |
| Top subcategories | group by `subcategorySnapshot` — handbags, minibags, sling, tote, wallet | `OrderItem` | `[READY]` |
| Gender split | group by `Product.gender` (women/men) | `Product` | `[READY]` |
| Never-sold products | `Product LEFT JOIN OrderItem` with zero rows in range | both | `[READY]` |
| Discount impact | `SUM((compareAtPricePaise − unitPricePaise) * qty)`; rate = that ÷ `SUM(compareAtPricePaise * qty)`. **Excludes `source = IMPORTED`** | `OrderItem` | `[READY]` |
| Discounted vs full-price split | partition lines on `lineDiscountPaise > 0` | `OrderItem` | `[READY]` |
| Sell-through | units ÷ (units + stock on hand at period end) | needs `stockOnHand` | `[NEEDS-SCHEMA]` |
| Inventory turnover | COGS ÷ average inventory at cost | needs `stockOnHand` + `costPricePaise` | `[NEEDS-SCHEMA]` |
| Gross margin | `(unitPrice − costPrice) * qty` | needs `costPricePaise` | `[NEEDS-SCHEMA]` |
| Days of cover | `stockOnHand` ÷ trailing 28-day daily units | needs stock | `[NEEDS-SCHEMA]` |
| Low-stock count | `stockOnHand <= lowStockThreshold` | needs stock | `[NEEDS-SCHEMA]` |
| Coupon / campaign performance | no coupon entity exists; `SalePage.jsx` merely filters `isOnSale` | — | `[N/A]` |

`src/data/products.js` has no sku, stock, cost price, status or `updatedAt`. Until the admin's product model adds `sku`, `costPricePaise`, per-variant `stockOnHand` and `lowStockThreshold`, the Inventory panel shows exactly one card — *"Inventory tracking is not enabled. Add stock levels to products to unlock sell-through, cover and turnover."* — not a zero, not a greyed chart.

#### Fulfilment and payment (the India-specific ones that earn their place)

| Metric | Formula | Granularity | Tag |
|---|---|---|---|
| COD vs online split | count and value by `paymentMethod IN (COD, ONLINE)` | day, range | `[READY]` |
| COD RTO rate | `status IN (RTO_IN_TRANSIT, RTO_RECEIVED)` ÷ COD orders shipped | month cohort by ship date | `[READY]` |
| Cancellation rate | `CANCELLED` ÷ orders placed, split pre-ship vs post-ship | day, range | `[READY]` |
| Return rate (units / value) | returned units ÷ delivered units; refunds ÷ net delivered revenue | range, per product | `[READY]` |
| Refund total | `SUM(refundedAmountPaise)` | day | `[READY]` |
| Fulfilment latency | p50/p90 hours `placedAt→shippedAt` and `shippedAt→deliveredAt` | weekly | `[READY]` |
| Free-shipping cliff effect | histogram of `subtotalPaise` in Rs 250 buckets with a reference line at Rs 2,000, plus share of orders landing Rs 1,750–1,999 | range | `[READY]` |
| Online payment success rate | **no gateway is integrated** — `ONLINE` is a radio option with nothing behind it; the admin marks such orders paid manually | — | `[N/A]` |

The cliff histogram is one SQL query and tells the merchant whether the Rs 2,000 threshold is pulling baskets up or leaving money on the table. It is the highest value-per-line metric in this catalog.

#### The impossible ones

| Metric | Why |
|---|---|
| Conversion rate, sessions | The storefront emits nothing. `index.html` has no analytics tag |
| Cart abandonment | Cart is `localStorage["niya_cart"]` via `CartContext`; `cartApi.js` exists but is never called. The server has never seen a cart |
| Traffic sources / UTM | No referrer or UTM capture anywhere |
| Product views, view-to-cart, add-to-cart rate | `ProductDetails.jsx` renders a local array; `addToCart` is a React state update |
| Search analytics | `SearchOverlay.jsx` substring-filters the local array; queries never leave the browser |
| Wishlist analytics | `WishlistContext` writes device-local, anonymous `localStorage["niyaWishlist"]` |

**`[LATER]` — how these get unlocked, cheapest first.** When the merchant wants traffic and funnel data, the correct first move for a one-person, ~40-SKU store is **not** a bespoke event pipeline: add **Vercel Web Analytics or GA4 to the storefront** — one script tag, in the storefront repo, as its own separate change — and read sessions, sources and funnel there. Build the custom pipeline *only* when the merchant needs events joined to `Order` rows in this database (e.g. "which colour page view converts").

If and when that day comes, the design is deliberately minimal: one new storefront file `src/api/eventsApi.js` emitting from existing context effects, six event types (`page_view`, `product_view`, `add_to_cart`, `remove_from_cart`, `begin_checkout`, `order_placed`), one batched endpoint `POST /api/v1/events` (sendBeacon, ≤20 per flush, fire-and-forget), and **one plain Postgres table** `analytics_event` with `(session_id, ts)` and `(type, ts)` indexes and a 13-month delete job. No partitions until the table passes ~10M rows; at an expected 10⁴–10⁵ events/month that is years away. No ClickHouse, no Segment, no Mixpanel. Funnel = `product_view → add_to_cart → begin_checkout → order_placed`, per session. Because UTM and referrer would be stored, a consent notice ships with it (DPDP Act 2023 makes purpose-limited notice the safe default). All of this is a storefront change and therefore out of scope for the current deliverable.

---

### (b) Date range control and the Asia/Kolkata problem

#### Presets

| Preset | Range (IST calendar days, inclusive) | Default comparison |
|---|---|---|
| Today | today 00:00 IST → now (partial) | Yesterday, same elapsed slice |
| Yesterday | full previous IST day | Day before |
| Last 7 days | D-6 … D (includes today, partial) | D-13 … D-7 |
| Last 30 days | D-29 … D (partial) | D-59 … D-30 |
| This month | 1st … D (partial) | Same day-count window last month |
| Last month | full previous calendar month | Month before |
| Custom | any two IST dates, max span 730 days | Immediately preceding equal-length window |

`Last 7`/`Last 30` deliberately include today, badged **Partial** — merchants open the dashboard to see *today's* trading. `Last 7` is weekday-aligned by construction; `Last 30` drifts by two weekdays and is labelled as such rather than silently corrected.

#### Comparison toggle

Two modes: `previous_period` (default) and `previous_year` (same calendar dates). Three delta rules, all commonly botched:

1. Prior value `0` → render an em dash with the tooltip *"no data in comparison period"*. Never `+100%`, never `Infinity`, never `NaN`.
2. Range includes today → badge **Partial**; for the `Today` preset compare against the matching elapsed slice of yesterday, for multi-day presets compare whole periods and say so. Comparing 6.4 days against 7 without labelling it is the most common dashboard lie.
3. Direction is metric-aware: rising RTO or cancellation rate is **red**. Each metric descriptor carries `goodDirection: 'up' | 'down' | 'neutral'`; nothing hardcodes green-for-positive.

#### Timezone: store UTC, bucket and render in IST

IST is UTC+05:30 with no DST. The half-hour offset is exactly what breaks naive code — a bug a whole-hour offset would hide for 23 hours a day.

**Day boundaries are computed in Postgres, in one module, in the query layer. Never in the browser.**

- **Storage:** every timestamp is `timestamptz` (UTC instants). No local time is ever persisted.
- **Bucketing:** `date_trunc('day', "placedAt" AT TIME ZONE 'Asia/Kolkata')::date AS day_ist`.
- **Filtering, in the opposite direction:** `"placedAt" >= (:from::date::timestamp AT TIME ZONE 'Asia/Kolkata') AND "placedAt" < ((:to::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`. Half-open, never `BETWEEN` (which loses the last 0.999 s of the final day), and **sargable** — the column is never wrapped in a function on the left-hand side, so `orders(placed_at)` stays usable.
- **Wire contract:** date-only IST calendar dates plus a preset id — `?preset=last_30&compare=previous_period` or `?from=2026-09-01&to=2026-09-04`. The client never sends instants and never derives boundaries from its own clock; otherwise the merchant checking from Dubai sees different totals than the one in Delhi.
- **Server-side "today":** resolving a preset to two IST dates is the one piece of TZ math outside SQL. It uses `@date-fns/tz` (`TZDate`, `Asia/Kolkata`) in `server/analytics/range.ts` and nowhere else. Bare `date-fns` `startOfDay()` is banned: Node on Vercel runs `TZ=UTC`, so it returns 05:30 IST and every "today" figure silently loses five and a half hours.
- **Rendering:** `Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata' })` and `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })` — lakh/crore grouping (`₹12,34,567`) is what the merchant expects. KPI tiles drop paise; tables and CSV keep two decimals.
- **One escape hatch:** `NIYA_REPORTING_TZ` (default `Asia/Kolkata`), read only inside `range.ts`. Hardcoding the string across query files is how a future region change becomes a migration.

---

### (c) Query strategy

**Committed: on-the-fly SQL aggregates. No rollup tables, and no caching layer either.**

The arithmetic is decisive. ~40 SKUs at an optimistic 50 orders/day is ~18k orders and ~40k lines a year. `GROUP BY day_ist` over 40k rows with a b-tree index is single-digit milliseconds. A rollup pipeline buys a backfill job, a late-arrival problem, a rebuild window and a permanent class of "the dashboard disagrees with the orders list" bugs, to save 8 ms. The same argument kills the response cache: a 5-minute cache with tag invalidation is *also* pure complexity debt at 8 ms, and it introduces the exact staleness confusion a one-person shop cannot debug. Server Components fetch live on every render; Suspense covers latency.

| Technique | Detail |
|---|---|
| Indexes | `orders(placed_at DESC)`, `orders(status, placed_at)`, `orders(customer_key, placed_at)`, `order_items(order_id)`, `order_items(product_id)`. That is all — no partial/covering indexes until a plan says otherwise |
| Query shape | One CTE-based query per dashboard section returning every tile in that section in a single round trip. Never N+1 per tile |
| Raw SQL, not the ORM | Prisma `$queryRaw` with tagged-template parameters (never string concatenation). Prisma `groupBy` cannot express `AT TIME ZONE`, `generate_series` gap-filling, percentiles, or window functions. Every result set is validated by a `zod` schema at the boundary and typed from it |
| Gap filling | `generate_series` over the IST day range `LEFT JOIN`ed to the aggregate, so a zero-sale day plots as 0 instead of vanishing and bending the line |
| Guardrails | Max span 730 days (rejected with a 400, not truncated); `statement_timeout = 5s` set on the analytics database connection; every response carries `meta.queryMs` |
| Response envelope | Every analytics endpoint returns `{ data, meta: { tz, from, to, compare, attribution: 'placed' \| 'delivered', dataMode: 'REAL' \| 'MOCK', partial: boolean, sufficiency: 'OK' \| 'LOW' \| 'NONE', queryMs, generatedAt } }`. The UI renders states from `meta`, never from heuristics on `data` |
| Correctness tests | A committed fixture of ~60 orders spanning an IST midnight, a month boundary, a cancelled order, an RTO, a partial refund and a two-line order, with **hand-computed expected totals** asserted per metric. This is the only defence against a metric that is plausible and wrong |

**`[LATER]` rollups — with a measured trigger, not a guess.** Introduce `analytics_daily_sales` / `analytics_daily_product` when **either** `order_items` exceeds **250,000 rows** **or** p95 of `GET /api/v1/analytics/summary` exceeds **800 ms** over a 7-day window. Both are measurable from day one because `meta.queryMs` is emitted from day one.

```
analytics_daily_sales
  day_ist DATE PRIMARY KEY
  orders_placed, orders_delivered, orders_cancelled, orders_rto   INT
  gross_paise, discount_paise, shipping_paise, refunds_paise, net_paise  BIGINT
  units, cod_orders, online_orders, new_customers, returning_customers   INT
  computed_at TIMESTAMPTZ

analytics_daily_product
  day_ist DATE, product_id TEXT, variant_id TEXT      -- PK (day_ist, product_id, variant_id)
  units, returned_units INT
  gross_paise, discount_paise BIGINT
```

Refresh: a Vercel Cron at 00:15 IST (18:45 UTC) upserts D-1 and re-computes a **rolling 35-day window** — not one day, because a COD parcel placed on the 1st can reach `RTO_RECEIVED` on the 28th and mutate that day's net revenue under placed-date attribution. Today and yesterday are always queried live and unioned on top, so intraday is never stale. Rollups are a **cache, never a source of truth**: an admin `Rebuild` action re-derives any window from `orders`, and a nightly assertion compares live vs rolled-up totals for the last 7 days and alerts on mismatch.

---

### (d) Analytics UI

#### Page structure

```
admin_panel/src/
  app/(dashboard)/
    dashboard/page.tsx          Overview: 6 KPI tiles, revenue trend, alerts, recent orders
    analytics/
      layout.tsx                Tab bar + date-range controls (URL state, no provider needed)
      sales/page.tsx            Revenue, AOV, discounts, payment split, shipping cliff
      products/page.tsx         Top products / colours / subcategories, never-sold, inventory (blocked)
      customers/page.tsx        New vs returning, top customers, geography, cohorts (gated)
      operations/page.tsx       Cancellations, RTO, returns, fulfilment latency
  app/api/v1/analytics/         route handlers (table below)
  server/analytics/
    range.ts        preset -> { fromUtc, toUtc, compare, tz } — the ONLY place day boundaries exist
    money.ts        paise <-> rupee formatting, en-IN
    contracts.ts    zod request/response schemas shared by route and client
    metrics.ts      metric descriptors: id, label, format, goodDirection, minBaseForDelta
    queries/        sales.ts  products.ts  customers.ts  operations.ts   (raw SQL)
    csv.ts          streaming CSV writer
  components/analytics/
    kpi-tile.tsx  delta-badge.tsx  date-range-picker.tsx  compare-toggle.tsx
    chart-card.tsx  empty-state.tsx  insufficient-data.tsx  blocked-state.tsx
    export-button.tsx  mock-data-banner.tsx
```

There is no separate `analytics/page.tsx` overview — `/dashboard` **is** the overview, and `/analytics` redirects to `/analytics/sales`. Two pages showing the same six tiles is how dashboards start disagreeing with themselves.

Date range and comparison live in the **URL** (`?preset=last_30&compare=previous_period&attr=placed`), read by Server Components. Shareable, bookmarkable, refresh-safe, and it makes "send me the link to last month" work. No client-side range store.

#### Endpoints

| Method | Route | Returns | Notes |
|---|---|---|---|
| GET | `/api/v1/analytics/summary` | all KPI tiles + comparison values | one query, one round trip |
| GET | `/api/v1/analytics/timeseries` | `{ day_ist, net_paise, gmv_paise, orders, units }[]` | gap-filled; `?bucket=day\|week\|month` |
| GET | `/api/v1/analytics/breakdown` | ranked rows for one dimension | `?dim=product\|variant\|subcategory\|gender\|state\|payment&by=revenue\|units&limit=20` — one parameterised endpoint instead of four near-identical ones |
| GET | `/api/v1/analytics/customers` | new vs returning series, top customers, cohort grid | cohort block omitted when history < 90 days |
| GET | `/api/v1/analytics/operations` | cancellation, RTO, return, latency percentiles | |
| GET | `/api/v1/analytics/export` | `text/csv` stream | `?report=orders\|order-items\|products\|daily` |

All six sit behind the shared `requireAdmin()` guard reading the Auth.js v5 session. There are exactly **two roles**, so this is a boolean `session.user.role === 'ADMIN'` check, not an ability system; anything else returns `403` with an empty body. Pages are Server Components calling the query modules directly; the route handlers exist for CSV, for client-side refetch on range change, and as the stable contract — they are not the primary read path.

#### Charts: which form, and when a table wins

| Panel | Form | Why |
|---|---|---|
| Net revenue over time | Line (area when comparison is off) | One dominant continuous series; comparison line is dashed, muted, behind |
| Orders + AOV | Composed: bars for orders, line for AOV on a right axis | Two units, one time axis. The **only** dual-axis chart permitted, and it is labelled |
| Payment split | Two KPI tiles + one thin stacked bar over time | A two-slice pie is a percentage in disguise; the real question is whether COD share is *moving* |
| Subcategory mix | Horizontal bar, sorted descending | 5 long-ish labels. Bars are read by length; humans are bad at angles |
| Top products | Table: rank, thumbnail, units, revenue, share, with a right-aligned in-cell bar | 20 rows × 4 numeric columns is a table. Merchants sort and copy, they don't hover |
| Discount impact | Stacked bar per week: full-price vs discount given | Composition over time |
| Order status distribution | Table with counts and drop-off percentages | Not a funnel widget: funnels imply causality and dramatise noise at low volume |
| Cohort retention | Table heatmap (cohort month down, month index across) | `[NEEDS-HISTORY]` — hidden until 3 cohorts exist |
| Geography | Table by state + top pin-code prefixes | An India choropleth is ~80 KB of TopoJSON to say what 10 sorted rows say better |
| Free-shipping cliff | Histogram, Rs 250 buckets, reference line at Rs 2,000 | The reference line is the entire point |

**Library: `recharts`, consumed through the shadcn/ui `chart` primitives (`ChartContainer` / `ChartTooltip` / `ChartLegend`).** It is what shadcn's chart component is built on, so it is the zero-friction choice for the committed stack; it inherits the admin's own CSS-variable theme tokens, so the admin's dark/light modes come for free (the storefront's `ThemeContext` is a *separate application* and shares nothing with this one — no styling carries over); it is declarative React with no imperative canvas lifecycle; and at ≤730 points SVG is nowhere near a bottleneck. Rejected: `visx` (a toolkit, not charts), `echarts` (~600 KB, imperative), `nivo` (heavier, themed outside the design tokens), `chart.js` (canvas, weak a11y). **One charting dependency, ever.**

Colour discipline: one brand accent for the primary series, a muted neutral for comparison, and a fixed success/destructive pair for deltas driven by each metric's `goodDirection`. Every chart is preceded by a visually-hidden data table (or a "View as table" disclosure) so the panels are usable by screen readers and copyable by the merchant.

#### Empty, insufficient, and blocked states

Four states, four components. Never a chart drawn from nothing.

| State | Trigger (`meta.sufficiency` / flags) | UI |
|---|---|---|
| **Not connected** | Zero orders in the database | Full-page card: *"No orders yet. The storefront still saves orders in the shopper's browser and does not send them here — see the cutover checklist. Add an order manually to start."* + **New order** button + link to the JSON import tool |
| **Empty range** | Orders exist, none in range | *"No orders between 1 Sep and 4 Sep"* + one click "expand to last 90 days" |
| **Insufficient data** | < 10 orders in range (tiles), < 14 days of history (trends), < 90 days or < 3 cohorts (retention/CLV) | Tiles show the real number with an amber *"Low confidence: 6 orders"* note; trend charts are replaced by the insufficient-data card. **No deltas and no trendlines on a base under 10** |
| **Blocked** | Inventory/margin panels with no `stockOnHand` / `costPricePaise` | Card naming the exact missing field, linking to the product editor |

Loading uses `<Skeleton>` shaped like the final panel, with Suspense per panel, so one slow query cannot block the page.

shadcn components used: `card`, `tabs`, `table`, `chart`, `badge`, `button`, `calendar` + `popover` (range picker), `select`, `skeleton`, `alert`, `tooltip`, `separator`, `dropdown-menu`, `sonner`.

#### CSV export

Four reports: `orders` (one row per order), `order-items` (one row per line, for pivots), `products` (aggregated for the range), `daily` (the rollup shape). Rules that matter here:

- **UTF-8 with BOM** — without it, Excel on Windows mangles the rupee sign and any Devanagari in customer names. This is the number-one export complaint in Indian retail tooling.
- Two columns per amount: `total_inr` (`2999.00`, machine-friendly) and `total_display` (`₹2,999.00`). Never a float-formatted paise value.
- Dates as `2026-09-04T15:04:22+05:30` — ISO **with the IST offset**, unambiguous on re-import. Rows with `placedAtPrecision = APPROX` carry a `date_precision` column.
- A `source` column (`STOREFRONT` / `ADMIN_MANUAL` / `IMPORTED`) so the merchant can tell re-keyed orders from native ones.
- Filename `niya-orders-2026-08-01_2026-08-31-IST.csv`.
- Streamed from the route handler via `ReadableStream` with `Content-Disposition: attachment`, so a large export never builds a string in memory or trips Vercel's response limit.
- Phone and full address appear **only** in the `orders` report; it is rate-limited (10/hour/user) and every export writes an `AuditLog` row (`actorId`, `report`, `range`, `rowCount`, `ip`). A CSV of every customer's name, phone and address is the most sensitive artifact this panel produces, and exports of `MOCK` data are refused outright rather than silently exported.

---

### (e) Mock data policy

The rule: **mock data is a database property, not a code path.** No `if (isDev) return fakeRevenue()` anywhere in a query function — that pattern always survives to production on some branch.

| Layer | Mechanism |
|---|---|
| Generation | `prisma/seed/mock.ts`, run only via `pnpm db:seed:mock`. Deterministic (fixed `faker` seed) so every developer sees identical numbers and screenshots are comparable. Generates ~12 months of orders against the ~39 real products with weekday seasonality, a Sep–Nov festive bump, a 70/30 COD-to-online split, ~18% RTO on COD and ~4% returns — enough to exercise every state and chart, including the empty ones |
| Marking | `isMock BOOLEAN NOT NULL DEFAULT false`, indexed, on `Order` and `Customer` only. Products are **never** mocked — the real catalogue is the seed |
| Read isolation | A single Prisma **client extension** injects `where: { isMock: false }`; raw analytics SQL takes the same predicate from one shared SQL fragment. Unless `ALLOW_MOCK_DATA=true`, mock rows are invisible. One place, not per query |
| Write guard | The seed refuses when `NODE_ENV=production`, when `VERCEL_ENV=production`, or when the `DATABASE_URL` host is not in a local/preview allowlist. Three independent checks because any one can be misconfigured |
| UI signalling | When `meta.dataMode === 'MOCK'`, a **non-dismissible** amber `<Alert>` sits above every analytics page — *"Demo data — these numbers are generated, not real"* — and every KPI tile carries a small badge. A dismissible warning is an unheeded warning |
| Cleanup | `pnpm db:seed:mock --purge` deletes strictly `WHERE is_mock = true`, so mock and real rows can coexist during development |
| `[LATER]` Production proof | A CI assertion that `SELECT count(*) FROM "Order" WHERE is_mock` is `0` in production. Worth adding once a real deploy pipeline exists; before that the three write guards plus the read filter are sufficient, and a CI job against the production database is more moving parts than a one-person store needs on day one |

The distinction that makes this work: orders re-keyed by the admin, or imported from a device the merchant controls, are `isMock: false` and `source: ADMIN_MANUAL | IMPORTED`. They are real trades that arrived by a strange route. Mock rows are fiction. Conflating the two either hides the merchant's real history or pollutes their numbers with invented revenue.

---

### (f) What analytics looks like before and after the storefront cutover

This is the only honest way to present the section, and it belongs in the UI as well as the document.

| | Before cutover (now) | After cutover (later, separate) |
|---|---|---|
| Data in | Orders keyed in by the admin; optional JSON import | Orders `POST`ed by the storefront checkout |
| Storefront changes required | **Zero** | A new `src/api/orderApi.js`, un-commenting the axios bodies in `authApi.js` / `productApi.js` / `contentApi.js`, and pointing `VITE_API_BASE_URL` at the admin API. Confined to `src/api/*.js` plus env |
| What works | Every `[READY]` metric, exactly, on whatever rows exist | The same metrics, now fed automatically |
| What does not | Traffic, funnel, search, wishlist, cart abandonment (`[NEEDS-EVENTS]`); inventory and margin (`[NEEDS-SCHEMA]`) | Traffic/funnel still needs the `[LATER]` decision in section (a); inventory still needs the product-model fields |

The admin's "Not connected" state (section d) says this in one sentence to the merchant, with a link to the cutover checklist. At no point does the dashboard imply it is measuring the live site.


**Decisions**

- FIX: Killed the draft's central factual error - the 'legacy import of the merchant's niyaOrders localStorage dump'. niyaOrders is written to each SHOPPER's browser (OrderPage.jsx:162-169) and never transmitted, so real customer orders are unrecoverable. Backfill is now (a) admin manual order entry as the real day-one path and (b) a small [LATER] JSON-paste importer for a device the merchant actually controls.
- FIX: Replaced the fragile toLocaleString('en-IN') parser with the correct source of truth - orderId is `NIYA-${Date.now()}` (OrderPage.jsx:153), an exact UTC epoch. The locale string is also the SHOPPER's device clock, not IST, and its shape (incl. a narrow no-break space before 'pm') varies by browser ICU version; it is now only a labelled fallback that marks the row placedAtPrecision: APPROX.
- FIX: Corrected the variant claim. The draft said per-colour analytics is impossible; verified that CartContext persists the whole selectedVariant object and OrderPage forwards it, so the colour NAME survives. Added variantNameSnapshot and made variantId the exactness upgrade, not the precondition.
- FIX: Added a verified, load-bearing fact the draft missed - checkout totals on product.price and never salePrice (CartPage.jsx:130-138, OrderPage.jsx:76-80). Imported lines therefore carry list price, so compareAt == unitPrice, lineDiscount = 0, and discount metrics now explicitly EXCLUDE source = IMPORTED instead of silently reporting zero discount.
- FIX: Corrected the cutover claim. The draft implied the orders cutover is only un-commenting; OrderPage.jsx:20 imports ../api/orderApi, which does not exist in src/api/. Section (f) now states a new file plus env changes are required.
- FIX: Removed an internal contradiction - the draft argued 8ms queries do not justify rollups, then added a 5-minute unstable_cache layer with tag purging. Cut the cache entirely (also avoids the Next.js caching-API version churn); Server Components fetch live, Suspense covers latency.
- FIX: Removed the false claim that the storefront's ThemeContext dark mode 'carries over for free'. They are separate deployed applications sharing no CSS; the admin has its own theme tokens.
- FIX: Trimmed over-engineering for a one-person, ~39-SKU store: dropped the partial DELIVERED index, dropped monthly partitioning from the [LATER] event table (plain table until ~10M rows), dropped isMock from AuditLog, demoted the production CI assertion and the /system/data-mode endpoint to [LATER], and cut mock seed history from 18 to 12 months.
- FIX: Made the cheapest path to traffic/funnel metrics explicit instead of jumping to a bespoke pipeline - [LATER] add Vercel Web Analytics or GA4 to the storefront (one script tag, its own separate change); build the 6-event table only when events must join to Order rows in this database.
- FIX: Collapsed 7 endpoints to 6 by parameterising four near-identical ranking endpoints into one /breakdown?dim=; and deleted the duplicate analytics overview page (/dashboard IS the overview, /analytics redirects to /analytics/sales) so two pages cannot disagree.
- FIX: Renamed the feasibility tags. '[NOW]' was misleading given there are no orders now; tags are [READY] / [NEEDS-HISTORY] / [NEEDS-SCHEMA] / [NEEDS-EVENTS] / [N/A].
- FIX: Added Order.source (STOREFRONT | ADMIN_MANUAL | IMPORTED) and placedAtPrecision (EXACT | APPROX) to the required schema, so provenance is visible in every panel and export rather than being an untracked assumption.
- FIX: Added the missing response envelope spec - meta { tz, from, to, compare, attribution, dataMode, partial, sufficiency, queryMs, generatedAt } - so the four empty states are driven by the server, not by client heuristics over data.
- FIX: Added a correctness-testing strategy the draft omitted entirely: a committed ~60-order fixture crossing an IST midnight, a month boundary, a cancellation, an RTO and a partial refund, with hand-computed expected totals asserted per metric.
- FIX: Softened the Net Revenue headline for the real starting condition - at manual-entry volume, Net Revenue and Placed GMV render at equal weight so a merchant who has marked nothing DELIVERED does not see a Rs 0 hero tile.
- FIX: Noted that state and email are OPTIONAL at checkout (OrderPage.jsx:95-104) while phone is required-but-unvalidated, which strengthens the phone-as-customerKey decision and forces geography metrics to tolerate blanks.
- FIX: Added chart accessibility (visually-hidden data table per chart), a source column in CSV exports, refusal to export MOCK data, and ip in the export audit row.
- FIX: Added section (f), an explicit before/after cutover table, so the document never implies the admin measures the live storefront.

**Open assumptions**

- The data-model section defines Order, OrderItem, Customer, Product and ProductVariant in the admin's own Postgres (Prisma + Neon/Supabase), with Order carrying placedAt, shippedAt, deliveredAt, cancelledAt, status, paymentMethod, subtotalPaise, shippingFeePaise, totalAmountPaise, refundedAmountPaise, normalized shipping fields, and the two new fields this section requires: source and placedAtPrecision.
- The orders section owns the canonical status enum and provides admin manual order creation - the day-one data source for every metric here. Analytics only consumes both.
- The product model in the admin adds sku, costPricePaise, per-variant stockOnHand and lowStockThreshold, and server-issued stable ProductVariant ids. All inventory, margin and sell-through metrics stay blocked until it does.
- Currency is INR only and the reporting timezone is Asia/Kolkata only. No multi-currency, no multi-region.
- No payment gateway exists, so ONLINE orders are marked paid manually by the admin; payment success/failure metrics are not applicable and are not stubbed.
- requireAdmin() (Auth.js v5 session, two roles only) and the AuditLog model are provided by the auth/security section; analytics reuses them.
- Confirm with the user: does the store have any real order history recorded outside the browser (a WhatsApp register, a notebook, a spreadsheet)? If yes, the [LATER] importer should accept CSV rather than a niyaOrders JSON dump. If no, analytics honestly starts at zero.
- Realistic volume is assumed to be tens of orders per day at most; every no-rollup, no-cache, no-partition decision here is justified by that and should be revisited only against the measured triggers stated in section (c).

**Risks**

- The dashboard's honesty depends entirely on the merchant advancing order statuses by hand. If they never mark orders DELIVERED, Net Revenue stays at zero and the headline metric is useless - this is a process risk, not a code risk, and it needs an explicit nudge in the orders UI (e.g. a 'stale in PLACED for 7 days' alert).
- Manually keyed orders are the only real data for an unknown period. Human entry error (wrong price, missing line, duplicated order) will directly corrupt analytics with no upstream validation to catch it; duplicate detection on phone + total + day is worth adding to the order form.
- customerKey on unvalidated free-text phone will fragment: '9876543210', '+91 98765 43210', a typo. Normalisation catches format, not typos, so new-vs-returning and CLV will slightly overstate 'new' forever.
- subcategorySnapshot at import depends on productId resolving against the admin's product table. If the admin's product ids diverge from the storefront's 'handbag-001' style ids, imported lines land in 'unknown' and category analytics on legacy data is lost.
- The 35-day rollup rebuild window is a guess about how late RTO/return transitions arrive. It is untested against this merchant's actual courier behaviour and should be validated before rollups ship - if RTOs land at 45 days, the window silently under-corrects.
- Excluding source = IMPORTED from discount metrics is correct but means the discount panel may show 'no data' even when orders exist - a state the UI must handle explicitly or it will read as a bug.
- The free-shipping cliff histogram is only meaningful with a few hundred orders; at n = 30 it will look like noise and risks driving a bad pricing decision. It should carry the same sufficiency gate as trendlines.
- Any storefront cutover that ships events, orders or product data will move PII (name, phone, full address) to a server for the first time, which changes the DPDP Act 2023 posture materially. That review must happen before cutover, not after.

---

## Data Fetching, State, Forms, Components and Design System

This section specifies the *inside* of `admin_panel/`. Nothing in it modifies `e-commerce_frontend-main/`, and nothing in it reaches the storefront until the later, separate cutover confined to `src/api/*.js`.

**Verified in the repo while writing this section**, so the section is grounded rather than guessed:

| Claim | Evidence |
|---|---|
| Brand tokens | `src/index.css` — `--color-accent: #c39920`, `--color-text-primary: #073b4c`, `--color-bg-primary: #faf9f5`, dark `#101c20` |
| Dark mode already exists | `src/context/ThemeContext.jsx:25-28` — `root.classList.toggle("dark", …)`, `root.style.colorScheme`, key `"niyaTheme"` |
| A 250ms colour transition on `body` | `src/index.css` — `transition: background-color 250ms ease, color 250ms ease` |
| Fonts | `index.html:11` — Cormorant Garamond + Inter |
| URL-as-state is already this team's habit | `ShopPage.jsx:11,16,151` — `useSearchParams`, `searchParams.getAll("subcategory")` |
| The variant-id collapse is real | `CartContext.jsx:31` — `variantId` resolved from `selectedVariant?.id`, `selectedVariant?._id`, `product.variantId`, against variants that carry only `name` |
| Product images are a **flat array of URL strings** | `src/data/products.js:29` — `images: [ "…", "…", "…" ]` |
| Shipping is hardcoded in a page, not in an api module | `OrderPage.jsx:82` — `subtotal >= 2000 || subtotal === 0 ? 0 : 100` |
| The order API hole | `OrderPage.jsx:20` `// import { createOrder } from "../api/orderApi"` — **that file does not exist**; `:144` `// await createOrder(orderPayload)`; `:163-167` writes `localStorage["niyaOrders"]` |

---

### (0) The reach table — what the admin can ever control, and what it cannot

Every decision below is constrained by this. The agreed cutover is **mechanical and confined to `src/api/*.js`**. Anything the storefront hardcodes *inside a component* is therefore permanently outside the admin's reach under the "zero storefront changes" constraint, and no amount of admin design changes that. Saying so up front prevents building screens that can never do anything.

| Storefront surface | Read through | Reachable after the `src/api/*.js` cutover? |
|---|---|---|
| Product catalogue, search, filters, sale page | `productApi.js` (axios version already written, commented) | **Yes** |
| Featured / best-seller / new-arrival rails | `productApi.js` helpers over product fields | **Yes**, indirectly via `isFeatured`, `orderCount`, `createdAt` |
| Category strip | `getCategories()` derives `gender + "-" + subcategory` | **Indirect only** — a computed facet, never an editable entity |
| Home hero banners, promo banners, announcements, reels, craftsmanship, campaign | `homeApi.js` (+ the fully commented `contentApi.js`) | **Yes** |
| Footer nav, socials, legal links, static pages | `footerApi.js` (`getFooter`, `getFooterPage(slug)`) | **Yes** |
| Customer accounts | `authApi.js` — 100% localStorage fake auth (`niyaUsers` with plaintext passwords, `niyaCurrentUser`) | **Yes, but as a second, separate cutover** with its own risk profile |
| Orders | `OrderPage.jsx` writes `localStorage["niyaOrders"]`; `createOrder` is commented and `src/api/orderApi.js` **does not exist** | **Only after that file is created and the call uncommented.** Strictly speaking this is one new file in `src/api/` plus one uncommented line in a page — the smallest thing outside the pure-`src/api` boundary |
| Cart | `CartContext` → `localStorage["niya_cart"]` | **No.** Device-local. There is no server cart, and `cartApi.js` (real HTTP) is not wired to the context |
| Wishlist | `WishlistContext` → `localStorage["niyaWishlist"]` | **No.** Device-local and anonymous |
| Shipping fee rule (free over ₹2000, else ₹100) | Hardcoded in `OrderPage.jsx:82` | **No.** Not behind any api module |
| Trust badges copy | Hardcoded in `TrustBadges.jsx` (59 lines, no data file) | **No** |
| Payment | `"ONLINE"` is a radio option; no gateway exists anywhere | **No** |

**Consequences the admin must obey.** There is no *Shipping settings* screen and no *Trust badges* editor in v1 — they would be dead controls. There is no *Payment* configuration screen. There is no server-side cart or wishlist, so there is no "abandoned cart" view and no per-customer wishlist panel. Orders and Customers ship with honest empty states, never seed data.

**The shape-fidelity rule (the most important constraint in this section).** Because the cutover must be a data-source swap and not a re-render, **every admin content schema mirrors the exact JSON shape the storefront already consumes**, and the public read endpoints serialise to that shape byte-for-byte. Concretely: `variants[].images` serialises as `string[]`, not objects; `price` serialises as whole rupees; `date` fields the storefront prints directly stay strings in the format it already prints. The admin may store richer internal structures — it may never emit them.

---

### (a) Server versus Client Components

#### The decision rule, in order

A component is a **Server Component unless it needs one of exactly four things**:

1. An event handler (`onClick`, `onChange`, `onDragEnd`)
2. A browser-only API (`localStorage`, `matchMedia`, `File`, `IntersectionObserver`)
3. React state that **cannot be represented in the URL**
4. A client-only library (TanStack Table, dnd-kit)

Rule 3 carries the weight. Filters, sort and pagination *can* live in the URL, so they must not be `useState`. Row selection and dialog open-state cannot sensibly live in the URL, so they are client state.

Corollary: **push `"use client"` to the smallest interactive leaf**, with one honest exception below.

#### Applied: the `/products` list page

| Part | Server / Client | Why |
|---|---|---|
| `products/page.tsx` | **Server** | `await searchParams`, call `queries.listProducts()`, render shell |
| `PageHeader` + "New product" | **Server** (a `<Link>`) | Navigation, not interaction |
| `ProductsToolbar` | **Client** | Writes URL via `nuqs` |
| `<DataTable>` + `columns.tsx` | **Client** | TanStack Table, selection, column visibility, density |
| `RowActions` dropdown | **Client** | Menu + `ConfirmDialog` |
| `BulkActionBar` | **Client** | Reads selection |
| `loading.tsx` skeleton | **Server** | Static markup |

**Correction to a common (and tempting) mistake: table cells are NOT server-rendered.** TanStack Table's `ColumnDef.cell` is a function evaluated inside the client table instance; you cannot hand it server-rendered `ReactNode`s without abandoning column definitions entirely. So the server page fetches, maps rows to a **plain serialisable DTO**, and passes `rows: ProductRow[]` across the boundary. Cells render on the client using pure formatters from `lib/format.ts`.

Those formatters are the hydration-safety boundary and are **pinned**, because unpinned `Intl` is the single most common source of admin hydration mismatches:

```
formatINR(paise)      -> Intl.NumberFormat("en-IN", { style:"currency", currency:"INR",
                          maximumFractionDigits: 0 })   // fixed locale, never the browser's
formatDate(iso)       -> Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", … })
formatDateTime(iso)   -> same, with time
```

**The API always returns ISO-8601 UTC.** This is a direct correction of the storefront's habit: `OrderPage` stores `date: new Date().toLocaleString("en-IN")`, a locale string that cannot be sorted, filtered or ranged. The admin never accepts that as a data format; the cutover adapter parses it once during import and stores ISO thereafter.

#### Why URL-as-state removes most client state

The URL *is* the query. No `useEffect` watching filters, no table-owned loading state, no toolbar/rows disagreement. A filter change is a navigation: React re-renders the server component with new data. You get shareable links ("the CONFIRMED COD orders from last week"), working back/forward, and correct refresh behaviour. `ShopPage.jsx` already proves the pattern is natural here.

**Where each kind of state lives — the committed three-way split:**

| State | Home | Rationale |
|---|---|---|
| Filters, search, sort, page, pageSize | **URL** (`nuqs`) | Shareable, restorable, server-consumable |
| Row selection | **Client, ephemeral** | Meaningless after navigation; would pollute the URL |
| Column visibility + density | **`localStorage`, per table** | Operator preference, not a view |
| Open dialog / sheet | **Client** | Transient |
| Unsaved form values | **Client (RHF)** | A draft is never a URL |

`nuqs` with `shallow: false` (so the server fetch actually re-runs) inside `useTransition` (so the toolbar stays live and the table dims instead of blanking). The `NuqsAdapter` sits in the root layout.

**localStorage key scheme, and the hydration rule.** One key per table, versioned so a column rename cannot poison a stored layout:

```
niya_admin:table:<tableKey>:v1  ->  { visibility: Record<string,boolean>, density: "default" | "compact" }
```

Read it in `useEffect` after mount, never during render, and render the server default first. Reading `localStorage` during render is the classic App Router hydration-mismatch bug and is banned here.

#### The searchParams contract

Shared parser shape, per domain, with domain-specific keys kept **distinct** — a single `status[]` key across products and orders is ambiguous the moment orders grow two status axes:

```
common:      q?: string
             page?: number = 1
             pageSize?: 25 | 50 | 100 = 25       // 10 dropped; useless at this data size
             sort?: "field:asc" | "field:desc"

/products:   status?: ("DRAFT"|"PUBLISHED"|"ARCHIVED")[]     // repeated key
             subcategory?: ("handbags"|"minibags"|"sling"|"tote"|"wallet")[]
             gender?: "women" | "men"
             onSale?: boolean
             featured?: boolean
             minPrice?, maxPrice?: number         // WHOLE RUPEES in the URL
/orders:     fulfillment?: FulfillmentStatus[]
             payment?: PaymentStatus[]
             from?, to?: string                   // yyyy-mm-dd, interpreted Asia/Kolkata
/customers:  (common only)
```

Repeated keys mirror `ShopPage`'s existing `?subcategory=` convention, so an operator's URL habits transfer.

**Money at the boundaries — committed, because this is where money bugs live.** Storage and internal API are **integer paise**. The URL and the `MoneyInput` are **whole rupees**. Conversion happens in exactly two places: the Zod parse of `searchParams`, and the `MoneyInput` value transform. The storefront-facing serialiser divides by 100 and the product schema enforces `.multipleOf(100)`, so a price can never be un-representable in the storefront's whole-rupee shape (`price: 2999`).

Each domain owns a `listParamsSchema`. Invalid params are **coerced to defaults, never thrown** — a hand-edited URL should degrade, not 500.

**Honest caveat.** With about 40 products, client-side filtering would work fine today. We filter server-side anyway because orders will not be 40 forever, and because two data paths — client filter here, server filter there — is exactly the inconsistency that rots an admin panel. This is a structure decision, not a performance one, and it is not presented as one.

---

### (b) Data Fetching

#### The read path — stated plainly, because the draft-level answer "RSC + Server Actions" leaves the important half unsaid

The admin **owns its own API** (Next.js App Router, Postgres, Prisma). There are two distinct surfaces and they must not be confused:

| Surface | Who calls it | Mechanism |
|---|---|---|
| **Internal reads** | The admin's own Server Components | `features/<domain>/queries.ts` — Prisma **called directly**, `import "server-only"` at the top |
| **Internal writes** | The admin's own forms | Server Actions in `features/<domain>/actions.ts`, calling the same service functions |
| **Public read API** | The storefront, *after cutover*; nothing today | `app/api/public/v1/*` Route Handlers, versioned, read-only, shaped exactly like `src/data/*.js` |

**The admin never `fetch`es its own Route Handlers from a Server Component.** Self-fetching an internal endpoint costs a full HTTP round trip, a second serialisation, and a duplicated auth story, to reach code already running in the same process. Route Handlers exist for the public surface and for the two small client-side reads named below.

**Authorisation is in the data layer, not just the middleware.** Every function in `queries.ts` and every Server Action begins with a single shared `requireAdmin()` that reads the Auth.js session and throws a typed `FORBIDDEN` for `role !== "ADMIN"`. Middleware and the `(dashboard)` layout also check, but those are UX; the guard inside the data layer is the security boundary. Exactly two roles exist: `ADMIN` and `USER`. A `USER` session never reaches an admin query — it is bounced to a full-page 403 state.

#### Client-side fetching: the boundary, deliberately narrowed

The draft position — "TanStack Query in exactly four places" — is still one dependency too many for this app. Reviewing the four candidates against reality:

| Candidate | Verdict |
|---|---|
| Entity typeahead in order editing | **Removed from v1.** The admin does not edit order line items (no gateway, nothing to reconcile); it changes status, records an AWB, adds a note, cancels. There is no product picker |
| "Related products" picker | **Does not exist.** `getSuggestedProducts()` returns the first 6 other products — derived, never curated. Building a curation UI would be inventing a feature the storefront cannot consume |
| Order-queue polling every 30s | **[LATER].** Zero orders exist until cutover, and one operator on one screen does not need a 30s poll. When it lands: `router.refresh()` on an interval, or an EventSource, decided then |
| Media library paging + upload progress | **Real**, and the only genuine client-side reads |

**Committed: `@tanstack/react-query` is not a v1 dependency.** Two dialog-scoped reads do not justify a query client, a provider, a hydration boundary, a second auth-in-the-browser story and devtools. They are served by one small shared hook:

```
useAsyncList<T>({ endpoint, params, pageSize })
  -> { items, isLoading, error, loadMore, hasMore, reload }
  - AbortController per keystroke/page, plus a monotonic request-id guard
    (aborting is not enough; out-of-order resolution is the actual bug)
  - debounce 250ms on text input
  - cache lives only as long as the open dialog. No global cache, so no staleness model to reason about
```

Upload progress is per-file component state driven by `XMLHttpRequest.upload.onprogress` against a presigned PUT — a lifecycle, not a query.

**The re-entry condition, so this is a decision and not a dogma:** adopt TanStack Query the moment a *third* independent client-side read appears, or the moment two client reads need to share a cache. Until then it is weight.

#### Caching — the correction that matters most

The draft's instinct (tags primary, paths as fallback) is right, but it applies the machinery to the wrong surface.

**Admin reads are not cached. At all.** Admin routes read `cookies()` for the session, so they are dynamic; the Full Route Cache is not in play, and `revalidatePath` on an admin route mostly does nothing. More importantly, Prisma reads are not `fetch`, so `next: { tags }` never applies to them — you would have to wrap them in `unstable_cache` on purpose. Doing that would deliberately introduce staleness into the one screen that must always show the truth, for a query returning 40 rows from a database on the same continent. **Committed: `features/*/queries.ts` hits Prisma directly, uncached, on every admin request.**

**The public read API is where caching lives, and it is the entire point of the tag scheme.** Those Route Handlers are the surface the storefront will hit after cutover. They are cached (`unstable_cache` around the service call, with tags) and purged by tag from Server Actions. This is what lets a content edit go live on a Vercel-hosted storefront without a redeploy — *after* cutover. Before cutover, the tags are exercised only by the admin's own preview of the public payload. That is stated here rather than dressed up as a benefit the admin enjoys today.

Next's `use cache` / `cacheTag` is the forward path; build on `unstable_cache` + `revalidateTag` now and migrate when it stabilises.

#### Cache-tag naming scheme

```
product                          whole collection
product:{id}                     one record
product:facet:categories         the derived gender + "-" + subcategory grouping
product:facet:featured           the isFeatured rail
product:facet:sale               the isOnSale set
content:{block}                  hero-banners | promo-banners | announcements | reels
                                 | craftsmanship | campaign | reviews
content:footer                   footer nav, socials, legal links
content:footer:{slug}            one static page (about, our-story, contact, faq, …)
settings                         shipping display copy, store info
order, order:{id}                admin-only today; no public order endpoint
```

The `facet` level exists because of a verified fact: `getCategories()` **derives** categories from products. Categories are not an entity — there is no category description, banner, slug, SEO or ordering anywhere in the storefront. So editing one product's `subcategory` silently changes the public category strip, and the invalidation matrix has to say so.

Note `content:home:featured` from the draft is wrong and is corrected to `product:facet:featured` — featured is a product field, not a content block, and mis-filing it would leave the rail stale after a product edit.

#### Mutation to tag invalidation matrix (applies to the public API cache)

| Mutation | Tags revalidated |
|---|---|
| `product.create` / `product.delete` | `product`, `product:facet:categories` |
| `product.update` (any field) | `product`, `product:{id}` |
| …where `subcategory` or `gender` changed | + `product:facet:categories` |
| …where `isFeatured` changed | + `product:facet:featured` |
| …where `isOnSale` or `salePrice` changed | + `product:facet:sale` |
| `product.setStatus` (DRAFT / PUBLISHED / ARCHIVED) | `product`, `product:{id}`, `product:facet:categories`, `product:facet:featured`, `product:facet:sale` |
| `variant.create/update/delete/reorder` | `product:{id}` and `product` (the list shows the primary image) |
| `heroBanner.* / promoBanner.* / announcement.* / reel.* / craftsmanship.* / campaign.*` | `content:{block}` only |
| any content **reorder** | `content:{block}` only, never the whole content tree |
| `footerPage.update(slug)` | `content:footer:{slug}` |
| `footerNav.update` | `content:footer` |
| `order.updateFulfillment` / `updatePayment` | `order`, `order:{id}` — **no public tag; there is no public order endpoint** |
| `settings.update` | `settings` |

Rule: an action revalidates the **narrowest tags that are actually stale**. A blanket `revalidateTag("product")` after a variant image swap is the lazy pattern that makes a cache worthless.

---

### (c) Forms

#### One schema, two consumers

Each domain owns `features/<domain>/schema.ts`, imported by **both** the client form and the Server Action. Not "a similar schema" — the same exported object. This single rule is what makes client and server validation incapable of drifting.

| Schema | Notable fields |
|---|---|
| `productSchema` | `title`, `slug`, `gender`, `category` (literal `"bags"`), `subcategory`, `price` (paise, int, `multipleOf(100)`), `salePrice`, `isOnSale`, `status`, `description` (**plain text**), `metaTitle?`, `metaDescription?`, `variants[]` |
| `variantSchema` | `id` (**required, server-minted**), `name`, `colorHex?`, `images[]` (`{ mediaId?, url, alt, position }`), `position` |
| `orderStatusSchema` | `fulfillmentStatus`, `paymentStatus`, `courier?`, `awb?`, `note?` |
| `heroBannerSchema` | `image`, `title`, `subtitle`, `buttonText`, `buttonLink`, `position`, `isActive` |
| `promoBannerSchema` | `page` (home / shop / wishlist), `position` (after-hero / after-products), `image`, `title`, `alt`, `isActive` |
| `announcementSchema` | `text`, `position`, `isActive` |
| `reelSchema` | `videoUrl`, `title`, `isActive`, `position` |
| `craftsmanshipSchema` | `eyebrow`, `title`, `description` (**exactly 2 paragraphs**), `stats` (**exactly 3** `{value,label}`), `image`, `imageAlt`, `buttonText`, `buttonLink` |
| `campaignSchema` | `eyebrow`, `title`, `description`, `image`, `buttonText`, `buttonLink` |
| `reviewSchema` | `name`, `location`, `text` — **and nothing else** |
| `footerNavSchema` | `brand`, `socialLinks[]`, `sections[] -> links[]`, `customerService`, `legalLinks[]`, `copyright` |
| `footerPageSchema` | **A discriminated union keyed on `slug`**, one member per existing page |
| `listParamsSchema` | per (a) |

Three of these need justification because they correct real errors:

- **`reviewSchema` has no rating, date, product link or verified flag.** `reviewsData` is `{ name, location, text }` and the storefront renders exactly that. Adding a rating field would produce a control whose value nothing displays. Editorial testimonials, not a review system. A real review system is [LATER] and is a storefront feature, not an admin one.
- **`craftsmanshipSchema` pins the array lengths.** The component renders two paragraphs and a three-stat row; a fourth stat would break the layout on a storefront we may not touch. Schema-enforced, with the reason in the field help text.
- **`footerPageSchema` is a union, not a generic block editor.** `footerPagesData` shapes are ad hoc per slug (`faq` has `faqs[]`; the others differ), rendered by bespoke components. A generic `blocks[]` editor would emit a structure no storefront component can render — a violation of the shape-fidelity rule dressed up as flexibility. So: one schema member per existing slug, mirroring its real shape, plus an ADMIN-only raw-JSON escape hatch behind a confirm + before/after diff for the day a page shape changes.

**No rich text in v1.** Tiptap is cut. Product `description` is a plain string that the storefront renders as text; emitting HTML would require the storefront to adopt `dangerouslySetInnerHTML`, which is a storefront code change and therefore forbidden. Fields stay `textarea`. Rich text is [LATER, blocked on a storefront renderer change], and that dependency is stated rather than hidden.

**Fields deliberately NOT in v1**, against the temptation to build them because every catalogue tool has them:

| Field | Why not |
|---|---|
| `sku` | Nothing scans or reconciles it. One brand, ~40 items, no warehouse system |
| `stock` / inventory | Nothing can decrement it until orders flow through the API, and the storefront cannot display it without a code change. **[LATER, gated on order cutover]** |
| `tags` | Not in the product shape; the storefront has no tag surface. Adding it produces an editor for data nobody reads |
| `weight`, `cost price`, `materials`, `brand` | No shipping integration, no margin reporting, one brand |

`status` (DRAFT / PUBLISHED / ARCHIVED) **is** in v1 — it is the one missing product field with a real job: taking an item off the store. Honest caveat: until cutover, `getAllProducts()` returns everything from the local file, so unpublishing is invisible to shoppers.

**Cross-field rules enforced with `.superRefine`**, grounded in the real data: `isOnSale === true` requires a non-null `salePrice`; `salePrice < price`; `discountPercentage` is **derived server-side and never user-entered** — the storefront stores `price`, `salePrice` and `discountPercentage` independently and they are free to disagree today, which is exactly the bug the admin should not reproduce.

#### Server-side re-validation is not optional

The Server Action re-parses the raw `FormData` with the same schema before touching the database. A Server Action is a public HTTP endpoint; anyone with a session can POST to it directly. Client validation prevents typos; server validation prevents attacks.

#### Result envelope and error mapping

Every Server Action returns one discriminated union:

```
type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false
      code: "VALIDATION_FAILED" | "CONFLICT" | "FORBIDDEN" | "NOT_FOUND"
          | "RATE_LIMITED" | "INTERNAL"
      message: string                        // human copy for the form-level alert
      fieldErrors?: Record<string, string[]> // dot-paths: "variants.1.images.0.alt"
      requestId?: string }
```

`fieldErrors` keys use **RHF dot-path notation**, so mapping back is a loop of `setError(path, { type: "server", message })` with no translation layer. Zod's flat `.flatten()` is insufficient for nested arrays; the action joins `issue.path` with `.` so `["variants", 1, "images", 0, "alt"]` becomes an address RHF can reach. Server errors carry `type: "server"` and are cleared on the next change to that field, so a stale message cannot block resubmission.

`UNAUTHENTICATED` is intentionally not in the action envelope: an expired session is handled by the Auth.js middleware redirect before the action body runs, so an action that returns it would be unreachable. It remains in the HTTP-level error table in (d).

`CONFLICT` is real: `slug` is unique, and `variant.name` is unique within a product. Honest framing in the UI: the storefront routes on `/product/:id`, **not** `/product/:slug`, so `slug` is currently vestigial and a duplicate is a future-SEO problem, not a present 404. `SlugInput` says that, rather than screaming.

#### Dirty tracking and the unsaved-changes guard

`formState.isDirty` drives both the Save button's enabled state and the guard. On success the action returns the persisted entity and the form calls `reset(returnedValues)` — resetting to **server truth**, not to submitted values, so normalisation (slugification, price rounding, derived `discountPercentage`, server-minted `variant.id`) appears immediately and the form ends clean.

**The guard, honestly.** The App Router has **no `useBlocker`**, and `router.push` cannot be intercepted. So:

1. `beforeunload` covers tab close, reload and external navigation.
2. In-app navigation is covered by an `UnsavedChangesProvider` in the `(dashboard)` layout holding a dirty-form registry, plus `<GuardedLink>` in the shell (sidebar, breadcrumbs, header). The guard is **armed only while a dirty form is registered**, so it costs nothing on list screens.
3. Programmatic navigation inside features calls `guardedPush()` from that context.
4. An ESLint `no-restricted-imports` rule bans raw `next/link` under `components/layout/**` only — not repo-wide, where plain links are correct.

React Context, not Zustand: one small cross-tree value does not justify a state library, and Context is the storefront team's existing idiom.

#### Pending UI

`useActionState` gives `[state, formAction, isPending]`, where `state` is the `ActionResult`. `useFormStatus` is used **only inside `<SubmitButton>`**, a child of the `<form>` — it reads the nearest parent form, so placing it as a sibling is the classic mistake and is called out in the component's doc comment. The button keeps its label and width (a spinner replaces the leading icon; text swaps cause layout jump), sets `aria-busy`, and is disabled while pending — but **the form is not**, so the operator can keep reading and correcting fields.

#### Nested field arrays and drag-reorder

| Form | Array | Depth |
|---|---|---|
| Product | `variants[]`, each with `images[]` | **Nested** |
| Product | `variants[].images[]` | Reorderable; index 0 is the primary image |
| Footer FAQ page | `faqs[]` `{question, answer}` | Flat, reorderable |
| Footer nav | `sections[] -> links[]` | **Nested** |
| Home reels | `reels[]` | Flat, reorderable, `isActive` toggle |
| Announcements | `announcements[]` | Flat, reorderable |
| Promo banners | grouped by `page` + `position` | Flat within group |

Nested arrays use one `useFieldArray` per level, the inner keyed by the outer index path (`variants.${i}.images`). Two rules prevent the classic bugs:

- **`field.id` from `useFieldArray` is a React key only.** It is regenerated across render passes and must never be persisted. The persisted `variant.id` is minted by the server. This is precisely the verified storefront defect: variants carry only `name`, so `CartContext`'s dedupe key collapses to the bare `productId` and two colours share one cart line. **Making `variant.id` required and server-minted means the cutover fixes that bug without a single line changing in `CartContext.jsx`** — the existing `selectedVariant?.id` lookup simply starts finding a value.
- **`position` is a persisted integer, never the array index.** A drag calls `useFieldArray`'s `move(from, to)` and then rewrites every `position`, so ordering survives partial saves and concurrent edits.

Drag-and-drop uses **`@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/modifiers`** (not react-beautiful-dnd: unmaintained, and poor with React 19 StrictMode). `restrictToVerticalAxis` + `restrictToParentElement` for lists. Accessibility is non-negotiable: `sortableKeyboardCoordinates` gives Space + arrow-key reordering, plus dnd-kit's live-region announcer. A drag **inside a form** only calls `move()` — it does not submit; it saves with the rest of the form. Content lists **outside a form** (reels, banners, announcements, FAQs) save the reorder immediately via a dedicated reorder action with an optimistic update.

**Image serialisation, restated because it is a shape-fidelity trap.** The admin stores each image as `{ mediaId?, url, alt, position }` so alt text and ordering are editable. The public serialiser flattens to `images: string[]` of URLs, matching `products.js:29`. If it ever emitted objects, every product card in the storefront would break.

---

### (d) Error Handling

#### Boundaries

| File | Scope | Content |
|---|---|---|
| `app/global-error.tsx` | Root layout crash | Self-contained `<html>`/`<body>`, brand mark, Reload, Sentry event id. Production only |
| `app/(dashboard)/error.tsx` | Any dashboard route | The shell **stays rendered** (it lives in the layout above); only the content pane shows `ErrorState`. Sidebar remains usable |
| `app/(dashboard)/products/error.tsx` | Products segment | Adds "Back to products" |
| `app/(dashboard)/products/[id]/error.tsx` | One product | Scoped so a bad record cannot kill the list |
| `app/(dashboard)/orders/error.tsx` | Orders segment | Adds Retry + Copy request ID |
| `app/not-found.tsx` | Unmatched route | |
| `app/(dashboard)/products/[id]/not-found.tsx` | `notFound()` from the loader | "This product was deleted or never existed" |

`error.tsx` must be a Client Component and receives `reset()`. It **cannot catch an error thrown by the layout above it**, which is precisely why the boundary sits inside `(dashboard)` rather than relying on the root.

#### Toast policy

The single rule: **a toast is for a completed action whose result the user can no longer see.** Anything on screen gets inline treatment.

| Situation | Treatment |
|---|---|
| Save succeeded, user stays | Toast (`sonner`), 3s, no action |
| Save succeeded, user navigated away | Toast with a "View" link |
| Destructive succeeded | Toast + **Undo** where the action supports it, 8s |
| Field validation failure | **Inline** under the field. Never a toast |
| Form-level failure (`CONFLICT`, `INTERNAL`) | **Inline `<Alert variant="destructive">` at the top of the form**, focus moves to it |
| List fetch failed | **Full `ErrorState`** in the table body |
| Optimistic action failed | Toast (destructive) + automatic revert |
| 403 on an admin route | **Full-page state**, not a toast |
| Bulk action partial failure | Toast summary + inline per-row error markers |

Never toast a validation error: the user is looking at the offending field, and a corner popup makes them hunt for it.

#### Error code to user-facing copy

| Code | HTTP | Copy | Affordance |
|---|---|---|---|
| `VALIDATION_FAILED` | 422 | per-field messages | Focus first invalid field |
| `UNAUTHENTICATED` | 401 | "Your session expired. Sign in to continue." | Sign-in link preserving `callbackUrl` |
| `FORBIDDEN` | 403 | "This account does not have admin access." | Sign out / switch account. **No Retry** |
| `NOT_FOUND` | 404 | "This {entity} no longer exists." | Back to list |
| `CONFLICT` | 409 | "That slug is already used by another product." | Focus field, suggest a free slug |
| `RATE_LIMITED` | 429 | "Too many requests. Try again in a moment." | Retry after countdown |
| `INTERNAL` | 5xx | "Something went wrong on our end." | Retry + Copy request ID |
| network | — | "Cannot reach the server. Check your connection." | Retry |

Two hard rules: **never surface a raw exception message** (it leaks schema and stack detail into a browser), and **always render `requestId`** behind a `CopyButton` in the `INTERNAL` state, so an operator's screenshot is actionable.

#### Retry affordances

`reset()` for boundary errors; re-submit for actions; `router.refresh()` for stale lists. Retry appears only where retrying can plausibly help — a 403 gets no Retry button, because offering one is a lie.

#### Observability

`@sentry/nextjs` with client, server and edge configs, on the free tier, **errors only**.

- **Session Replay is off.** This admin displays COD shipping addresses and phone numbers; recording operator sessions creates a PII store with no compensating benefit for a single-operator tool, and it burns quota.
- `beforeSend` scrubs `email`, `phone`, `address`, `city`, `pinCode` from any captured payload. Indian PII, and the order flow captures all of it.
- Tags: `userId`, `role` (two roles, so it is a genuinely useful filter), and the API `requestId`, so a browser error and its server log line join.
- Source maps uploaded at build, hidden from the client.

---

### (e) Loading

#### `loading.tsx`, streaming, and one correction

`loading.tsx` wraps a segment in a Suspense boundary and shows on **navigation into that segment**.

**Correction, because the draft contradicted itself here:** a `nuqs` filter change wrapped in `useTransition` **does not** show `loading.tsx`. React keeps the current UI mounted for the duration of the transition. So there are two distinct loading languages and they must not be conflated:

| Trigger | What the user sees |
|---|---|
| First entry into a segment (sidebar click, deep link, refresh) | `loading.tsx` skeleton |
| Filter / sort / page change within a segment | Existing rows stay, table wrapper gets `opacity-60` + `pointer-events-none` + `aria-busy="true"`, toolbar stays fully interactive, a 2px indeterminate bar under the toolbar |

Keeping stale rows visible while re-querying is *better* than a skeleton flash here — comparison is the operator's job and blanking the table destroys their place.

Dashboard composition: the shell renders immediately, and each slow region owns its `<Suspense>` so stat cards and the recent-orders table stream independently instead of blocking on the slowest query.

| Route | Boundary |
|---|---|
| `/` dashboard | Per-region `<Suspense>`: stat row, orders-per-day chart, recent orders |
| `/products` | `loading.tsx` — header + toolbar + 10 skeleton rows |
| `/products/[id]` | `loading.tsx` — form skeleton with real field geometry |
| `/orders` | `loading.tsx` + inner `<Suspense>` for status-count facets |
| `/content/*` | `loading.tsx` — card-list skeleton |

#### Skeletons must match the final layout

A skeleton that does not match causes layout shift, which in an admin panel means a mis-click on a row action. Skeleton rows are exactly the committed **44px** row height, with the same column count and widths, and the skeleton toolbar reserves the real control heights. Rule: **the skeleton is built from the same layout component as the real table**, with `Skeleton` blocks in the cells — never a hand-drawn approximation that drifts the moment a column is added. Ten skeleton rows against a 25-row default: enough to fill the fold, cheap to paint.

#### `useOptimistic`

Used for **cheap, binary, reversible** changes only:

| Control | Where |
|---|---|
| `isFeatured` toggle | Products table row |
| `isOnSale` toggle | Products table row |
| `isActive` toggle | Reels, promo banners, announcements |
| Reorder (drag) | Reels, banners, announcements, FAQ |
| Row delete | Optimistic removal + Undo toast |

Not used for: product save (multi-field, validated, conflict-prone), or **order fulfilment/payment changes** — those are recorded in an order status history and an operator must never see "SHIPPED" for a write that failed.

On failure the optimistic value reverts automatically when the transition ends, and a destructive toast explains why. The toggle stays **interactive but pending**, not disabled — disabling a switch mid-flight makes rapid correction impossible.

#### Pending button pattern

One `<SubmitButton>` in `components/shared`. Spinner replaces a leading icon, never the label; width fixed with `min-w`; `aria-busy` set; button disabled, form not. `ConfirmDialog` keeps the dialog open while pending and closes only on success.

---

### (f) Component Architecture

#### Directory convention

```
admin_panel/src/
  app/
    (auth)/sign-in/
    (dashboard)/                 layout.tsx = shell + requireAdmin + UnsavedChangesProvider
      page.tsx                   dashboard
      products/  orders/  customers/  content/  media/  settings/
      error.tsx  loading.tsx
    api/public/v1/               the storefront-facing read API (versioned, cached, tagged)
    global-error.tsx  not-found.tsx
  components/
    ui/                          shadcn/ui, generated, UNMODIFIED except tokens
    shared/                      cross-feature, zero domain knowledge
      data-table/
        data-table.tsx  data-table-toolbar.tsx  data-table-faceted-filter.tsx
        data-table-pagination.tsx  data-table-column-header.tsx
        data-table-view-options.tsx  data-table-bulk-bar.tsx
        data-table-empty.tsx  data-table-skeleton.tsx
      page-header.tsx  stat-card.tsx  status-badge.tsx
      confirm-dialog.tsx  form-sheet.tsx  empty-state.tsx  error-state.tsx
      media-picker.tsx  image-uploader.tsx  sortable-list.tsx
      date-range-picker.tsx  money-input.tsx  slug-input.tsx
      copy-button.tsx  timeline.tsx  submit-button.tsx  guarded-link.tsx
      bar-chart-card.tsx
    layout/
      app-sidebar.tsx  nav-main.tsx  nav-user.tsx
      app-header.tsx  breadcrumbs.tsx  theme-toggle.tsx  mobile-nav.tsx
  features/
    products/   components/ (columns.tsx, product-form.tsx, variant-fields.tsx,
                variant-image-grid.tsx, product-filters.tsx, price-fields.tsx)
                schema.ts  actions.ts  queries.ts  types.ts
    orders/     components/ (columns.tsx, order-detail.tsx, status-stepper.tsx,
                shipping-card.tsx, order-filters.tsx)  schema.ts  actions.ts  queries.ts
    customers/  content/  media/  settings/  dashboard/  auth/
  lib/          auth.ts  db.ts  format.ts  guards.ts  serializers/public/  errors.ts
  hooks/        use-async-list.ts  use-table-prefs.ts  use-unsaved-changes.ts
  config/       nav.ts  status.ts  table-keys.ts
```

`lib/serializers/public/` is a deliberately named directory: it holds the functions that convert internal records into the exact `src/data/*.js` shapes. They are the cutover contract, and they carry the only unit tests this blueprint insists on.

#### The graduation rule

A component moves from `features/<x>/components/` to `components/shared/` when **both** hold:

1. A **second** feature needs it, and
2. Its props reference **no domain type** — only primitives, generics and `ReactNode`.

If (1) holds but (2) does not, generalise it first, or copy it. Premature sharing is worse than duplication: a shared component with `Product` in its props becomes a coupling point every feature must negotiate.

Two enforcement rules: `components/ui/` is never hand-edited (upgrades must stay mechanical; theming happens through CSS variables), and **features never import from each other** — cross-feature needs go through `components/shared` or `lib`, enforced with `import/no-restricted-paths`.

#### Component inventory (v1)

| Component | Responsibility | Built on |
|---|---|---|
| `DataTable` | Generic table: `ColumnDef[]`, toolbar slot, faceted filters, server pagination, selection, sticky header, empty state, density | `@tanstack/react-table` v8 + shadcn `table` |
| `DataTableFacetedFilter` | Multi-select filter with counts, writes URL | `popover` + `command` + `checkbox` |
| `DataTablePagination` | Page size, page N of M, first/prev/next/last | `select` + `button` |
| `PageHeader` | Title, description, breadcrumb, action slot | — |
| `StatCard` | Label, value (`tabular-nums`), delta | `card` |
| `StatusBadge` | Status enum to token variant | `badge` |
| `ConfirmDialog` | Title/description/confirm label, destructive variant, typed confirmation for high-risk | `alert-dialog` |
| `FormSheet` | Side-sheet form: header, scroll body, sticky footer, dirty guard | `sheet` |
| `MediaPicker` | Browse/search/page the media library, single or multi select | `dialog` + `command` + `useAsyncList` |
| `ImageUploader` | Drag-drop, presigned PUT, XHR progress, preview, reorder, alt text | `@dnd-kit` |
| `SortableList` | Keyboard-accessible reorder, drag handle, `position` rewrite | `@dnd-kit/sortable` |
| `DateRangePicker` | Presets (Today, 7d, 30d, This month) + custom; writes `from`/`to` | `popover` + `calendar` |
| `EmptyState` | Icon, title, description, primary + secondary action | — |
| `ErrorState` | Message, retry, request id + `CopyButton` | `alert` |
| `CopyButton` | Copy + 2s check, `aria-live` confirmation | `button` + `tooltip` |
| `MoneyInput` | Rupee prefix, rupee display, **integer-paise value**, `tabular-nums`, no spinner | `input` |
| `SlugInput` | Auto-derive from title until manually edited, then lock; live availability check | `input` |
| `Timeline` | Vertical event list — order status history | — |
| `BarChartCard` | The one chart: orders per day | shadcn `chart` + recharts |
| `SubmitButton` / `GuardedLink` | per (c) | — |
| `AppSidebar` | Collapsible nav, active state, admin-only | shadcn `sidebar` |

**Cut from the inventory, with reasons** — a component list is a budget, and every entry is code someone maintains:

| Cut | Reason |
|---|---|
| `RichTextEditor` (Tiptap) | Would emit HTML the storefront cannot render without a code change. **[LATER, blocked on storefront renderer]** |
| `EntityCombobox<T>` | No v1 screen picks an entity; the admin does not edit order line items |
| `TagInput` | No `tags` field exists or can be displayed |
| `ActivityFeed` / general audit log | One admin account. Order status history covers the operationally necessary case. **[LATER, when a second admin exists]** |
| `CommandMenu` (Cmd-K) | Eight nav items and one operator; the sidebar is faster than teaching a palette. **[LATER]** |
| `LineChart`, `Sparkline` | Nothing has a time series worth a line until orders flow. **[LATER]** |

**On `DataTable`:** headless TanStack Table, not a batteries-included grid. This app needs server-driven pagination, custom cells (thumbnail + title, rupee money, status badge) and full styling control; a data-grid library fights all three and ships hundreds of kilobytes to render 25 rows.

#### `StatusBadge`: the status vocabulary

**Stated plainly: none of this exists today.** The storefront writes exactly one status string, `"ORDER PLACED"`, into `localStorage["niyaOrders"]`. The admin **defines** this vocabulary. At cutover the legacy value maps to `PLACED`, not to `CONFIRMED` — a legacy record was never reviewed by anyone, and silently promoting it to "confirmed" would tell the operator a confirmation call happened that did not. (This corrects the draft's mapping, which contradicted its own definition of `CONFIRMED`.)

Because the store is **COD-first**, fulfilment and payment are genuinely orthogonal — a COD order is `DELIVERED` and *then* `PAID`. Two axes, not one.

**Fulfilment status**

| Status | Token | Meaning |
|---|---|---|
| `PLACED` | neutral | Received, not yet reviewed. Legacy `"ORDER PLACED"` maps here |
| `CONFIRMED` | info | Verified — a COD order needs a confirmation call |
| `PACKED` | info | Ready for the courier |
| `SHIPPED` | info | With the courier, AWB recorded |
| `DELIVERED` | success | Terminal, good |
| `CANCELLED` | danger | Terminal, before dispatch |
| `RETURN_REQUESTED` | warning | Needs action |
| `RETURNED` | neutral | Terminal |

**Payment status**

| Status | Token |
|---|---|
| `COD_PENDING` | neutral |
| `PAID` | success |
| `REFUNDED` | neutral |

`PENDING` and `FAILED` are **removed from v1**, not "reserved". **No payment gateway is integrated anywhere in the storefront** — `"ONLINE"` is a radio option with no handler. A status that can never be reached is a UI that implies a capability the business does not have, and an operator will eventually ask why an order is stuck in `PENDING`. They return with the gateway.

**Product status:** `DRAFT` neutral, `PUBLISHED` success, `ARCHIVED` neutral-muted.

**Accepted trade-off, stated rather than glossed:** three fulfilment states share the `info` hue, so colour alone groups them as "in progress" and the **label** distinguishes them. That is the price of a five-hue cap, and it is the right price — status is never colour-only anywhere in this design, and the `/orders` faceted filter shows a count per status so an operator filters rather than scans for a shade.

---

### (g) Design System

#### Palette: neutral-first, one accent

**Neutrals do the work.** A light-neutral surface with a near-black text ramp; colour appears only in status badges and the accent. A grid of gold luxury cards is what a *storefront* looks like — an admin must let an operator find one anomalous row in fifty.

**The accent decision, with the arithmetic.** Brand gold `#c39920` measures **2.66:1 on white** — it fails AA for normal text (4.5:1) and even for large text (3:1). It can neither carry white text nor be text on white. Brand deep teal `#073b4c` measures **12.1:1 on white**.

**Committed: the admin accent is `#073b4c`.** Brand-derived, high contrast, works as a solid primary button with white text. **Gold is demoted to a non-text brand marker** — the sidebar logo lockup and the 2px active-nav indicator rail, where text contrast rules do not apply. One exception: `#073b4c` text *on* `#c39920` measures **4.54:1** and passes AA, so a gold "Featured" badge with deep-teal text is allowed. That badge is the entire gold budget.

| Token | Light | Dark |
|---|---|---|
| `--background` | `#ffffff` | `#0d1418` |
| `--card` / `--popover` | `#ffffff` | `#121b20` |
| `--muted` | `#f6f7f8` | `#182228` |
| `--foreground` | `#0e1a1f` | `#eef2f3` |
| `--muted-foreground` | `#64757b` (4.8:1) | `#93a4aa` (7.2:1) |
| `--border` | `#e4e8ea` | `#26343a` |
| `--input` | `#d8dee1` | `#2e3d43` |
| `--primary` | `#073b4c` | `#4db3cf` |
| `--primary-foreground` | `#ffffff` | `#06222c` |
| `--ring` | `#0d6e8c` | `#4db3cf` |
| `--brand-gold` (decorative only) | `#c39920` | `#d2a92e` |

Dark mode inverts the **role**, not the hue: `--primary` lightens to `#4db3cf` because `#073b4c` is invisible on a dark surface. The dark neutrals echo the storefront's `#101c20` family so the two apps feel related without sharing a stylesheet — they share nothing, and they are separate deploys on separate domains.

**Semantic status tokens — exactly five hues.** The cap is the structural guard against a rainbow dashboard.

| Semantic | Light bg / border / text | Dark bg / border / text | Used by |
|---|---|---|---|
| neutral | `#f4f5f6` / `#e0e4e6` / `#4a5a60` | `#1b262b` / `#2c3a40` / `#a5b4b9` | PLACED, RETURNED, DRAFT, ARCHIVED, COD_PENDING |
| info | `#eef4fe` / `#cddef7` / `#1a4f9c` | `#101d33` / `#1e3557` / `#8ab4f0` | CONFIRMED, PACKED, SHIPPED |
| success | `#ecfdf5` / `#c7ecda` / `#046c4e` | `#0c2620` / `#17453a` / `#5fd3a6` | DELIVERED, PAID, PUBLISHED, Active |
| warning | `#fffaeb` / `#f4e2b3` / `#7a5200` | `#2a2110` / `#4a3a17` / `#e3b64a` | RETURN_REQUESTED |
| danger | `#fef2f2` / `#f6cfcf` / `#a01b1b` | `#2b1416` / `#4d2124` / `#f08b8b` | CANCELLED, destructive |

Two corrections from the draft: the `info` ramp is moved off teal onto a true blue, because a teal `info` badge sitting next to a teal `--primary` reads as the same thing (in dark mode the draft's `#7cc4de` info and `#4db3cf` primary were nearly the same colour); and the warning dark-mode text value is `#e3b64a` (the draft's cell was corrupted). Every text/background pair above measures at or above 4.5:1 against its own tinted background in its own mode.

Badges are **subtle-tinted with a 1px border and a 6px leading dot**, never solid saturated fills — solid badges at 44px row density read as alarm noise.

#### Typography

| Role | Size / line-height | Weight |
|---|---|---|
| Micro (badge, table meta, help) | 11 / 16 | 500 |
| Small (labels, secondary) | 12 / 16 | 500 |
| **Base** (body, table cells, inputs) | **13 / 20** | 400 |
| Emphasis (card title, table header) | 13 / 20 | 600 |
| Section heading (h3) | 15 / 22 | 600 |
| Page title (h1) | 20 / 28 | 600 |
| Stat value | 28 / 34 | 600, `tabular-nums` |

**Font: Inter Variable via `next/font/google`**, bound to `--font-sans`, with `font-feature-settings: "cv11", "ss01"` for a disambiguated `l` / `1` / `I`. The justification is **order identifiers** like `NIYA-1723…` and slugs, not SKUs — there are no SKUs in v1, and a rationale that cites a field the system does not have is a rationale nobody can check.

**Cormorant Garamond is deliberately not used.** The storefront's serif is brand expression for shoppers; in a dense operations tool it costs legibility and vertical rhythm. The admin is monotype sans. Self-hosting through `next/font` also avoids the storefront's render-blocking Google Fonts `<link>`.

Base is **13px, not 16px**: a storefront optimises for reading one product, an admin for scanning fifty rows. `tabular-nums` is mandatory on every numeric column so rupee figures align — proportional digits in a price column make comparison impossible.

#### Spacing, radius, elevation, density

- **Spacing:** 4px base. Page gutter 24 desktop / 16 tablet / 12 mobile. Card padding 16. Form field gap 16, section gap 24. Toolbar gap 8.
- **Radius:** `--radius: 6px` (sm 4 / md 6 / lg 8). Shadcn's 8px default is slightly soft for dense tables. Badges are pill.
- **Elevation — borders over shadows.** Cards, tables and panels get `1px solid var(--border)` and **no shadow**. Shadow is reserved for things that genuinely float: `dropdown-menu`, `popover`, `dialog`, `sheet`, `tooltip`, `sonner`, and the sticky bulk-action bar. Two shadow tokens total. On a screen with eight panels, shadows create false depth; borders create structure.
- **Density:** table row **44px** default / **36px** compact, toggled in view-options and persisted per table (see the localStorage key scheme in (a)). Inputs and buttons 32px (sm) / 36px (default), smaller than shadcn's 40px, matching the 13px base.
- Tokens are authored as hex here for reviewability and mapped to utilities through Tailwind v4 `@theme inline`, matching the storefront's authoring style so the team is on familiar ground — even though the two apps share no stylesheet.

#### Table rules

- Row 44px (36px compact); header 40px, weight 600, `--muted-foreground`, sticky with a `--background` fill and a bottom border.
- **No zebra striping.** It fights hover and selected states and adds a band pattern competing with status colour. A 1px row divider at `--border` instead.
- Hover `--muted`; selected `--muted` plus a 2px `--primary` left border; focus a `--ring` outline.
- Numeric, currency and date columns **right-aligned with `tabular-nums`**. Everything else left.
- Identity column pinned on horizontal scroll; row-actions column pinned right, 48px, `aria-label`led.
- Sticky header only. The page scrolls; the table body does not own a vertical scroll container. Nested scroll regions are the most-hated pattern in admin UIs.
- Never truncate a price or a status. Truncate titles and descriptions with a `title` attribute plus tooltip.

#### Button hierarchy

| Level | Variant | Rule |
|---|---|---|
| Primary | `default` (solid `--primary`) | **Exactly one per view** |
| Secondary | `outline` | Cancel, Export, Add variant |
| Tertiary | `ghost` | Row actions, toolbar icons, nav |
| Destructive | `destructive` | Only inside `ConfirmDialog`, never a bare row button |
| Link | `link` | Inline navigation in prose |

Destructive actions are never the page's primary button. Delete lives in the row's dropdown under a separator, styled destructive, always routed through `ConfirmDialog`. Deleting a product referenced by an order is refused server-side with `CONFLICT` and an "Archive instead" affordance — archiving preserves order history, which deletion destroys.

#### Dialog vs Sheet vs Page

| Use | Component | When |
|---|---|---|
| **AlertDialog** | `alert-dialog` | Destructive or irreversible. Blocks. No X, no outside-click dismiss |
| **Dialog** | `dialog` | 4 fields or fewer, self-contained. "Add announcement", "Rename". Max 520px |
| **Sheet** (right, 480–640px) | `sheet` | 5+ fields, or the list behind is needed for context. Order status update, media picker |
| **Full page** | route | Nested field arrays or 10+ fields. **Product create/edit is a page** — variants times images cannot breathe in 480px |
| **Drawer** (bottom) | `drawer` (vaul) | **Mobile only** (<768px): every Dialog and Sheet becomes a bottom Drawer |

Decision rule: *does the user need to see what is behind it?* Yes, Sheet. No and short, Dialog. No and long, page. Irreversible, AlertDialog.

#### Empty-state anatomy

Five slots in order: **icon** (20px, `--muted-foreground`, in a 40px `--muted` circle), **title** (15/22, 600, stating the fact), **description** (13/20, `--muted-foreground`, max 42ch, stating why or what next), **primary action**, **secondary link**. Centred, 48px vertical padding, inside the table's border — never a bare centred string.

Three distinct empties, and conflating them is a real failure: **no data at all**, **no results for these filters** (with a **Clear filters** button), and **error** (`ErrorState`, never `EmptyState`).

This matters unusually much here. **Until cutover, `/orders` and `/customers` are genuinely, permanently empty**, and for two different reasons that the copy must distinguish:

| Screen | Empty-state copy | Why |
|---|---|---|
| `/orders` | "No orders yet. The storefront still saves orders to the browser (`localStorage`) and does not call this API. Orders will appear here after the order cutover." | `createOrder` is commented out and `src/api/orderApi.js` does not exist |
| `/customers` | "No customers yet. The storefront still signs users in against browser storage. Customers will appear here after the auth cutover." | `authApi.js` is 100% localStorage fake auth |
| `/products` | Never empty after the one-time catalogue import | ~40 products imported from `src/data/products.js` |

**No seeded demo data anywhere, ever.** A dashboard showing fake revenue is exactly how a stakeholder ends up believing the integration is finished.

#### Dark mode

CSS custom properties on `:root` and `.dark`, toggled by `next-themes` with `attribute="class"` and `disableTransitionOnChange` — the storefront's own 250ms `body` colour transition produces a visible smear on toggle, and that mistake is not repeated. `suppressHydrationWarning` on `<html>`.

Every colour is defined as a token on `:root` first; `.dark` only **redefines** tokens. No colour may have its sole definition inside `.dark`.

#### Focus and accessibility

- `:focus-visible` only — 2px `--ring` outline, 2px offset. Never `outline: none` without a replacement.
- **Standard tab order, not a custom grid.** Tab moves toolbar to table to row actions; the row checkbox and the identity-cell link are the two focusable stops per row; `Enter` on the link opens the record. Arrow-key row navigation is **deliberately not implemented** — hijacking arrows on a real `<table>` breaks screen-reader table navigation, and it is a worse outcome than the standard behaviour it replaces. (This corrects the draft, which specified a roving-grid model incompatible with its own table semantics.)
- Real `<table>` / `<th scope="col">`, `aria-sort` on sortable headers, `<caption class="sr-only">` naming the table, and an `aria-live="polite"` region announcing "25 of 40 products" after a filter settles.
- Every icon-only button carries `aria-label`. Drag handles carry `aria-roledescription="sortable item"` and dnd-kit's announcements are wired.
- Contrast: 4.5:1 body text, 3:1 UI boundaries and large text. Status is **never** colour-only — every badge has a text label.
- Dialogs trap focus and restore it to the trigger (Radix does this; do not hand-roll a modal).
- `prefers-reduced-motion` disables all transitions.

#### Anti-patterns — explicitly banned

1. **No gradients anywhere.** No gradient buttons, headers, cards or chart fills. (The draft carved out a gradient scroll-mask exception and thereby contradicted its own rule; the horizontal-scroll affordance is instead a `box-shadow` on the pinned cell, applied only while `scrollLeft > 0` — a standard technique that needs no exception.)
2. **No huge cards.** No 200px stat tiles; `StatCard` is about 88px.
3. **No rainbow dashboards.** Five status hues, one accent. Charts use the accent plus neutral ramps, never a distinct hue per series.
4. **No gratuitous animation.** 150ms ease-out for hover/focus, 200ms for overlay enter/exit. No entrance animations, no count-up numbers, no skeleton shimmer that outlives the fetch.
5. No emoji as UI iconography — `lucide-react` only.
6. No glassmorphism or backdrop blur, except the standard dialog scrim.
7. No decorative full-bleed hero imagery in the admin.
8. No nested vertical scroll containers.
9. No modals opened from modals.
10. No colour-only status.
11. **No control that cannot affect anything.** If a setting has no consumer — now or at cutover — it does not ship. This is what keeps shipping-fee and trust-badge editors out of v1.

#### shadcn components per screen type

| Screen | Components |
|---|---|
| **List** (products, orders, customers) | `table`, `checkbox`, `badge`, `button`, `input`, `dropdown-menu`, `popover`, `command`, `select`, `separator`, `skeleton`, `tooltip`, `alert-dialog`, `sonner` |
| **Detail/Form** (product edit, footer page) | `form`, `input`, `textarea`, `select`, `switch`, `checkbox`, `label`, `tabs`, `card`, `separator`, `accordion`, `alert`, `sheet`, `dialog`, `sonner` |
| **Dashboard** | `card`, `chart`, `select`, `badge`, `skeleton`, `separator` |
| **Content editor** (banners, reels, announcements, FAQ) | `card`, `switch`, `dialog`, `drawer`, `input`, `textarea`, `badge`, `separator`, `alert-dialog` |
| **Media library** | `dialog`, `command`, `scroll-area`, `aspect-ratio`, `skeleton`, `context-menu` |
| **Auth** | `card`, `input`, `label`, `button`, `alert` |
| **Shell** | `sidebar`, `breadcrumb`, `avatar`, `dropdown-menu`, `sheet`, `tooltip`, `separator` |

---

### (h) Responsiveness

Desktop-first, deliberately. This is an operations tool used at a desk. Tablet is a real secondary case (checking orders on an iPad). Phone is **triage only** — view orders, change a status, toggle a banner. Product editing with nested variants and image reordering is not a phone task, and pretending otherwise produces a bad experience at both ends.

| Breakpoint | Width | Target | Layout |
|---|---|---|---|
| `2xl` | 1536+ | Large desktop | Sidebar 240px, content max 1440px centred, all columns |
| `xl` | 1280–1535 | **Primary** | Sidebar 240px, full tables |
| `lg` | 1024–1279 | Laptop / landscape tablet | Sidebar collapses to a **56px icon rail**, low-priority columns hidden |
| `md` | 768–1023 | Portrait tablet | Sidebar becomes a `Sheet` behind a hamburger; filters collapse into a "Filters" sheet with a count badge; 2-col forms become 1-col |
| `<md` | <768 | Phone, triage | Bottom nav; every Dialog/Sheet becomes a bottom `Drawer`; tables degrade per the rule below |

Sidebar progression **240px, 56px icon rail (tooltips on hover), Sheet**. The icon-rail step is what makes 1024–1279 usable without losing navigation; jumping straight from full sidebar to hamburger wastes a laptop viewport. shadcn's `sidebar` provides all three states, and the collapsed flag persists in a **cookie** so the first server render is already correct and there is no flash.

**Mobile bottom nav — the four destinations, committed:** Orders, Products, Content, More (a Drawer holding Customers, Media, Settings, Sign out). Orders is first because it is the only thing anyone opens a phone for.

#### Table degradation — committed per screen

| Screen | <768px | Why |
|---|---|---|
| **Products** | **Horizontal scroll, identity column pinned** (thumbnail + title) | The job is comparing price / sale / status across rows; a card list destroys comparison |
| **Orders** | **Card list** | The mobile job is "look at *this* order": id, customer, rupee total, both status badges, one action. Sequential, not comparative |
| **Customers** | **Card list** | Name, email, order count |
| **Content** (banners, reels, announcements, FAQ) | **Card list at every size** — never a table | These are visual, ordered and toggleable; a table is the wrong form even at 1440px |
| **Media library** | **Grid at every size** (4 to 3 to 2 columns) | Images |
| **Dashboard** | Stat cards 4 to 2 to 1 column; the chart full width, minimum 240px tall | |

Products column hide order as width shrinks: `updatedAt`, then `orderCount`, then `rating`, then `subcategory`, then `gender`. Never hidden: thumbnail + title, price, status, actions.

Horizontal scroll lives on the table wrapper (`overflow-x: auto`) with a sticky first cell; **the page body never scrolls horizontally**. The scroll affordance is the pinned cell's `box-shadow`, per anti-pattern 1.

---

### (i) Dependency ledger and the [LATER] register

A dependency list is a maintenance commitment, so it is stated once, explicitly, with the cuts visible.

**v1 dependencies:** `next`, `react`, `typescript`, `next-auth` (Auth.js v5), `@prisma/client` + `prisma`, `tailwindcss` v4, `shadcn/ui` primitives (Radix), `nuqs`, `@tanstack/react-table`, `react-hook-form`, `@hookform/resolvers`, `zod`, `@dnd-kit/core` + `/sortable` + `/modifiers`, `react-day-picker`, `sonner`, `lucide-react`, `next-themes`, `vaul`, `recharts`, `@sentry/nextjs`, `server-only`.

**Cut from the draft's list, with the trigger that would bring each back:**

| Dropped | Trigger to adopt |
|---|---|
| `@tanstack/react-query` | A third independent client-side read, or two client reads needing a shared cache |
| `@tiptap/react` | A storefront renderer capable of displaying rich content (a storefront change, out of scope) |
| `zustand` | Cross-tree client state that Context genuinely cannot carry |
| `date-fns` | A date computation `Intl` cannot express |

**The [LATER] register — deferred, with the reason, so nothing is quietly forgotten:**

| Item | Deferred because |
|---|---|
| Inventory / stock | Nothing can decrement it until orders flow through the API |
| SKU | Nothing scans or reconciles it |
| Product tags | The storefront has no tag surface |
| Order-queue polling | Zero orders exist; one operator, one screen |
| General audit log / `ActivityFeed` | One admin account; order status history covers the operational need |
| Cmd-K command menu | Eight nav items and one operator |
| Line charts / sparklines | No time series worth plotting until orders exist |
| Coupons / discount rules | No coupon or campaign entity exists anywhere; the sale page filters on `isOnSale` |
| Customer reviews as an entity | `reviewsData` is three editorial testimonials with no rating, date or product link |
| Payment status `PENDING` / `FAILED`, refunds | No gateway is integrated anywhere |
| Rich text / structured page blocks | Requires a storefront renderer change |

#### The one testing commitment

Not a test strategy, one commitment: `lib/serializers/public/` gets snapshot tests asserting that each serialiser's output **deep-equals the corresponding object in `src/data/*.js`** (product shape, home blocks, footer shape), with the storefront's data file copied into the admin's test fixtures — read, never imported, and never modified. Those tests are the only automated proof that the cutover will be mechanical. Everything else can be verified by looking at it; this cannot.


**Decisions**

- FIX: Added a section-0 'reach table' making explicit which storefront surfaces the admin can EVER control through the src/api/*.js cutover and which it never can - cart and wishlist (device-local localStorage), the shipping-fee rule (hardcoded at OrderPage.jsx:82, not behind any api module), TrustBadges copy (hardcoded in the component), and payment (no gateway). The draft implied broader reach than the boundary permits.
- FIX: Corrected the draft's claim that orders are reachable by the pure src/api cutover - src/api/orderApi.js DOES NOT EXIST (OrderPage.jsx:20 imports it in a comment), so orders need one new file plus one uncommented line in a page component. Stated as the one place the cutover exceeds a pure src/api edit.
- FIX: Killed the draft's 'cell contents are Server Components passed as ReactNode' architecture - TanStack Table evaluates ColumnDef.cell inside the client table instance, so server-rendered cells are impossible. Replaced with serialisable row DTOs plus pinned en-IN / Asia/Kolkata formatters in lib/format.ts, which also closes the hydration-mismatch hole the draft left open.
- FIX: Removed caching from admin reads entirely. The draft applied unstable_cache/tags to admin screens; Prisma reads are not fetch so next.tags never applies, and deliberately caching the one screen that must show truth is a staleness bug for 40 rows. Caching and the whole tag scheme now live exclusively on the public read API - which is honest about the tags paying off only at cutover.
- FIX: Dropped @tanstack/react-query as a v1 dependency (the draft permitted it in four places). Two of the four were invented - the admin does not edit order line items, and 'related products' is derived by getSuggestedProducts(), not curated - and order polling is pointless with zero orders. The two real client reads are served by one useAsyncList hook with an AbortController plus a monotonic request-id guard (aborting alone does not prevent out-of-order resolution). Named the re-entry trigger so it is a decision, not dogma.
- FIX: Dropped Tiptap/RichTextEditor. Emitting HTML would force the storefront to adopt dangerouslySetInnerHTML - a storefront code change, i.e. a direct constraint violation. Marked [LATER, blocked on a storefront renderer change].
- FIX: Replaced the draft's generic footerPageSchema with blocks[] - footerPagesData shapes are ad hoc per slug and rendered by bespoke components, so a block editor would emit structure nothing can render. Now a discriminated union keyed on slug, one member per real page, plus a guarded raw-JSON escape hatch.
- FIX: Introduced an explicit 'shape-fidelity rule' and lib/serializers/public/. The draft's own fieldErrors example (variants.1.images.0.url) implied image objects, but products.js:29 shows images as a flat string[] - the admin stores {mediaId,url,alt,position} internally and the serialiser flattens to URL strings, or every storefront product card breaks.
- FIX: Cut sku, stock/inventory and tags from v1 (the draft's assumptions demanded the API add all three). Nothing scans a SKU, nothing can decrement stock until orders flow through the API, and there is no tag surface. Kept product status DRAFT/PUBLISHED/ARCHIVED as the one genuinely needed new field, with the honest note that unpublishing is invisible until cutover.
- FIX: Changed the legacy order-status mapping from CONFIRMED to PLACED. The draft mapped the storefront's single 'ORDER PLACED' string to CONFIRMED while defining CONFIRMED as 'verified, needs a COD confirmation call' - a self-contradiction that would tell the operator a call happened that did not.
- FIX: Deleted payment statuses PENDING and FAILED rather than 'reserving' them. No gateway exists anywhere; an unreachable status implies a capability the business does not have. Payment axis is now COD_PENDING / PAID / REFUNDED.
- FIX: Repaired the corrupted palette cell ('#e3b champ' -> #e3b64a) and moved the info ramp off teal onto true blue - the draft's dark info text #7cc4de and dark --primary #4db3cf were nearly the same colour, so 'info' and 'primary' were visually indistinguishable.
- FIX: Corrected the gold-on-teal contrast figure to 4.54:1 (draft said 4.51) and the fallback-gold note - #8a6a12 actually measures 5.06:1 on white, comfortably past AA rather than 'reaching' it.
- FIX: Resolved the loading contradiction. The draft claimed a filter change 'paints a skeleton immediately' in (e) while correctly saying 'the table dims rather than blanking' in (a). Committed two distinct loading languages: loading.tsx only on segment entry, dim + aria-busy + indeterminate bar for in-segment transitions, since keeping stale rows preserves the operator's place.
- FIX: Removed the gradient scroll-mask exception, which contradicted anti-pattern 1 (no gradients). The horizontal-scroll affordance is now a box-shadow on the pinned cell applied while scrollLeft > 0 - standard, and needs no carve-out.
- FIX: Removed the custom arrow-key row-navigation grid model, which was incompatible with the draft's own real-<table> semantics - hijacking arrows breaks screen-reader table navigation. Standard tab order with two focusable stops per row instead.
- FIX: Disambiguated the searchParams contract - the draft reused status[] across products and orders where orders have two orthogonal status axes. Now status[] (product), fulfillment[], payment[]. Also moved minPrice/maxPrice from paise to whole rupees in the URL (paise in a URL is user-hostile) and dropped pageSize=10.
- FIX: Committed the money boundary precisely: integer paise in DB and internal API, whole rupees in URL and MoneyInput, conversion in exactly two places, and .multipleOf(100) on price so a value can never be un-representable in the storefront's whole-rupee shape.
- FIX: Corrected the tag scheme - content:home:featured was outside the draft's own naming grammar and mis-filed; isFeatured is a product field, so it is product:facet:featured. Mis-filing it would leave the featured rail stale after a product edit.
- FIX: Removed revalidatePath('/') from settings.update (public API routes are not '/') and removed public tags from order mutations - there is no public order endpoint.
- FIX: Specified the read path the draft left unsaid: direct Prisma in features/*/queries.ts with import 'server-only', Server Actions calling the same service layer, a separately versioned app/api/public/v1/* for the cutover, and an explicit ban on the admin self-fetching its own Route Handlers.
- FIX: Added the missing authorisation decision - a single requireAdmin() at the top of every query and action as the security boundary, with middleware and layout checks demoted to UX. Two roles only, ADMIN and USER.
- FIX: Removed UNAUTHENTICATED from the ActionResult union (unreachable - the Auth.js middleware redirects before an action body runs) while keeping it in the HTTP-level error table.
- FIX: Added the localStorage table-preference key scheme (niya_admin:table:<key>:v1) with the explicit rule to read it in useEffect, never during render - the draft named a density key but omitted the hydration rule that makes it safe.
- FIX: Cut EntityCombobox, TagInput, ActivityFeed/audit log, CommandMenu, LineChart and Sparkline from the v1 inventory with a stated trigger for each. Kept order status-history Timeline as the one operationally necessary history surface for a single-operator store.
- FIX: Dropped Sentry Session Replay - recording operator sessions that display COD addresses and phone numbers creates a PII store with no compensating benefit for one operator. Kept errors-only reporting, PII scrubbing (now including city) and requestId correlation.
- FIX: Retargeted the Inter cv11/ss01 justification from SKUs (which v1 does not have) to order IDs and slugs - a rationale citing a nonexistent field cannot be checked.
- FIX: Split the empty-state honesty in two, because /orders and /customers are empty for different reasons (order API absent vs authApi being localStorage fake auth), and those are two separate cutovers with different risk profiles.
- FIX: Pinned array lengths in craftsmanshipSchema (2 paragraphs, 3 stats) and stripped reviewSchema to {name, location, text} - adding a rating field would create a control whose value nothing on the storefront displays.
- FIX: Scoped the next/link ESLint ban to components/layout/** rather than repo-wide, and armed the unsaved-changes guard only while a dirty form is registered, so the guard costs nothing on list screens.
- FIX: Added anti-pattern 11 - 'no control that cannot affect anything' - as the structural rule that keeps shipping-fee and trust-badge editors out of v1, and added a dependency ledger plus an explicit [LATER] register so every deferral carries its reason and its re-entry trigger.
- FIX: Added the one testing commitment the draft omitted: snapshot tests asserting each public serialiser deep-equals the corresponding object in src/data/*.js, using the storefront's data files as read-only fixtures - the only automated proof that the cutover will be mechanical.

**Open assumptions**

- Order cutover scope: making orders reach the admin requires CREATING src/api/orderApi.js and uncommenting one line in OrderPage.jsx:144 - src/api/orderApi.js does not exist today. This slightly exceeds 'confined to src/api/*.js'. Confirm this is acceptable, or accept that orders stay in localStorage indefinitely.
- The admin accent is brand teal #073b4c, not brand gold #c39920 (2.66:1 on white, fails AA even for large text). If gold is mandated as the primary button colour, either the failure is accepted in writing or gold is darkened to #8a6a12 (5.06:1).
- Shipping fee (free over Rs 2000, else Rs 100) and TrustBadges copy are hardcoded inside storefront components, not behind any api module. Confirm you accept that these are NOT admin-editable under the zero-storefront-changes constraint - making them editable is a separate storefront change we have not scoped.
- Payment status is COD_PENDING / PAID / REFUNDED only. Confirm no gateway is planned in this phase; PENDING/FAILED/refund flows return with a gateway.
- No rich text anywhere in v1. Product descriptions and static pages stay plain text because the storefront renders plain strings. Confirm, or accept that rich text requires a storefront renderer change.
- No inventory/stock and no SKU in v1. Confirm you do not need out-of-stock control before the order cutover; DRAFT/ARCHIVED status is the v1 way to take an item off the store.
- The public read API must serialise byte-compatibly with src/data/*.js: price in whole rupees, variants[].images as string[] of URLs, gender/category/subcategory literals unchanged. The API/backend section must commit to this or the cutover stops being mechanical.
- The API mints stable variant ids and returns them on every product read. Without this the CartContext.jsx:31 dedupe collapse cannot be fixed at cutover.
- Object storage with presigned uploads (S3/R2/UploadThing) exists for MediaPicker/ImageUploader. The one-time catalogue import must record the storefront's existing relative paths (e.g. /products/bags/handbags/*.jpeg) as literal string references, not re-upload them, or editing a product would silently break its images.
- One User table with role ADMIN | USER. Until the auth cutover it contains only admin accounts, so /customers is empty by design - not broken.
- The ActionResult envelope and error-code enum are a cross-section contract; the API/backend section must emit this exact shape or the RHF dot-path field-error mapping breaks.
- Storefront product dates are locale strings (createdAt as a date string, order date via toLocaleString('en-IN')). The admin stores ISO-8601 UTC and formats at render with a pinned Asia/Kolkata timezone; the import converts once. Confirm no storefront code depends on the original string formatting.

**Risks**

- The admin can be fully built, deployed and correct and still change nothing a shopper sees. Everything in this section is dark until src/api/*.js is repointed. If that cutover is delayed or abandoned, the admin's product, content and footer screens are a well-built CMS with no reader - this must be said to the stakeholder before build, not after.
- The public serialiser is the single point of failure for the whole plan. If it emits image objects instead of string[], rupees as paise, or a renamed field, every product card in the storefront breaks on cutover day. The serialiser snapshot tests are the only guard; if they are skipped for time, the risk is unbounded.
- The catalogue import from src/data/products.js is one-way and lossy in one direction: after import the admin is the source of truth, but the storefront keeps reading its local file until cutover. Any edit made in the admin during that window is invisible, and any edit made directly in products.js is silently overwritten at cutover. The window needs an owner and an end date.
- Variants have no ids today, so the import must mint them - which means the imported ids are new, not recovered. Any cart or wishlist entry already sitting in a shopper's localStorage (keys niya_cart, niyaWishlist) was keyed without a variant id and will not match post-cutover keys. Expect one-time cart/wishlist weirdness for returning shoppers, and decide whether to accept it or bump the storage key.
- The auth cutover is materially riskier than the content cutover and is easy to conflate with it. authApi.js stores plaintext passwords in localStorage under niyaUsers; those credentials cannot be migrated to a hashed server store without a forced password reset for every existing shopper.
- Order status history is written by the admin, but the orders themselves do not exist yet. If the order cutover ships without backfilling the localStorage niyaOrders records that customers already hold, those orders are permanently invisible to the operator - and the operator will not know they are missing.
- Two orthogonal status axes plus eight fulfilment states is more process than a one-person store runs today. If the operator only ever uses PLACED and DELIVERED, the extra states become stale and untrustworthy. Watch actual usage after the order cutover and delete unused states rather than defending them.
- Dropping TanStack Query is the right call for two dialog-scoped reads, but useAsyncList must get the request-id guard right; a naive debounce plus AbortController still renders out-of-order responses under a slow connection, and that bug looks like a backend fault.
- 13px base type is correct for density but is genuinely small for some operators. If the single operator finds it hard to read, the fix is a root font-size scale token, not ad-hoc per-component overrides - decide that before the first complaint arrives.
- Server Actions are public HTTP endpoints reachable by any authenticated session. requireAdmin() inside the data layer is the only thing standing between a USER-role account and every mutation; a single action that forgets the guard is a full privilege escalation, and nothing in the type system enforces it. Consider a lint rule or a wrapper factory that makes the guard impossible to omit.

---

## Development Phases, Storefront Cutover, Risks and Final Recommendation

### 0. Verified baseline — the numbers everything below keys off

Every count here was read out of the repo, not estimated. Several figures commonly quoted about this store are wrong, and the plan changes when you use the real ones.

| Thing | Actual (verified) | Where |
|---|---|---|
| Products | **39** (36 `gender:"women"`, 3 `"men"`) | `src/data/products.js` |
| Subcategory split | handbags 6 · minibags 14 · sling 9 · tote 7 · wallet 3 | ditto |
| Variants | **78** (every product has exactly 2) | ditto |
| Variants that **already have an `id`** | **14** — the 7 tote products only, format `"tote-001-brown"` | ditto, from line 1157 |
| Variants with no id | **64** — handbags, minibags, sling, wallet | ditto |
| Image references | 234 (78 variants × 3) | ditto |
| **Unique image files referenced** | **39** | ditto |
| Files in `public/products/**` | 50 → **11 orphans**, plus 1 `.mp4` | `public/` |
| `getCategories()` groups | **5** — `women-handbags`, `women-minibags`, `women-sling`, `women-tote`, `men-wallet` | `products.js:1766` |
| Local re-export fns in `productApi.js` | **10** | `src/api/productApi.js` |
| Footer page slugs | **8** — `about`, `our-story`, `contact`, `shipping-returns`, `size-guide`, `faq`, `privacy-policy`, `terms-of-use`. There is **no `legal` slug**; `/care-guide` is a 9th *route* with no record (`SizeCarePage` hardcodes `getFooterPage("size-guide")`) | `src/data/footerData.js` |
| Reels | 4 — **1 local mp4**, **3 hot-linked `pexels.com/download/video/...` URLs** | `homeData.js:86–106` |

Five consequences the rest of this plan depends on:

1. **Every variant's "3 images" are the same file, three times.** 234 references resolve to 39 files. The gallery is decorative. Media work is *sourcing photographs*, not migrating 360 assets.
2. **The variant-id bug is partial, not universal.** `getVariantKey` reads `selectedVariant?.id || selectedVariant?._id || product.variantId || ""`. The 7 tote products already dedupe correctly per colour; the other 32 collapse two colours into one cart line. So the fix must **preserve the 14 existing id strings byte-for-byte** — a random cuid would silently re-key tote lines already sitting in customers' `localStorage`.
3. **`enrichedProducts` / `finalPrice` is dead code.** Nothing imports it; `getAllProducts()` returns raw `products`. `ProductCard` and `ProductDetails` each recompute `finalPrice` locally. It is **not** part of today's API surface and must not be described as parity.
4. **`rating`, `reviewCount` and `orderCount` are unsourced hardcoded integers.** No review entity links to a product (`reviewsData` has `{name, location, text}` only — no rating, no `productId`). `orderCount` drives the best-seller shelf. Neither can be "computed correctly" on day one; both must stay stored, operator-editable fields.
5. **`NotFoundPage.jsx` already makes a live HTTP call** — `getNotFoundBags()` → `contentApi` → `http://localhost:3001/not-found-bags`. In production this fails today and the 404 page renders zero bags, swallowed by a `catch`. It is the one storefront feature already wired to a network, and the cheapest possible win.

---

### The governing constraint

Everything is ordered by one rule: **the storefront's data layer is `src/api/*.js`, and its base URLs are already environment-driven, so the admin's public read API must be shape-compatible with `src/data/products.js` and `src/data/homeData.js` from day one.** Additive fields are free. Renamed or removed fields cost component edits inside a folder the user has forbidden. That decides the phase order — schema, seed and the public read API come before any admin screen beyond the shell, because they are the only work that makes the cutover *possible*.

Second rule: `admin_panel/` never imports from `../e-commerce_frontend-main/`. The seed reads a **vendored snapshot**, so the two projects build and deploy with no knowledge of each other.

```
admin_panel/prisma/seed/source/     # one-time copy, NOT a symlink or relative import
  products.snapshot.js              # copy of src/data/products.js (1797 lines)
  homeData.snapshot.js
  footerData.snapshot.js
  media/                            # the 39 referenced files + 1 mp4, copied from public/
```

**Honesty statement, stated once and repeated in the product itself:** nothing an operator does in this admin reaches a customer until the storefront's two Vite environment variables are repointed and it is redeployed. Until that moment, the CMS is a staging area, not a publisher. Section (b) shows that this cutover costs **zero lines of code** for catalogue and content — but it is still a deliberate act the user must take.

---

### (a) Phases

Renumbered and re-costed against the verified baseline. 39 products is a small catalogue; the cost here is schema breadth and correctness, not volume.

| # | Phase | Goal | Unblocks cutover | Dev-days |
|---|---|---|---|---|
| P0 | Foundation | Next scaffold, TS strict, Tailwind v4, shadcn, app shell, theme, CI | — | 4 |
| P1 | Data layer + seed | Postgres/Prisma schema; 39 products, 78 variants, all static content in the DB | **Yes — prerequisite** | 7 |
| P2 | **Public Storefront API v1** | Frozen, shape-compatible, read-only endpoints + CORS | **Yes — this IS the cutover** | 6 |
| P3 | Auth + RBAC | Auth.js v5, ADMIN/USER only, argon2id, server-side guards | Yes (Wave 2) | 4 |
| P4 | Catalog | Products, variants, media, category entity | Makes content editable | 8 |
| P5 | Orders | `POST /orders` ingestion + admin order management | **Yes — Wave 2** | 8 |
| P6 | Inventory | SKU, stock, append-only ledger, low-stock | Adds `stock` to the DTO | 4 |
| P7 | Customers | Customer records, addresses, order history | — | 3 |
| P8 | CMS | Home content, footer, 8 static pages, 404 bags | **Yes — Wave 1 content** | 7 |
| P9 | Dashboard + reports | Server-truth KPIs only; `POST /events` spec, no fake tiles | — | 4 |
| P10 | Audit + email | Scoped audit log, Resend transactional mail | — | 4 |
| P11 | Hardening | Perf, a11y, backups, smoke E2E, runbook | — | 5 |
| | | | **Total** | **≈64 dev-days (~13 weeks solo)** |

**Cut from the draft plan, with reasons.** *Marketing / discount-rule engine (`Discount` entity, coupon codes, usage caps, nightly reconciliation cron)* → **[LATER]**: the storefront has no coupon input anywhere and `/sale` is a one-line `isOnSale` filter; a rule engine is a feature the shop cannot express. *In-app notification centre* → **[LATER]**: email is sufficient for a one-operator store. *Standalone analytics phase* → folded into P9. *Live-preview iframe with `?preview_token=`* → **[LATER]**: the storefront cannot render admin content until after Wave 1, so a preview pane before then would render the static data and actively mislead. *Typesense/Meilisearch* → not budgeted; Postgres `ILIKE` over 39 rows is correct. *`weightGrams`* → [LATER], no shipping-rate rule exists to consume it.

#### P0 — Foundation (4d)
`create-next-app` (Next.js App Router, TS `strict` + `noUncheckedIndexedAccess`, pnpm), Tailwind v4 CSS-first config, shadcn/ui init with the sidebar block, route groups `(auth)` / `(dashboard)` / `(public-api)`, sidebar + breadcrumb + ⌘K command palette, `next-themes` (the storefront already ships a `ThemeContext`, so parity is consistency not decoration), ESLint 9 flat + Prettier + lint-staged, GitHub Actions running typecheck/lint/build, Vercel preview deploys.
**DoD:** clean build, zero `any`, preview URL live, theme persists. **Demo:** navigate an empty but real admin.

#### P1 — Data layer and seed (7d)
Neon Postgres + Prisma. Entities: `Product`, `ProductVariant`, `ProductImage`, `Category`, `MediaAsset`, `User`, `Customer`, `Address`, `Order`, `OrderItem`, `OrderEvent`, `StockLedger`, `AuditLog`, plus CMS tables `HeroBanner`, `PromoBanner`, `Announcement`, `Reel`, `CampaignBlock`, `CraftsmanshipBlock`, `Testimonial`, `TrustBadge`, `FooterSection`, `FooterLink`, `SocialLink`, `LegalLink`, `Page`, `FaqItem`, `NotFoundBag`.

Five decisions fixed here:

1. **`ProductVariant.publicId` is a deterministic slug, not a cuid** — `{productId}-{colorSlug}`, e.g. `handbag-001-black`. This reproduces the 14 existing tote ids exactly (`tote-001-brown` → `tote-001-brown`), keeps the seed idempotent across re-runs, and keeps cart keys stable for anyone who already has a tote in `localStorage`. A cuid would satisfy the schema and break both. The DB primary key may still be a cuid; **`publicId` is what the DTO emits as `id`**.
2. **`Category` becomes an entity** (`gender`, `slug`, `filter`, `name`, `image`, `description`, `position`) backfilled from the **5** groups `getCategories()` derives. `filter` is the machine key — `CategorySection` puts it straight into `/shop?subcategory=`, so it must stay the exact raw subcategory string (`tote`, not `Tote Bags`). `name` is *rendered as a display label* and `image` as the tile `src`, so both become safely operator-editable. Adding `description`/`position` is additive.
3. **`discountPercentage` is derived on write, never authored.** `price` + `isOnSale` + `salePrice` are canonical; a DB check constraint rejects `salePrice >= price` when `isOnSale` is true, and rejects `isOnSale` with a null `salePrice`.
4. **`rating`, `reviewCount`, `orderCount` are stored, operator-editable, and labelled "manual" in the UI.** There is no product-review entity and no order history to compute them from. Once P5 has real orders, the admin gets an explicit *Recompute order counts from real orders* action rather than silently switching the best-seller shelf's ordering under the operator.
5. **Media is normalised on import.** `WhatsApp Image 2026-08-17 at 5.40.02 PM (1).jpeg` → `nb-handbag-004-black-01.jpeg`, uploaded to Vercel Blob, with `MediaAsset.legacyPath` retained so the pre-cutover storefront keeps serving from its own `/public`. Because 234 references resolve to 39 files, `MediaAsset` is deduplicated by content hash and `ProductImage` is a join row, not a copy. The 11 orphaned files are imported unattached and surfaced in P9 for the operator to attach or delete.

**DoD:** `pnpm db:seed` on an empty database yields 39 products, 78 variants, 234 image links over 39 deduplicated assets, 5 categories, 2 hero banners, 3 promo banners, 3 announcements, 4 reels, 3 testimonials, **8 pages**, 4 trust badges — idempotent and re-runnable. **Demo:** Prisma Studio over the real catalogue.

#### P2 — Public Storefront API v1 (6d) — the cutover enabler
Read-only route handlers under one mount point, response DTOs frozen and snapshot-tested against the vendored `products.snapshot.js`, `Cache-Control: s-maxage` plus tag revalidation on catalog writes, rate limiting.

**CORS precision:** of the four axios instances, only `authApi` and `cartApi` set `withCredentials: true`. The catalogue and content endpoints are anonymous reads and need only `Access-Control-Allow-Origin: <storefront origin>` — no credentialed CORS, no cookie. Credentialed CORS applies to the auth and cart routes only, and only from Wave 2.

| Method | Path (under the v1 mount) | Replaces | Consumer |
|---|---|---|---|
| GET | `/products` (+`featured`, `bestSeller`, `newArrival`, `search`, `subcategory`, `minPrice`, `maxPrice`) | `productApi.js` commented block | Shop, Sale, Search, Cart, Wishlist |
| GET | `/products/:id` | ditto | ProductDetails |
| GET | `/products/:id/suggestions` | ditto | ProductDetails |
| GET | `/categories` | ditto | CategorySection |
| GET | `/hero-banners`, `/promo-banners`, `/announcements`, `/campaign`, `/reels`, `/craftsmanship`, `/reviews` | `contentApi.js` (fully commented) | Home, AnnouncementBar |
| GET | `/not-found-bags` | `notFoundApi.js` — **already real HTTP, currently pointing at `localhost:3001`** | NotFoundPage |
| GET | `/footer`, `/footer-pages/:slug` | **no commented version exists — new** | Footer + 7 page components |
| GET | `/trust-badges` | **none — hardcoded in the component** | TrustBadges (Wave 3 only) |
| POST | `/api/auth/login`, `/api/auth/register`, `/api/auth/logout`; GET/PUT `/api/auth/profile` | `authApi.js` commented block | AuthContext (Wave 2) |
| GET/POST/DELETE | `/cart`, `/cart/add`, `/cart/remove/:productId`, `/cart/clear` | `cartApi.js` (already real HTTP) | CartContext (Wave 3 only) |
| POST | `/orders`; GET | `/orders/mine` | `// await createOrder(orderPayload)` | OrderPage, MyOrders (Wave 2) |

The doubled `/api/auth` segment is deliberate and is explained in (b): `axiosClient.js` hardcodes `${mockoonBaseURL}/api/auth`, and matching it is what buys a zero-line diff. **It does not collide with Auth.js**, which owns `/api/auth/*` at the *app root* for the admin's own session; the storefront alias sits under the v1 mount.

Product DTO — parity fields, then additive:

```
{ id, slug, title, gender, category, subcategory, price, description,
  isOnSale, salePrice, discountPercentage, orderCount, rating, reviewCount,
  createdAt,                      // keep the "YYYY-MM-DD" date-only string
  isFeatured,
  variants: [ { name, images: [url, url, url],   // parity
                id,                              // additive for 64 of 78; identical for the 14 totes
                sku, stock, colorHex } ] }       // additive
```

`finalPrice` is **not** included: `enrichedProducts` has no importer, and both consumers derive it locally. Adding it would be harmless but would misrepresent parity.

**DoD:** a contract test asserts that for all 39 snapshot products, every key present in the static object is present in the API response with the same type, and that `createdAt` still parses under `getNewArrivalProducts`'s `new Date()` sort. **Demo:** curl each endpoint, diff against the static file.

#### P3 — Auth and RBAC (4d)
Auth.js v5, Credentials provider, `argon2id`, `Role` enum `{ ADMIN, USER }` and nothing else, database session strategy, `middleware.ts` protecting the dashboard group, and a server-side `requireAdmin()` invoked in **every** server action and route handler — middleware is routing, not authorization. Login and password-reset screens; the first ADMIN is seeded by CLI, never by a public signup route.
Storefront customers authenticate against the same `User` table with role `USER`; they have no dashboard access and no admin session.
**DoD:** a `USER` session hitting a catalog mutation gets a 403 from the action itself, not merely a redirect. **Demo:** two accounts, two outcomes.

#### P4 — Catalog (8d)
Product list with server-side pagination and URL-driven filters (`nuqs`) over subcategory, gender, status and stock; bulk publish/archive. Product editor with tabs — Details / Variants / Media / Pricing / SEO. Variant repeater with drag ordering; a `publicId` shown read-only with a warning that changing it breaks existing cart lines. Uploader to Blob with per-variant image ordering. Category manager for the 5 groups.
Adds the fields the static shape lacks: `sku`, `status: DRAFT|PUBLISHED|ARCHIVED`, `tags[]`, `metaTitle`, `metaDescription`, `position`, `updatedAt`, `materials`, `costPrice`.
**shadcn:** `form` + react-hook-form + zod, `sheet`, `dialog`, `command`, `badge`, `tabs`, `alert-dialog`, `sonner`. Tables are server-rendered with URL state; **TanStack Table is [LATER]** — 39 rows do not need a virtualised client grid.
**DoD:** create a 40th product with 2 variants and real images, publish it, see it in `GET /products` with a stable variant id. **Demo:** exactly that, end to end.

#### P5 — Orders (8d) — highest standalone value
`POST /orders` accepts the exact object `OrderPage.jsx` builds today: `{ shippingDetails{fullName,email,phone,address,city,state,pinCode}, items[{productId,variantId,title,price,quantity,selectedVariant}], subtotal, shippingFee, totalAmount, paymentMethod }`.

**Correction to a widely repeated error: that payload contains no `orderId`, `date` or `status`.** Those three are generated *client-side after* the commented API call and written straight into `localStorage`. The actual trust surface is per-line `price` and the client-computed `subtotal` / `shippingFee` / `totalAmount`. The server therefore **re-prices every line from the database and recomputes all three totals**, rejecting the request on mismatch beyond a rounding tolerance, and stamps `orderNumber` (`NIYA-2026-000123`, sequential), `placedAt timestamptz`, and an initial status. The response echoes `orderId`, `date` (pre-formatted `en-IN` string) and `status` so `OrderReceipt.jsx` renders unchanged.

Two-axis state, replacing the storefront's single `"ORDER PLACED"` string:
- **Fulfilment:** `PENDING → CONFIRMED → PACKED → SHIPPED → DELIVERED`, `CANCELLED` from any pre-shipped state, `RETURN_REQUESTED → RETURNED`.
- **Payment:** `COD_PENDING | COD_COLLECTED | ONLINE_UNVERIFIED | PAID | REFUNDED`. Because "ONLINE" is a radio button with no gateway behind it, an online order enters `ONLINE_UNVERIFIED` and stays there until a human marks it paid. `ONLINE_UNVERIFIED` revenue is excluded from every report total and shown as a separate line.

Screens: order list with status tabs, order detail (timeline from `OrderEvent`, editable shipping address, courier/AWB fields, printable invoice), cancel and refund-record dialogs.
**DoD:** curl an order in, see it in the admin, move it to `SHIPPED`, see the confirmation email fire. **Demo:** the full lifecycle.

#### P6 — Inventory (4d)
`StockLedger`, append-only (`RECEIVE | SALE | RETURN | ADJUST | RESERVE`), with `ProductVariant.stock` as a projection rebuildable from the ledger; per-variant low-stock threshold; CSV import/export for a stock take. The storefront's `availabilityFilter` currently has no stock field in the product shape to filter on; the additive `variants[].stock` gives it a real meaning from Wave 1 onward. **DoD:** a P5 order writes a `SALE` row and decrements. **Demo:** adjust stock, watch `GET /products` reflect it.

#### P7 — Customers (3d)
Customer list assembled from real orders plus registered `USER` accounts, detail page with lifetime value, order history, addresses, operator notes. **Explicitly out of scope, and said so in the UI:** server-side cart and wishlist views. Both live in `localStorage` (`niya_cart`, `niyaWishlist`) and are invisible to any server; no abandoned-cart feature is possible or promised.

#### P8 — CMS (7d)
Editors for every static block, modelled on what the data actually is:
- **Hero banners** — drag order, `isActive`, optional schedule window.
- **Promo banners** — keep the existing `page` × `position` targeting (`home|shop|wishlist` × `after-hero|after-products`); it is already the right model.
- **Announcements** — ordered list, `isActive`.
- **Reels** — upload to Blob or external URL, `isActive`. **The three Pexels `download/video/...` URLs are re-hosted to Blob during P1**; they are unversioned third-party download links with no licence record.
- **Campaign** and **Craftsmanship** — typed forms; craftsmanship keeps its 2-paragraph body and exactly 3 stats, and its title's embedded newline escape is preserved as a real newline field so the operator does not have to type `\n`.
- **Testimonials** — the 3 existing entries have only `{name, location, text}`. Additive `rating`, `productId`, `date`, `isVerified`, `isPublished` are optional so the DTO stays parity-compatible; the storefront ignores them until someone chooses to render them.
- **Footer** — sections, links, socials, legal links, brand blurb, customer-service block.
- **Pages** — **8 records**, one per real slug. Each of the 8 has a different ad-hoc shape today, so each gets a typed form (FAQ gets a Q/A repeater), not a generic block builder. `/care-guide` is documented as an alias route that renders the `size-guide` record; if the operator wants distinct copy there, that is a storefront route change, not a CMS field.
- **404 bags** and **trust badges** (`{iconKey, title, text, position}`, `iconKey` an enum matching the four react-icons already used).

**No preview pane in this phase.** Until Wave 1, the storefront renders static files and a preview would be a lie. Instead every CMS screen carries a persistent, non-dismissible banner: *"Saved. Not yet live — the storefront still reads its bundled static data. See cutover."* An environment flag removes it after Wave 1.
**DoD:** change a hero headline, refetch `GET /hero-banners`, see it. **Demo:** that round trip, with the not-live banner visible.

#### P9 — Dashboard, reports, and the event contract (4d)
Only metrics the database can prove. **Catalogue health:** published/draft/archived, out-of-stock and low-stock, inventory value at cost and at retail, products missing SKU/meta, **products whose variants all point at a single duplicated image file** (today: nearly all 39 — this tile is the honest picture of catalogue quality), and the 11 orphaned media files. **Commerce (post-P5):** revenue, AOV, units, orders by fulfilment status, COD vs online split with `ONLINE_UNVERIFIED` broken out, top products by real sales, repeat-customer rate, revenue by subcategory. Recharts via the shadcn `chart` primitive, date range via `react-day-picker`, CSV export.
**No conversion rate, no funnel, no cart-abandonment tile** — there is no event stream, and a fabricated denominator is worse than an absent card. A `POST /events` beacon (`page_view`, `product_view`, `add_to_cart`, `checkout_start`, `order_placed`) is **specified and implemented server-side**, but nothing can call it until a storefront edit in Wave 2+; the spec ships, the numbers do not. **Demo:** a dashboard where every number traces to one query.

#### P10 — Audit and email (4d)
Resend + React Email for order confirmed / shipped / delivered, low-stock digest, new admin sign-in. `AuditLog` (`actorId`, `entity`, `entityId`, `action`, `before`, `after`, `ip`, `at`) written via a Prisma extension — but **scoped to a named allowlist**: price and sale fields, stock adjustments, order status and payment transitions, publish/archive, user role changes, and CMS publishes. Logging literally every mutation would bury the signal under seed and view noise. **Demo:** change a price, read the diff.

#### P11 — Hardening (5d)
Route-level `loading.tsx` / `error.tsx`, `next/image` with Blob remote patterns, ISR tags, a11y pass (keyboard-only order flow, focus traps in dialogs, `aria-live` on toasts, contrast in both themes — shadcn supplies structure, not compliance), Sentry for errors (**one** observability tool, not Sentry *and* Pino), Neon PITR plus a nightly logical dump to object storage, Playwright smoke suite covering three paths (admin login → publish a product → it appears in `GET /products`; `POST /orders` → order visible → status advance; CMS edit → API reflects it), and a written runbook.
**DoD:** a restore drill actually performed and timed; axe-clean on the five core screens; `GET /products` p95 under 300 ms warm. Lighthouse scores on an authenticated internal tool are not a target.

---

### (b) The storefront cutover plan

Nothing in `e-commerce_frontend-main/` is touched during P0–P11.

**The central discovery, which shrinks Wave 1 to nothing:** `axiosClient.js` derives *both* of its base URLs from environment variables —

```
backendBaseURL = import.meta.env.VITE_API_BASE_URL         || "https://shieldnest.theglamstreet.in/api"
mockoonBaseURL = import.meta.env.VITE_MOCKOON_API_BASE_URL || "http://localhost:3001"
```

All four instances are built from those two values. Setting both in the Vercel dashboard and redeploying repoints `api`, `authApi`, `cartApi` and `contentApi` at the admin **without editing a single file in the forbidden folder.** Vite inlines env vars at build time, so a redeploy is required — but a redeploy of unchanged source is not a change to the source.

The price is one piece of deliberate ugliness: `authApi` hardcodes `${mockoonBaseURL}/api/auth`, and `contentApi` calls `/hero-banners` off the bare mockoon base. So the admin mounts its public API at one path and serves the storefront's *already-written* URL shapes underneath it:

```
VITE_API_BASE_URL         = https://admin.niyabags.com/api/storefront/v1
VITE_MOCKOON_API_BASE_URL = https://admin.niyabags.com/api/storefront/v1
```
```
/api/storefront/v1/products, /products/:id, /categories, ...   <- api instance
/api/storefront/v1/cart, /cart/add, ...                        <- cartApi instance
/api/storefront/v1/hero-banners, /reels, /not-found-bags, ...  <- contentApi instance
/api/storefront/v1/api/auth/login, /register, /profile, ...    <- authApi instance (doubled segment, intentional)
```

**Option A (recommended): zero code changes.** Set the two env vars, redeploy. **Option B (tidy-up, later):** an ~8-line rewrite of `axiosClient.js` collapsing both variables into one and dropping the doubled `/api/auth`. Option B is cosmetic and should wait until the user has already accepted a storefront PR for other reasons.

**Rollback is a config change, not a revert.** Because the switch is an environment variable, backing out is: clear the two vars, redeploy, and the storefront falls back to its bundled static data instantly. No git revert, no data migration, no customer-visible gap. This is the single strongest argument for the env-driven approach and it should be tested before the first real cutover.

#### Wave 1 — catalogue and content (after P2, P4, P8)

| File | Change | Size |
|---|---|---|
| `src/api/axiosClient.js` | **None.** Two Vercel env vars + redeploy. | **0 lines** |
| `src/api/productApi.js` | Delete the **10** local re-export functions; uncomment the axios block verbatim. Endpoint paths and query params already match P2 exactly. | swap top for bottom |
| `src/api/contentApi.js` | Uncomment. Leave the `getNotFoundBags` block commented — `notFoundApi.js` already owns that call and is the module `NotFoundPage.jsx` imports; uncommenting it here creates a redundant second implementation. | uncomment |
| `src/api/notFoundApi.js` | **None.** It is already real HTTP on the `contentApi` instance; the env var alone fixes a 404 page that is broken in production today. | **0 lines** |
| `src/api/homeApi.js` | Thin it to re-export from `contentApi.js`. Seven components import `homeApi` directly (`HeroBanner`, `PromoBanner`, `AnnouncementBar`, `ReelsSection`, `CampaignSpotlight`, `CustomerReviews`, `BrandCraftsmanship`), so keeping the module name means those imports never change. | ~10 lines |
| `src/api/footerApi.js` | Replace both functions with `api.get("/footer")` and `api.get("/footer-pages/:slug")`. **No commented version exists — the one file written from scratch.** | ~12 lines |
| `src/api/api.js` | Add `export * from "./footerApi"`. Fixes a latent bug: `FooterPage.jsx` imports `getFooterPage` from the barrel, which does not export it. That file is dead — it is never imported by `AppRoutes.jsx` — so it throws only if someone routes it. | 1–2 lines |
| **`src/components/home/CustomerReviews.jsx`** | **Required component edit.** Line 5 is `const reviews = getReviews();` — a *synchronous* call at render, no `useEffect`, no state. Once `getReviews` returns a promise this renders a Promise object. Needs `useState` + `useEffect` + an empty-state guard. | ~10 lines |
| **`src/components/home/BrandCraftsmanship.jsx`** | **Required component edit.** Same defect: `const data = getCraftsmanship();`. | ~10 lines |

**Correcting a claim that must not survive into planning:** it is *not* true that all seven `homeApi` consumers already `await`. `getPromoBanners`, `getCampaign`, `getReviews` and `getCraftsmanship` are declared synchronous in `homeApi.js`. `PromoBanner` and `CampaignSpotlight` happen to `await` them anyway inside a `useEffect`, so those two are safe. `CustomerReviews` and `BrandCraftsmanship` do not — they call at render and use the result immediately. **Wave 1 is therefore 4 API files plus 2 component files, not "five files and no components."** The alternative, if the user truly will not accept a component edit, is to leave `getReviews` and `getCraftsmanship` reading the static import — meaning the testimonials strip and the craftsmanship block stay uneditable until they relent. State that choice to the user explicitly; do not quietly pick one.

**Components requiring genuinely zero changes in Wave 1:** `CategorySection.jsx` (P2 returns the same five fields with `filter` byte-identical), every product card, `ShopPage.jsx`'s 836 lines of filtering (DTO parity), all seven footer page components (`footerApi` keeps its two function names and both are already `async`), and every `<img src={...}>` — product images are root-relative strings today and absolute Blob URLs are equally valid `src` values.

#### Wave 2 — accounts and orders (after P3, P5)

| File | Change |
|---|---|
| `src/api/authApi.js` | Delete the localStorage implementation; uncomment the axios block. Ends plaintext-password storage in `niyaUsers`. **One-way door:** existing local accounts are stranded. Recommendation: accept re-registration — the accounts are browser-local, unverifiable, and near-zero in number. Never write a "migrate my password" path. |
| `src/api/orderApi.js` | **New file.** `createOrder(payload)`, `getMyOrders()` on the `api` instance. |
| `src/pages/OrderPage.jsx` | Uncomment the import (line 20) and the call (line 144), then replace the client-generated `newOrderId = \`NIYA-${Date.now()}\`` and `toLocaleString("en-IN")` with the values the server returns. Keep the `niyaOrders` localStorage write as an offline mirror for one release, then delete. |
| `src/pages/MyOrders.jsx` | **Written from scratch** — this page has no API import at all today; it reads `localStorage` directly. Read `getMyOrders()` when authenticated, fall back to `niyaOrders` otherwise. |
| Analytics beacon | Optional `POST /events` calls in `ProductDetails`, `CartContext`, `OrderPage`. Until this lands, P9's behavioural tiles stay absent. |

#### Wave 3 — the awkward remainder (optional, and honest about cost)

- **`TrustBadges.jsx` cannot be CMS-driven by an `src/api/` change alone.** Its `benefits` array holds react-icons *component references* (`FiBox`, `FiShield`, `FiRefreshCw`, `FiHelpCircle`) which cannot cross a JSON boundary. It needs a `const ICONS = { box: FiBox, ... }` map plus a fetch — a real component edit. `GET /trust-badges` and the admin editor exist from P8; tell the user plainly that this one homepage strip stays hardcoded until they accept the edit.
- **`CartContext.jsx` / `WishlistContext.jsx`** moving from `localStorage` to server endpoints are substantial context rewrites, not API swaps. `cartApi.js` is already real HTTP that `CartContext` simply ignores. Worth doing only when cross-device carts are actually wanted; there is no wishlist endpoint at all and one would have to be designed.
- **`ShopPage` ignores `?gender=`** although `CategorySection` links with it. A pre-existing storefront inconsistency, unrelated to the admin — logged so it is not mistaken for a cutover regression.
- **Deleting `src/data/*.js`** — last, after a release proves the API path.

#### What is useful before cutover vs. inert

| Useful immediately (admin-only value) | Inert until Wave 1 / 2 |
|---|---|
| Orders, inventory, customers, audit, transactional email — the operator's daily job, done today by reading `localStorage` in DevTools | Every CMS edit: hero banners, announcements, reels, campaign, testimonials, footer, the 8 pages |
| Server-truth revenue/AOV/units reports | Product create/edit/publish, pricing, sale flags, category copy |
| The catalogue as a system of record: SKUs, cost, stock, real photography, the 11 orphan files resolved | The variant-id fix (data is ready; nothing consumes it until the storefront reads the API) |

**Sequencing that minimises the eventual diff:** freeze the P2 DTOs *before* building any admin screen and snapshot-test them against the vendored data. If P4 or P8 ever wants a field renamed, rename it in the internal model and map it in the DTO — never in the wire shape.

---

### (c) Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **No backend exists.** `shieldnest.theglamstreet.in` is an unverified default; the mockoon base is `localhost:3001`. The admin must *become* the backend. | Certain | Critical | Scope the admin as system of record from P1. Budget P1+P2 (13d) as backend work, not admin work. Confirm before P1 — if a real API exists, P2 becomes an adapter and the plan shortens by ~2 weeks. |
| **Plaintext passwords** in `niyaUsers` localStorage; signup stores `...userData` verbatim. | Certain today | High | argon2id from P3. Never import `niyaUsers` records under any circumstances. Force re-registration at Wave 2. |
| **Wave 1 needs two component edits** (`CustomerReviews`, `BrandCraftsmanship` call sync `getReviews`/`getCraftsmanship` at render). Discovering this mid-cutover turns a config change into an emergency PR. | Certain | High | Surface it in the very first conversation with the user, not at cutover. Either budget the 2 files or accept those two blocks staying static. Decide before P8 builds their editors. |
| **Variant-id rekeying.** 14 tote variants already carry ids like `tote-001-brown` that are persisted in live `localStorage` carts. Issuing cuids silently orphans them. | High if unguarded | High | `publicId` is the deterministic `{productId}-{colorSlug}` slug, reproducing all 14 exactly. `publicId` is immutable in the admin UI, behind a confirm dialog with an explicit warning. Verify at Wave 1 with a two-colour add-to-cart test on both a tote and a minibag. |
| **No payment gateway.** "ONLINE" is a radio button with nothing behind it. | Certain | High | COD-first admin. `ONLINE_UNVERIFIED` never counts as revenue and is reported on its own line. A gateway is a post-P11 project, not a phase. |
| **Client-priced orders.** The payload carries per-line `price` plus client-computed `subtotal`, `shippingFee`, `totalAmount`. Trusting them is a discount-injection hole the day it goes live. | Certain at Wave 2 | High | Server re-prices from the DB and recomputes all three totals; mismatch beyond rounding is a 4xx with the server's figures in the body. |
| **The catalogue's photography is fake.** 234 image references resolve to 39 files; effectively every variant repeats one image three times, and 11 files on disk are unreferenced. Any "3-image gallery" promise is currently untrue. | Certain | Medium | Import deduplicates by hash; the P9 completeness tile ranks products by duplicate-image count so the operator has a work queue. Do not build a gallery-reordering UX that implies richness that does not exist. |
| **Hot-linked Pexels reel videos.** 3 of 4 reels point at `pexels.com/download/video/<id>` — unversioned, unlicensed-on-record, and outside your control. | High | Medium | Re-host to Blob during P1 and record a `licence`/`source` field on `Reel`. |
| **No event tracking** → conversion, funnel and abandonment are not computable. | Certain | Medium | Server-truth metrics only in P9. `POST /events` is specified; the tiles stay absent until Wave 2 wires callers. Never render a metric with an invented denominator. |
| **Cart and wishlist are device-local** and invisible to any server. | Certain | Medium | Abandoned-cart and cross-device features are out of scope and stated as such in the customer screens. |
| **Order date is a locale string** (`toLocaleString("en-IN")`), unsortable and unparseable. | Certain | Medium | `POST /orders` ignores anything the client sends and stamps `placedAt timestamptz`, echoing a formatted string so `OrderReceipt.jsx` renders unchanged. Pre-cutover `niyaOrders` history is unrecoverable and will not be imported. |
| **Unsourced `rating` / `reviewCount` / `orderCount`.** No review entity exists, and `orderCount` drives the best-seller shelf. | Certain | Medium | Stored, operator-editable, labelled "manual" in the UI. Switching `orderCount` to real sales is an explicit operator action, never an automatic drift that silently reorders the homepage. |
| **`discountPercentage` drift** across `price`/`salePrice`/`isOnSale`. | High | Medium | Derived on write; read-only in the UI; DB check constraints reject `salePrice >= price` and `isOnSale` without a `salePrice`. |
| **CMS vs. "never touch the frontend."** The admin can edit a hero banner from P8, but nothing reaches customers until the env vars flip. | Certain | High | Say it in the product, not just the docs: a persistent "Not yet live — pending storefront cutover" banner on every CMS screen, removed by an env flag. Never let the operator believe an edit published. |
| **Cross-origin cookies.** `authApi` and `cartApi` use `withCredentials: true`; two unrelated domains means `SameSite=None; Secure` and third-party-cookie blocking in Safari and Firefox. | High if unplanned | Medium | Deploy as `niyabags.com` + `admin.niyabags.com` — one registrable domain, so `SameSite=Lax` suffices. Decide before DNS is pointed; expensive to change later. |
| **Vite env vars are build-time.** A cutover requires a storefront *redeploy*, and anyone assuming a runtime toggle will be surprised. | Certain | Low | Documented in the runbook; rollback is the same two-var change plus redeploy, and is rehearsed once in P11. |
| **Single developer, ~64 dev-days.** Phase drift leaves the storefront on static files for months. | High | High | P0→P1→P2 first (17d) makes cutover *possible*; then P3+P5 (12d) delivers the operator's daily job. Every phase ends demonstrable, so partial delivery is still delivery. |
| **Barrel omission.** `footerApi.js` and `homeApi.js` are absent from `src/api/api.js`; the dead `FooterPage.jsx` imports a symbol the barrel does not export. | Certain | Low | Two lines in Wave 1. Noted so it is not discovered mid-cutover. |

---

### (d) Open questions for the user

1. **Does a real backend exist, or does the admin own the data?** Is `https://shieldnest.theglamstreet.in/api` live, yours, and documented — or a placeholder someone typed once? This one answer moves ~13 dev-days. *Default if unanswered: the admin owns everything.*
2. **Is there a Mockoon collection** behind `localhost:3001` whose response shapes I should match for `/hero-banners`, `/reviews`, `/not-found-bags`? If yes, export it — it becomes the P2 contract for free, and it may already define `not-found-bags`, which the 404 page calls today.
3. **Will you accept two small component edits at cutover** (`CustomerReviews.jsx`, `BrandCraftsmanship.jsx`, ~10 lines each) so testimonials and the craftsmanship block become CMS-editable? If not, those two blocks stay hardcoded and their P8 editors are pointless — I would drop them from scope rather than build a dead screen.
4. **Payment plan?** Razorpay / PhonePe / Cashfree, or COD for the foreseeable future? Drives the order state machine, refunds, and reconciliation. *Default: COD-only, online orders manually confirmed.*
5. **Domain shape.** Can the admin live at `admin.niyabags.com` under the same registrable domain as the storefront? If not, `withCredentials` auth and cart move to `SameSite=None` and add work to P3 and Wave 2.
6. **Who operates the store daily** — you alone, or a non-technical person? With exactly two roles, a warehouse packer who needs to mark orders shipped holds full ADMIN, including pricing and deletion. That is a real consequence of the two-role constraint; the mitigation is guardrails (confirm dialogs, soft delete, audit log), not a third role.
7. **Catalogue ceiling — 39, 400, or 4,000 products?** Under ~500, Postgres `ILIKE` search and simple pagination are correct. Past that, search moves to Postgres full-text and `SearchOverlay.jsx`'s client-side substring scan over the whole array stops being viable — which would be a storefront change.
8. **Do you have real product photography?** 234 image slots are filled by 39 files, most repeated three times. If real shots are coming, P1's media import should wait for them; if not, the admin should stop presenting a three-image gallery as a filled field.
9. **When can the storefront be touched at all?** "Never" and "after the admin is proven" are different plans. Note that Wave 1 for catalogue and content now costs **zero lines** — only two environment variables and a redeploy.
10. **Do you want server-side customer accounts?** The fake auth means there is effectively no user base to migrate; confirming that makes Wave 2 painless and lets me delete the migration question entirely.

---

### (e) Final recommended architecture

**Stack** (pin exact versions at scaffold): Next.js App Router · React 19 · TypeScript strict + `noUncheckedIndexedAccess` · Tailwind CSS v4 · shadcn/ui on Radix · Auth.js v5 · Prisma + PostgreSQL (Neon) · Zod · react-hook-form · `nuqs` for URL filter state · Vercel Blob · Resend + React Email · Recharts via shadcn `chart` · Sentry · Vitest + Playwright · ESLint 9 flat + Prettier · pnpm.
**Deliberately not included:** TanStack Query (server components and server actions cover a 39-product admin; adding a second cache layer is complexity without a consumer), TanStack Table ([LATER], when order volume justifies it), Pino (Sentry alone), Typesense, Redux (the storefront's own installed-but-unused Redux is a warning, not a precedent).

**Deployment topology:** two independent Vercel projects. `niyabags.com` → the untouched Vite storefront with its unchanged `vercel.json` SPA rewrite. `admin.niyabags.com` → `admin_panel/`, serving both the admin UI and `/api/storefront/v1/**`. One Neon Postgres (production plus a branch per preview), one Blob store, Vercel Cron only for the nightly low-stock digest and backup dump. Same registrable domain deliberately, so the existing `withCredentials` instances work under `SameSite=Lax`.

| # | Decision | Why, for this store |
|---|---|---|
| 1 | The admin panel **is** the backend; no separate API service. | No backend exists, and one Next app serving both is one deploy, one auth, one schema for a 39-product catalogue run by one person. |
| 2 | Public API frozen at `/api/storefront/v1` with **DTO parity** to `src/data/products.js`. | Confines the eventual storefront diff to a handful of adapter files instead of a refactor of 836-line `ShopPage.jsx`. |
| 3 | **Cutover is an environment-variable change, not a code change.** Both storefront base URLs are already `import.meta.env`-driven; the API mounts to match the paths the committed axios code already builds — including the doubled `/api/auth` segment. | Honours "zero changes" literally for the catalogue and content wave, and makes rollback a config flip plus redeploy rather than a git revert. |
| 4 | PostgreSQL + Prisma, not MongoDB. | Orders, stock ledgers and money need transactions and constraints, and the product shape is already rigid and relational. (`getVariantKey`'s `_id` fallback hints the original backend was Mongo; that is not a reason to inherit it.) |
| 5 | Variant public id is a **deterministic slug**, not a cuid. | Reproduces the 14 tote ids that already exist and are already persisted in customers' carts, keeps the seed idempotent, and fixes the dedupe bug for the other 64 with zero storefront code changed. |
| 6 | `Category` promoted to an entity; `filter` stays the exact raw subcategory string. | 5 derived groups have no description, banner or ordering today. `filter` is a machine key `CategorySection` puts into a URL; `name` and `image` are rendered and become safely editable. |
| 7 | Server-authoritative orders: re-price every line, recompute `subtotal`/`shippingFee`/`totalAmount`, stamp `orderNumber` and `placedAt`. | The payload is entirely client-built. It carries no `orderId`/`date`/`status` to ignore — the exposure is prices and totals, and that is what must be recomputed. |
| 8 | Two-axis order state (fulfilment × payment), replacing the single `"ORDER PLACED"` string. | COD needs "delivered but not yet collected"; "ONLINE" needs "claimed but unverified" while no gateway exists. |
| 9 | Vendored seed snapshot; no cross-repo import. | Keeps both projects independently buildable and honours "zero changes" so literally that the admin cannot read the storefront even at build time. |
| 10 | Media re-hosted on Blob, hash-deduplicated, slugified, `legacyPath` retained. | Filenames with spaces and parentheses break caching and tooling; deduplication tells the truth about 39 files behind 234 slots; `legacyPath` keeps the pre-cutover site serving from its own `/public`. |
| 11 | Scoped audit log from P10; no fabricated analytics, ever. | Two roles means any operator holds full power over prices and order status, so mutations need attribution — but logging *every* write buries the signal. And with no event stream, a conversion tile would be a lie. |
| 12 | The not-live banner is a product feature, not a doc footnote. | The single largest way this project can fail is an operator believing a CMS edit reached a customer. |

**What to build first.** Spend the first three and a half weeks on **P0 → P1 → P2**, in that order, and treat nothing else as urgent. Scaffold the Next app with the shadcn sidebar shell (4 days); get all 39 products, 78 variants, 39 deduplicated media assets and every static home and footer block into Postgres via an idempotent seed reading a vendored snapshot (7 days); then ship the frozen read-only `/api/storefront/v1` with DTOs snapshot-tested against that same static data (6 days). At the end of those 17 days you can `curl https://admin.niyabags.com/api/storefront/v1/products` and get back something shape-compatible with what `src/data/products.js` returns today — at which point the cutover stops being a research problem and becomes **two environment variables the user can set whenever they are ready**, with two small component edits queued behind them.

Then build **Auth (P3) and Orders (P5) before CMS (P8)**. Order management is the one thing that helps the operator on day one whether or not the storefront is ever repointed — today that job is done by reading `localStorage` in DevTools. Every CMS edit, by contrast, sits inert until the env vars flip. Resist starting with the dashboard: a KPI grid with no orders table behind it is exactly the toy this is not supposed to be.

**Decisions**

- FIX: Corrected the catalogue counts everything downstream depends on — 39 products (not 40), 78 variants (not ~120), 39 unique image files behind 234 references (not ~360 image rows), 50 files on disk with 11 orphans, 5 getCategories() groups (not 10), 10 productApi re-export functions (not 11), 8 footer page slugs (not 7) with no 'legal' slug and /care-guide an alias route with no record.
- FIX: The variant-id claim was wrong. 14 of 78 variants ALREADY have ids (all 7 tote products, format 'tote-001-brown'); only 64 lack them, so the cart bug is partial. Replaced 'ProductVariant.id is a real cuid' with a deterministic publicId of {productId}-{colorSlug}, which reproduces the 14 existing ids byte-for-byte, keeps the seed idempotent, and avoids silently re-keying tote lines already sitting in customers' localStorage carts.
- FIX: The draft's biggest factual error — 'all seven homeApi call sites already await' is false. CustomerReviews.jsx (line 5, `const reviews = getReviews()`) and BrandCraftsmanship.jsx (line 5, `const data = getCraftsmanship()`) call synchronously at render with no useEffect/useState. Wave 1 therefore requires 2 component edits, not zero. Made this a Wave 1 table row, a High-impact risk, and an open question, and offered the alternative (those two blocks stay static).
- FIX: Discovered and used the fact that axiosClient.js derives BOTH base URLs from env vars (VITE_API_BASE_URL and VITE_MOCKOON_API_BASE_URL). Wave 1's axiosClient change drops from '~8 lines rewritten' to ZERO lines — two Vercel env vars plus a redeploy. Documented the price (the admin must serve the doubled /api/auth segment authApi hardcodes) and confirmed it does not collide with Auth.js at the app root.
- FIX: Added the rollback story the draft entirely lacked — because cutover is an env-var change, backing out is clearing two vars and redeploying, with no git revert or data migration. Also noted Vite env vars are build-time so a redeploy is mandatory.
- FIX: Corrected the orders decision. orderPayload contains NO orderId, date or status — those are generated client-side after the commented call and written straight to localStorage. The real trust surface is per-line price plus client-computed subtotal/shippingFee/totalAmount, so the server must re-price and recompute those three, not 'ignore orderId/date/status'.
- FIX: Removed finalPrice from the DTO parity sketch. enrichedProducts is dead code with no importer; getAllProducts() returns raw products, and ProductCard/ProductDetails each recompute finalPrice locally. Listing it as parity misrepresented today's surface.
- FIX: Flagged that NotFoundPage.jsx already makes a live HTTP call to localhost:3001/not-found-bags and is silently broken in production right now — the cheapest visible win, fixed by the env var with zero code change. Also corrected the plan to leave contentApi.js's getNotFoundBags block commented so notFoundApi.js stays the single owner.
- FIX: MyOrders.jsx has no API import at all — it reads localStorage directly — so Wave 2 writes it from scratch rather than 'swapping' a call. Corrected the Wave 2 table.
- FIX: Added the catalogue-quality truth the draft missed: every variant's three images are the same file repeated, so MediaAsset is hash-deduplicated (39 assets, 234 join rows) and the P9 completeness tile ranks products by duplicate-image count. Also surfaced the 11 orphaned files on disk.
- FIX: Added the hot-linked Pexels reel videos (3 of 4 point at pexels.com/download/video/<id>) as a real availability and licensing risk, re-hosted to Blob in P1 with a source/licence field.
- FIX: Added that rating, reviewCount and orderCount are unsourced hardcoded integers with no review entity behind them, and that orderCount drives the best-seller shelf — so they stay stored, operator-editable and labelled 'manual', with recomputation from real orders an explicit operator action rather than silent drift.
- FIX: Corrected the CORS claim. Only authApi and cartApi set withCredentials; catalogue and content endpoints are anonymous reads needing plain origin CORS, and credentialed CORS applies only from Wave 2.
- FIX: Corrected the Category decision — filter is the machine key CategorySection puts into /shop?subcategory= and must stay the exact raw subcategory string, while name and image are rendered and can safely become editable. The draft's blanket 'keeps emitting the same five fields' hid that asymmetry.
- FIX: Cut the over-engineering. Discount/coupon engine with usage caps and a nightly cron demoted to [LATER] (the storefront has no coupon input, and a cron reconciling isOnSale does literally nothing pre-cutover — the draft's justification was self-contradictory); in-app notification centre cut; TanStack Table and TanStack Query cut for a 39-row admin; Pino dropped in favour of Sentry alone; full E2E suite reduced to three smoke paths; weightGrams deferred.
- FIX: Cut the P9 live-preview iframe with ?preview_token= as dishonest — the storefront renders static data until Wave 1, so a preview pane would show the operator the wrong thing. Replaced with a persistent non-dismissible 'not yet live' banner elevated to a numbered architecture decision.
- FIX: Replaced 'Lighthouse >=90' on an authenticated internal tool with real budgets: axe-clean on five core screens, GET /products p95 under 300ms warm, and a timed restore drill.
- FIX: Scoped the audit log to a named allowlist (prices, stock, order/payment transitions, publish, role changes) instead of 'every mutation', which would bury the signal under seed and view noise. Also corrected 'two ADMINs' — the constraint is two roles, and the real consequence is that a warehouse packer holds full ADMIN, mitigated by guardrails not a third role.
- FIX: Recosted the plan honestly after the cuts: 64 dev-days (~13 weeks solo) across P0-P11, versus the draft's 84/17 weeks, and renumbered so the read-only public API (needing no auth) precedes the auth phase.
- FIX: Added a verified-baseline table at the top so no downstream number is taken on trust, and added the pre-existing ShopPage-ignores-?gender inconsistency to Wave 3 so it is not later mistaken for a cutover regression.

**Open assumptions**

- shieldnest.theglamstreet.in/api is a placeholder, not a live documented backend — the admin is assumed to own all data. If it is real, P1+P2 (13d) collapses into an adapter.
- No Mockoon collection export exists, so P2 response shapes derive from the commented-out axios calls plus the static data files rather than an agreed contract. A /not-found-bags shape may already exist there, since NotFoundPage calls it today.
- 'Never touch the storefront' is read as 'not now'. Wave 1 for catalogue and content now costs zero lines of code (two env vars plus a redeploy), but the two sync render-time call sites in CustomerReviews.jsx and BrandCraftsmanship.jsx still need ~10 lines each — the user must choose between editing them and leaving those two homepage blocks uneditable forever.
- The 14 existing tote variant ids are treated as load-bearing and must be reproduced exactly, on the assumption that live customer carts in localStorage may reference them.
- The niyaUsers localStorage accounts have no real customer value and are abandoned at auth cutover rather than migrated; plaintext passwords are never imported.
- No niyaOrders history needs importing; its toLocaleString('en-IN') dates are unparseable and pre-cutover orders are unrecoverable.
- Payment stays COD-only for the planning horizon; ONLINE orders are manually confirmed and never counted as revenue until then.
- Catalogue stays under ~500 products, so Postgres ILIKE search suffices and no dedicated search engine is budgeted.
- Real product photography is assumed to be coming; the current 39 files behind 234 slots are treated as placeholders, not a data model to preserve.
- Single full-time developer, ~64 dev-days serial, ~13 weeks.
- Vercel plus Neon, starting on free tiers and moving to Pro before real traffic. Blob for ~40 assets is negligible.
- Storefront and admin share one registrable domain (niyabags.com / admin.niyabags.com). If they cannot, SameSite=None handling adds work to P3 and Wave 2.

**Risks**

- Wave 1 is not a pure src/api swap: CustomerReviews.jsx and BrandCraftsmanship.jsx call getReviews()/getCraftsmanship() synchronously at render with no state, so making them async renders a Promise. Discovering this at cutover turns a config change into an emergency PR against a folder the user forbade.
- Variant-id rekeying: 14 tote variants already carry ids persisted in live localStorage carts. Any scheme that does not reproduce them exactly silently orphans existing cart lines, and the failure is invisible until a customer complains.
- The admin must BE the backend. P1+P2 is 13 dev-days of backend work misfiled as 'admin panel', and if the user expected a UI over an existing API the schedule expectation is wrong by weeks.
- Client-priced orders: the payload carries per-line price and client-computed subtotal/shippingFee/totalAmount. Accepting them at Wave 2 is a discount-injection vulnerability from the first live order.
- Catalogue photography is effectively absent — 234 image slots resolve to 39 files, most repeated three times, plus 11 orphaned files. Any UI implying a three-image gallery overstates the data, and no amount of admin tooling substitutes for a photo shoot.
- Three of four reels hot-link pexels.com/download/video/<id> — unversioned, outside your control, with no licence record. They can vanish or change without warning.
- Cross-origin credentialed cookies: authApi and cartApi use withCredentials. If the admin cannot live under the same registrable domain, SameSite=None plus third-party-cookie blocking in Safari and Firefox breaks customer auth and cart at Wave 2.
- Vite env vars are build-time, so cutover and rollback both require a storefront redeploy. Anyone expecting a runtime toggle will mis-plan the change window.
- The operator-believes-it-published failure: with the CMS shipping in P8 and the storefront still on static files, an unmarked admin is actively misleading. The not-live banner is a correctness feature, not decoration.
- Two roles means a warehouse packer marking orders shipped holds full ADMIN over pricing and deletion. The constraint is fixed, so the exposure is real and only partly mitigable by confirm dialogs, soft delete and audit logging.
- No event stream exists, so conversion, funnel and cart abandonment are permanently uncomputable until a storefront edit lands. Any stakeholder expecting them from a 'dashboard' will be disappointed.
- Single-developer serial execution over ~13 weeks: any drift leaves the storefront on static files for months while the admin accumulates inert CMS content.