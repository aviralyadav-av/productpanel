# DIY Baazar Admin — Product, UX and Technical Audit

**Date:** 10 September 2026
**Scope:** the whole product — information architecture, workflows, feature completeness, backend, database, API, frontend performance, security, scalability, tech stack.
**Method:** every claim below is either a **[FACT]** measured against the running system (production build, live Postgres, EXPLAIN plans, authenticated crawl, bundle analysis) or a **[REC]** — my recommendation. Research findings from other products are cited.
**Status:** analysis only. **No application code was changed while producing this report.**

---

# A. Executive Summary

The product is **functionally complete and technically sound** — this is not a UI shell. 255 server actions, 773 database calls, 233 transactions and 329 audit writes are wired end to end; 222 of 222 admin API routes enforce permission + CSRF; 410 unit tests and 29 database-backed integration checks pass; the production build is clean and an authenticated crawl of 80 pages and 253 API routes returns zero server errors. Median admin API latency is 12–44 ms, public API 4–9 ms.

The real problems are not "is it built" but **four specific things**:

1. **One query cannot scale, and it is the most-used query in the product.** Filtering products by category uses `categoryPath LIKE '/x%'`. The database collation is `English_United States.1252`, so the existing btree index **cannot** serve it — proven by forcing `enable_seqscan = off` and watching Postgres still choose a sequential scan. Every category-filtered listing, on the storefront and in the admin, is a full table scan on `Product`. Invisible at 74 products; fatal at 100k.

2. **Every page ships a validation library to the browser it does not need.** Zod is 366 KB raw / **84 KB gzip in the shared baseline of every single page** — 23% of the 360 KB gzip baseline — because 88 client components import their module's `schemas.ts`. No file imports zod directly; it arrives transitively.

3. **The navigation has outgrown its structure.** 40 items in 12 groups, of which **5 groups contain exactly one item** and **3 destinations are reachable from multiple entries** — `/admin/orders` appears **five times** (All / Pending / Processing / Shipped / Delivered). Those five entries are hardcoded status filters, which is precisely the problem Shopify solved with user-created **saved views**.

4. **The dashboard measures a shop, not a marketplace.** It reports revenue, orders, customers and product counts, but not the operator's actual business: **commission earned, take rate, payouts due, seller concentration, seller activation**. The data exists (`SellerLedgerEntry`, `SellerBalance`) — it is simply not surfaced.

**Direction: keep the stack, fix the index, cut the client bundle, restructure navigation around saved views, and make the dashboard marketplace-native.** No rewrite, no migration, no microservices. The full argument is in §E–§K.

---

# B. Current Product Problems, Ranked

## Critical

| # | Problem | Evidence |
|---|---|---|
| C1 | `Product.categoryPath LIKE 'prefix%'` cannot use its index under this collation → sequential scan on the hottest query in the system (public category pages **and** admin catalogue). | [FACT] `EXPLAIN` with `enable_seqscan=off` still returns `Seq Scan on "Product" … Disabled: true`. `datcollate = English_United States.1252`. Index is `USING btree ("categoryPath")`. |

## High

| # | Problem | Evidence |
|---|---|---|
| H1 | Zod in the shared client bundle: 84 KB gzip on every page load. | [FACT] Shared baseline = 18 chunks, 1248 KB raw / 360 KB gzip; largest is `05aclc_3x-1q_.js` 366 KB raw / 84 KB gzip `[zod]`. 88 client components import a `schemas.ts`; 0 import zod directly. |
| H2 | Navigation sprawl and duplication: 40 items / 12 groups; 5 single-item groups; `/admin/orders` ×5, `/admin/sellers` ×2, `/admin/email-templates` ×2 (in two different groups). | [FACT] enumerated from `src/config/nav.ts`. |
| H3 | Dashboard omits marketplace economics (commission, take rate, payouts due, seller concentration/activation). | [FACT] `KpiSnapshot` has revenue/orders/returns/refunds/customers/sellers(count)/products/reviews/inquiries — no commission or payable field. |
| H4 | `markEarningsAvailable()` loads **every** due ledger row and every open return into memory in one transaction, nightly. | [FACT] `src/features/finance/service.ts:562,568` — `findMany` with no `take`, unscoped. |
| H5 | Public catalogue reads are uncapped: `/api/v1/products` accepts arbitrary filter/page combinations, has **no rate limit**, and each distinct combination is a cache miss → a database query. | [FACT] 17 of 40 `/api/v1` routes have no `rateLimit`, including `/products`, `/categories`, `/home`. |

## Medium

| # | Problem | Evidence |
|---|---|---|
| M1 | A denied admin **page** returns HTTP 200 with the "no access" screen (the API correctly returns 403). | [FACT] verified; Next commits the status before the guard runs on streamed routes. Already documented in README. |
| M2 | Saving an email template through the editor strips inline styles — the only styling mail clients honour. | [FACT] `sanitize-html` `email` profile sets `allowedStyles: {}`; seeded templates use inline `style=`. |
| M3 | Product creation is one long form; nothing can be saved until title, slug, image, price, category and an active variant exist. | [FACT] `publish-validation.ts` problem codes; editor is a single page of `FormSection`s. |
| M4 | A navigation item pointing at a blog post stores the **slug**, not an id, so renaming a published post silently breaks the menu link. | [FACT] `NavigationItem` has no `blogPostId`. |
| M5 | Aggregate report metrics that page in SQL derive `total` from `COUNT(*) OVER ()` on returned rows → a page past the end reports `total 0`. | [FACT] reported by the reports module; visible in `metrics-catalog.ts`. |
| M6 | No seller is emailed when a payout is marked PAID. | [FACT] no `payout_paid` template; only an internal bell event. |

## Low

| # | Problem | Evidence |
|---|---|---|
| L1 | `report.export` and `catalog.recompute_facets` are in `JOB_TYPES` with no handler and no producer — dead entries. | [FACT] |
| L2 | ~40 `as Route` casts remain on hrefs that now exist in the generated route union. | [FACT] |
| L3 | `src/features/pages/components/param-select.tsx` is imported by five modules but lives in a feature folder. | [FACT] |
| L4 | Stripe / PayU / PhonePe provider adapters are configuration-only. | [FACT] — **correctly labelled in the UI** ("Not implemented yet"), so this is a scope statement, not a defect. |

---

# C. Competitor and Market Research

## C.1 Research matrix

| Product | Category | Nav model | What it does better than us | What not to copy |
|---|---|---|---|---|
| **Shopify Admin** | SaaS commerce, market leader | Short sidebar; **Orders, Products, Customers are the operational heart**; apps/channels are user-**pinnable** | **Saved views as tabs** on Orders/Products/Customers/Inventory: a view stores filters + column choice + column order, appears as a tab, and updates automatically as records change | Its app ecosystem chrome; the sheer breadth of settings |
| **Medusa Admin v2** | Open-source headless commerce | Domain sidebar (Products, Orders, Inventory, Customers, Pricing, Sales Channels, Regions & Shipping) + **keyboard shortcuts (`G` then `P`)** | Multi-location inventory with **reservations** as a first-class concept; extremely lean navigation | Sales-channel/region complexity we do not need |
| **Saleor Dashboard** | Open-source headless commerce | Home, **Product Catalog**, Orders, Customers, Discounts, Translations, **Configuration** | Everything configurable is collapsed into **one Configuration hub** instead of scattered; 45+ extension mount points | GraphQL-first admin complexity |
| **Mirakl** | Enterprise marketplace operator platform | Operator back-office | **The marketplace-native model**: seller onboarding with KYC status synced into the back-office, commission rules **by seller, category or product type**, and payout automation that reconciles orders, refunds, commissions and seller balances | Enterprise pricing/complexity; we do not need OFAC screening or multi-currency payouts yet |
| **Dokan / WCFM** | WordPress multi-vendor | WP admin | Dokan's **overview page** is explicitly marketplace-shaped: net sales, products created, signups, **pending vendors, commission earned, pending withdrawals** — exactly the KPIs we are missing. Commission global/vendor/category/product matches our `CommissionRule` model | WP admin IA; per-plugin fragmentation |
| **Linear / Notion (pattern source)** | General SaaS | Command palette | `Cmd+K` as the power-user path to any record or action — now a standard expectation | Not a commerce comparison |

## C.2 The four lessons that actually apply

1. **[RESEARCH] Saved views beat hardcoded filter links.** Shopify: a view saves *filters + columns + column order*, renders as a tab, and auto-updates its membership. Our five hardcoded Orders entries are a worse version of this — fixed, unshareable, and they consume five sidebar slots.
2. **[RESEARCH] Marketplace dashboards lead with marketplace economics.** Dokan surfaces commission earned and pending withdrawals on the overview; marketplace-KPI literature is blunt that **"GMV without take rate misleads"** and that seller-side engagement (activation, concentration — share of GMV from the top 20% of sellers) is the leading health indicator. Our dashboard has none of these.
3. **[RESEARCH] Configuration belongs in one hub.** Saleor collapses configuration into a single area. We have configuration in *five* places: Settings, Shipping, Commissions, Attributes, Email Templates — plus Roles, Jobs and Navigation.
4. **[RESEARCH] Bulk actions should report progress with counts** ("Updating 47 of 200…"). Ours run in one transaction and report a summary toast at the end — fine up to 500 rows, but there is no progress signal.

Sources: [Shopify saved views](https://help.shopify.com/en/manual/shopify-admin/productivity-tools/searching-filtering-views) · [Shopify Polaris index filters](https://polaris-react.shopify.com/components/selection-and-input/index-filters) · [Shopify admin guide](https://www.eesel.ai/blog/shopify-admin) · [Medusa Admin](https://medusajs.com/admin) · [Medusa user guide](https://docs.medusajs.com/user-guide) · [Saleor](https://saleor.io/open-source) · [Mirakl marketplace platform](https://www.mirakl.com/products/marketplace-platform/) · [Mirakl Payout](https://www.mirakl.com/products/payout/) · [Dokan features](https://dokan.co/wordpress/features/) · [Dokan commission setup](https://dokan.co/docs/wordpress/tutorials/how-to-setup-dokan-vendor-commission/) · [Marketplace KPIs](https://origami-marketplace.com/en-gb/multi-vendor-marketplace-kpis/) · [Version One marketplace KPI dashboard](https://versionone.vc/marketplace-kpi/) · [Admin dashboard UX practices](https://www.saasui.design/blog/b2b-saas-design)

---

# D. Feature Decisions — Keep / Improve / Merge / Move / Remove

| Feature | Decision | Reason | Recommended change |
|---|---|---|---|
| Orders: 5 sidebar status entries | **Merge → saved views** | 5 of 40 nav slots point at one page with a query string | One "Orders" entry; ship user-created saved views as tabs (Shopify model). Seed the four current filters as default views |
| Seller Approvals (`?status=PENDING`) | **Merge** | Duplicate destination of Sellers; the badge already signals pending work | Keep the badge on Sellers; make "Pending approval" a default saved view |
| Email outbox (System) | **Move** | Same page as Email Templates but listed in a different group — split-brain | Keep only under Communication → Email, as a tab |
| Customers / Reports / Notifications / Media (single-item groups) | **Merge** | 5 of 12 groups hold one item; grouping adds a heading with no navigational value | Promote to top-level items without a group heading |
| Attributes | **Move** | It is catalogue *configuration*, not daily catalogue work | Move under a Configuration hub, deep-linked from the category editor where it is actually used |
| Shipping, Commissions, Jobs, Roles, Navigation | **Move** | All configuration, scattered across Orders/Marketplace/System | Consolidate into one **Configuration** area (Saleor model) |
| Dashboard KPI set | **Improve** | Measures a shop, not a marketplace | Add GMV, take rate, commission earned, payouts due, seller activation, seller concentration |
| Product creation | **Improve** | Long single form before anything can be saved | Add "quick create" (title + category + price → draft), then the full editor |
| Bulk actions | **Improve** | No progress signal | Add "n of m" progress; keep the ≤500 transaction cap |
| Product/attribute CSV import | **Keep as is** | Already has dry-run + validation preview | — |
| Media library, RBAC, audit log, returns/refunds/payouts, homepage sections, navigation builder | **Keep as is** | Verified complete and correct end to end | — |
| Stripe / PayU / PhonePe adapters | **Keep as declared** | Honestly labelled "Not implemented yet" | Implement on demand; the `PaymentProvider` interface already exists |
| `report.export`, `catalog.recompute_facets` job types | **Remove** | No handler, no producer | Delete from `JOB_TYPES` or implement |
| Denied-page 403 status | **Accept + document** | Next commits status before the guard on streamed routes; no data leaks | Already in README's Known Limitations |

---

# E. Recommended Product Architecture (sitemap)

**[REC]** From 12 groups / 40 items to **7 groups / 24 items**, grouped by *who does the work and how often*, not by table.

```text
Dashboard                     (marketplace overview: GMV, take rate, actionable queues)

Orders                        saved views replace the 5 status entries
├── Orders                    (views: Needs action · Pending · Processing · Shipped · Delivered · custom)
├── Returns
├── Refunds
└── Payments

Catalog
├── Products                  (views: All · Draft · Out of stock · Low stock · Customisable)
├── Categories                (attributes edited in context here)
└── Inventory

Marketplace
├── Sellers                   (views: All · Pending approval · Suspended)  + badge
└── Payouts                   (statements · balances · ledger)

Customers

Marketing
├── Coupons
├── Promotions
└── Banners

Content
├── Homepage
├── Pages
├── Blog
├── FAQs
└── Reviews

Communication
├── Inquiries
├── Newsletter
└── Email            (templates · outbox)

Reports
Media Library

Configuration                 one hub (Saleor pattern)
├── Store settings            (general · tax · orders · checkout · inventory · returns · SEO · social)
├── Shipping                  (zones · rates · pincodes · partners)
├── Commissions & charges
├── Attributes
├── Navigation menus
├── Payments & providers
├── Users & roles
├── Background jobs
└── Audit log
```

**Why this shape:** Orders/Catalog/Marketplace/Customers is the daily operating loop (Shopify's "operational heart", extended for multi-vendor). Everything an operator touches monthly or less — attributes, shipping tables, commission rules, menus, roles, jobs — moves behind Configuration, which is the single change that removes the most sidebar noise without hiding daily work.

---

# F. Recommended Navigation

**[REC]**

- **Sidebar:** 7 groups, ~24 items (from 40). No group with a single child keeps a heading.
- **Badges:** unchanged — they already carry the "needs attention" signal (`pendingOrders`, `pendingSellers`, `pendingReviews`, `newInquiries`, `openReturns`, `lowStock`, `unreadNotifications`).
- **Saved views** replace every hardcoded `?status=` nav entry. A view stores filters + visible columns + column order (Shopify's model), renders as a tab above the table, and is per-user with an option to share to the whole team.
- **Global search (`Cmd+K`)** already exists and is permission-filtered — **keep**. Add *actions* as results ("Create product", "Generate payout"), not just records.
- **Quick-create (`c`)** in the header: product, order, customer, coupon.
- **Header actions** stay: search, notifications, theme, account.
- **Contextual actions** live next to the data (row actions and bulk bar), never only in a detail page.

---

# G. Page-by-Page UI Specification (the five that matter most)

### G.1 Dashboard

**Purpose:** in ten seconds, tell the operator whether the marketplace is healthy and what needs a decision today.
**Primary action:** jump into the queue that needs work.
**First screen (above the fold):**
- Row 1 — **marketplace economics**: GMV, **take rate %**, commission earned, payouts due, net revenue. *(All derivable today from `OrderItem.commissionPaise` / `chargesPaise` and `SellerBalance`; none currently shown.)*
- Row 2 — **actionable queues** as counts that link to a filtered view: orders needing action, seller approvals, open returns, refunds to process, reviews to moderate, new inquiries, low/out-of-stock.
**Secondary:** revenue/orders/customer/seller trend charts, top products, top sellers, category split, payment split.
**Below that:** recent orders / customers / seller registrations / reviews / activity.
**Filters:** the existing 8 presets + custom range.
**Empty state:** demo-data banner when `demo_`-prefixed rows exist (already built).
**Errors:** per-panel Suspense boundary so one failing widget cannot take the page down (already built).
**[REC] Add:** seller concentration (share of GMV from top 20% of sellers) and seller activation rate — the two leading health indicators from marketplace KPI research.

### G.2 Orders list

**Purpose:** work the fulfilment queue.
**Primary action:** move orders forward.
**First:** saved-view tabs → search → the table.
**Columns:** number, placed, customer, items, sellers, total, payment, status, shipping status.
**Row actions [REC]:** promote the next legal transition inline (Confirm / Mark processing / Mark packed) so the common case never requires opening the order.
**Bulk (exists):** confirm, mark processing, mark packed, print packing slips, export. **[REC]** add a progress indicator with counts.
**Filters (exist):** payment status, method, seller, customer, date range, amount, source, has returns, has customisation.
**Empty state:** distinguish "no orders yet" from "no orders match these filters" (pattern already used elsewhere).

### G.3 Product editor

**Purpose:** get a sellable product live.
**[REC] Change:** add **quick create** — title, category, price → saves a DRAFT immediately, then opens the full editor. Today nothing can be saved until title, slug, image, price, category and an active variant all exist.
**Keep:** the single-page `FormSection` layout with the right rail (status, publish checklist, stock summary, performance). It suits editing, which is the more frequent job.
**Keep:** the publish checklist — it explains *why* publish is blocked instead of failing silently.

### G.4 Sellers

**Purpose:** onboard and police the supply side.
**Keep:** bulk approve/reject/suspend with a required reason (already built — this is the highest-frequency marketplace task and it is already 2 clicks from the list).
**[REC] Add:** an onboarding funnel strip (registered → under review → approved → activated → first sale) — Mirakl's KYC-status-in-the-back-office model. Today the workflow is a per-seller stepper with no cohort view.

### G.5 Configuration hub

**Purpose:** one place for everything changed monthly or less.
**Layout:** left rail of configuration sections, search across settings keys, each section a form with `{ isSet, last4 }` masking for secrets (already built).
**[REC]:** merge today's Settings + Shipping + Commissions + Attributes + Navigation + Payments + Users/Roles + Jobs + Audit log under this one hub.

---

# H. Top Workflow Optimisations

| # | Workflow | Current | Recommended | Saving |
|---|---|---|---|---|
| 1 | Advance an order one status | Orders → open order → header action → confirm dialog (**4**) | Row action inline in the list (**2**) | 2 steps on the single most repeated task |
| 2 | Work a status queue | Click one of 5 sidebar entries; cannot save your own filter combination | Saved views as tabs, user-defined + shareable | Removes 4 nav items; arbitrary queues |
| 3 | Create a product | Fill a long form; nothing saved until 6 conditions met | Quick create → draft in 3 fields → enrich later | Removes the blank-page stall |
| 4 | Approve sellers | Already bulk from the list (**2**) | **No change — already optimal** | — |
| 5 | Find any record | `Cmd+K`, permission-filtered (**1**) | Add actions to results | — |
| 6 | Change a commission rule | Marketplace → Commissions → rule → save (**3**) | Same, but reachable from the seller and category editors in context | Removes a hunt |
| 7 | Reconcile a payout | Payouts → statement → entries → cross-check ledger tab (**4**) | Entries inline in the statement with the identity check visible (already computed server-side) | 1–2 steps |
| 8 | Diagnose "why is this product not visible?" | Check status, category active, seller active, stock, publish checklist — across 3 screens | One "Visibility" panel on the product page listing every reason it is or is not live | 3 screens → 1 |

**[REC] Note:** items 4 and 5 are already at their optimum. I am deliberately not proposing changes there — the audit brief warned against changing things merely to show change.

---

# I. Click-Reduction Summary

**[FACT] Already good:** bulk actions on orders, sellers, products, customers, reviews, inventory; URL-driven filters (every view is shareable by pasting the link); `Cmd+K` global search; row action menus; inline switches on category tree rows.

**[REC] Remaining wins**, in order of daily frequency:
1. Inline status transitions on the orders list (−2 steps, dozens of times a day).
2. Saved views (removes the "re-apply my filters every morning" tax).
3. Quick-create product (−1 screen, removes the all-or-nothing form).
4. Visibility diagnostic panel (−2 screens on a recurring support question).
5. Actions in `Cmd+K` (−2 steps for create flows).

---

# J. Automation and AI Opportunities

| Opportunity | Class | Why |
|---|---|---|
| Auto-cancel unpaid online orders; auto-cancel unconfirmed COD | **Already built** (`orders.expire_unpaid`, `orders.cancel_unconfirmed_cod`) | — |
| Low/out-of-stock alerts, earnings availability, promotion expiry, price/facet recompute | **Already built** (recurring jobs) | — |
| `payout_paid` email to the seller | **High-value automation** | Closes the money loop; today only an internal bell event |
| Auto-approve sellers when KYC docs verified + bank account present | **High-value automation** | The rule already exists (`activationReady`); make it opt-in per marketplace |
| Duplicate-product detection at create time | **Useful AI assistance** | Marketplaces accumulate near-duplicate listings from many sellers; a title+image similarity check at submit is cheap and high-value |
| Review moderation triage (spam/abuse pre-classification) | **Useful AI assistance** | 123 reviews today, but this scales linearly with orders and is pure manual queue work |
| Category + attribute suggestion from product title/description | **Useful AI assistance** | Directly serves the client's core requirement (per-category attributes); sellers pick wrong categories constantly |
| Natural-language report queries ("GMV by category last quarter") | **Nice-to-have** | The 13 structured reports already cover the known questions |
| AI-written product descriptions | **Nice-to-have** | Sellers write these; not the operator's job |
| Anomaly detection on GMV/refund rate | **Nice-to-have** | Needs more history than the product has |
| AI for commission/payout calculation | **Not recommended** | Deterministic money maths must stay deterministic and auditable. Rules already exist and are unit-tested against a reference vector |
| AI for permission decisions | **Not recommended** | Security must be explicit and reviewable |

---

# K. Implementation Roadmap

### Phase 1 — Critical fixes (do first; ~1–2 days)
1. **C1 index fix.** Add `text_pattern_ops` (or `COLLATE "C"`) index on `Product.categoryPath`; verify with `EXPLAIN` that the seq scan becomes an index/bitmap scan. *This is the single highest-value change in this document.*
2. **H1 bundle fix.** Split `schemas.ts` into client-safe (types, constants, label maps, URL param parsers) and server-only (zod validators); make client components import types only. Target: remove 84 KB gzip from every page.
3. **H4/H5 guards.** Batch `markEarningsAvailable()` (process in chunks with a cursor); add a rate limit + a bound on filter cardinality to `/api/v1/products`.

### Phase 2 — Workflow optimisation (~1 week)
4. Saved views on Orders, Products, Customers, Sellers, Inventory (seed today's hardcoded filters as default views).
5. Inline status transitions on the orders list; bulk progress counts.
6. Quick-create for products.
7. Product visibility diagnostic panel.

### Phase 3 — Restructuring (~1 week)
8. Navigation: 12 groups/40 items → 7 groups/~24 items; Configuration hub; remove duplicate destinations.
9. Dashboard rebuild around marketplace economics (GMV, take rate, commission, payouts due, seller activation/concentration).

### Phase 4 — Automation (~2–3 days)
10. `payout_paid` email; opt-in auto-activation of sellers; `NavigationItem.blogPostId` migration; `payout` statement identity surfaced inline.
11. Clean-ups: dead `JOB_TYPES`, `as Route` casts, move `param-select.tsx` to shared, email-template style allowlist decision.

### Phase 5 — AI (only after 1–4)
12. Duplicate-product detection, review triage, category/attribute suggestion — in that order, each behind a feature flag and measured against manual baseline.

---
---

# TECHNICAL AUDIT

# L. Feature Implementation Matrix

**[FACT]** Derived by tracing, per module: server actions → permission checks → transactional service → database calls → audit rows → cache invalidation, plus the admin API routes and the integration checks that exercise them.

Totals across 38 feature modules: **255 server actions · 285 permission checks · 773 database calls · 233 transactions · 329 audit writes · 255 cache invalidations · 222/222 API routes wrapped · 410 unit tests · 30 integration check scripts.**

| Module | UI | Backend | API | DB | End-to-end | Status | Missing work |
|---|---|---|---|---|---|---|---|
| Products (26 actions, 20 routes) | Yes | Yes | Yes | Yes | Yes | **Complete** | Quick-create UX only |
| Categories + Attributes (13/8 actions) | Yes | Yes | Yes | Yes | Yes | **Complete** | — |
| Inventory (4 actions, 8 routes) | Yes | Yes | Yes | Yes | Yes | **Complete** | — |
| Orders (13 actions, 12 routes) | Yes | Yes | Yes | Yes | Yes | **Complete** | Inline row transitions |
| Returns / Refunds / Payments | Yes | Yes | Yes | Yes | Yes | **Complete** | Async gateway refund auto-complete |
| Sellers (15 actions, 16 routes) | Yes | Yes | Yes | Yes | Yes | **Complete** | — |
| Finance: commissions + payouts (13 actions) | Yes | Yes | Yes | Yes | Yes | **Complete** | `payout_paid` email |
| Customers + integration API (9 actions, 9 routes) | Yes | Yes | Yes | Yes | Yes | **Complete** | — |
| Coupons / Promotions / Banners | Yes | Yes | Yes | Yes | Yes | **Complete** | — |
| Shipping (17 actions, 12 routes) | Yes | Yes | Yes | Yes | Yes | **Complete** | — |
| Content: homepage / navigation | Yes | Yes | Yes | Yes | Yes | **Complete** | `blogPostId` FK for nav items |
| Pages / Blog / FAQs | Yes | Yes | Yes | Yes | Yes | **Complete** | — |
| Reviews / Inquiries / Newsletter | Yes | Yes | Yes | Yes | Yes | **Complete** | — |
| Reports (13 reports) | Yes | Yes | Yes | Yes | Yes | **Complete** | `COUNT(*) OVER ()` paging total |
| Dashboard | Yes | Yes | Yes | Yes | Yes | **Needs improvement** | Marketplace KPIs |
| Notifications / Email templates / Jobs | Yes | Yes | Yes | Yes | Yes | **Complete** | Email inline-style policy |
| Media library | Yes | Yes | Yes | Yes | Yes | **Complete** | — |
| Users / Roles / Audit log / Settings | Yes | Yes | Yes | Yes | Yes | **Complete** | — |
| Search (`Cmd+K`) | Yes | Yes | Yes | Yes | Yes | **Complete** | Add actions to results |
| Public API `/api/v1` (40 routes) | n/a | Yes | Yes | Yes | Yes | **Complete** | Rate limits on cached reads |
| Payment adapters: COD, MANUAL, MOCK, Razorpay | Yes | Yes | Yes | Yes | Yes | **Complete** | — |
| Payment adapters: Stripe, PayU, PhonePe | Config only | No | n/a | Yes | No | **Not implemented (declared)** | Implement `PaymentProvider` when needed |

**No module is "Frontend Only" and none is "Broken."** [FACT] The only placeholder text found anywhere in `src/` is the three unimplemented gateway descriptions; the only `TODO`s are two ESLint suppressions for a hydration pattern.

# M. Missing Backend Features

[FACT] Only these, all minor and none blocking:
1. Stripe / PayU / PhonePe adapters (declared, not hidden).
2. `payout_paid` seller email.
3. Async gateway refunds that settle as PROCESSING wait for a human "Mark completed" — a webhook path into `transitionRefund` does not exist.
4. `NavigationItem` has no `blogPostId` FK.
5. Two `JOB_TYPES` with no handler and no producer.

# N. Broken Integrations

[FACT] **None found.** 1,031 of 1,031 modules import cleanly; 253 API routes return no 5xx; 29 database-backed checks pass, including the full COD order lifecycle and the return → refund → ledger-reversal chain.

# O. Performance Problems, Ranked

| Rank | Problem | Measured | Fix |
|---|---|---|---|
| **Critical** | `Product.categoryPath LIKE` → seq scan; index unusable under `1252` collation | `EXPLAIN` with seqscan disabled still seq-scans | `text_pattern_ops` index |
| **High** | Zod 84 KB gzip in every page's shared baseline | baseline 360 KB gzip, zod chunk 84 KB | split client/server schemas |
| **High** | `markEarningsAvailable` unbounded scan in one transaction | `findMany`, no `take`, unscoped | chunked cursor |
| **Medium** | Public product API: no rate limit, unbounded filter cardinality → cache-key explosion | 17/40 `/api/v1` routes unlimited | rate limit + param allowlist |
| **Medium** | RSC/HTML payloads 168–537 KB per admin page | dashboard 537 KB, products 457 KB | trim server→client props on list pages |
| **Low** | Reports paging `total` from `COUNT(*) OVER ()` | reported by module owner | separate count query |

**[FACT] What is already fast:** admin API 12–44 ms median, public API 4–9 ms median (`unstable_cache` working), page TTFB 95–705 ms on the production build, client code-splitting correct (recharts only on chart pages, tiptap dynamically imported, **zero** server-only libraries — exceljs, nodemailer, Prisma, sharp, bcrypt, sanitize-html — in any client bundle).

# P. Database Audit

[FACT] 83 models, 157 indexes/uniques. Every model without a block-level index has a field-level `@unique` or composite `@id`. Raw SQL is used in 18 files (reports aggregation, queue `SKIP LOCKED`, rate-limit upsert) — appropriate.

| Problem | Technical reason | Impact | Fix | Priority |
|---|---|---|---|---|
| `categoryPath` prefix scan | btree under non-C collation cannot serve `LIKE 'x%'` | Full scan of `Product` on the hottest query | `@@index([categoryPath(ops: raw("text_pattern_ops"))])` | **Critical** |
| Ledger aggregation across all sellers | No leading-column filter → seq scan | Slow at millions of ledger rows | Balances already read the `SellerBalance` projection ✅; keep ledger aggregates filtered | Medium |
| Unbounded batch reads (6) | No `take` | Memory + long transactions | Chunk `markEarningsAvailable` | High |
| Statistics not collected | `n_live_tup = 0`, no `seq_scan` data | Planner may misestimate | Run `ANALYZE` after seeding; enable autovacuum logging | Low |

**Verified good:** money as `Int` paise and rates as bps (no float drift); ledger + projection pattern for stock and seller balances; append-only `AuditLog` enforced by a trigger that rejects `UPDATE`/`DELETE`; sequences for order/RMA/refund/payout numbers; `pg_trgm` GIN index for product title search; partial unique index enforcing one open payout per seller.

# Q. API Audit

[FACT] 264 route files. Admin: 222/222 wrapped in `withAdminApi` (permission + same-origin CSRF + rate-limit options + typed error envelope). Public: consistent `{ data, meta }` / `{ error: { code, message } }` envelopes, CORS allowlist, `unstable_cache` with tags on reads, `no-store` on anything token-bearing.
**Gaps:** 17 public GETs have no rate limit; no ETag/conditional requests on public reads; `/api/v1/products` has no cap on filter combinations.

# R. Frontend Audit

[FACT] Shared baseline **1248 KB raw / 360 KB gzip** across 18 chunks on every page. Per-route additions are modest (77–621 KB raw). Total client JS **7.2 MB raw / 2.5 MB gzip** across 1,921 split files.
Largest shared item is **zod (366 KB / 84 KB gzip)** — removable. Route-specific libraries load correctly: recharts only on dashboard/reports, `react-day-picker` + `date-fns` only where a date picker exists, tiptap dynamically imported with `ssr: false`.
List state lives in the URL, so pages stay Server Components — the main reason per-route JS stays small.
**[REC]** After the zod split, consider lazy-loading the date picker and virtualising tables beyond ~200 rows (server pagination already caps at 100).

# S. Security Review

| Control | Status | Evidence |
|---|---|---|
| AuthN | Strong | Auth.js + database-backed `AdminSession`; revocation effective next request; TOTP 2FA with replay protection; password reset with hashed single-use tokens |
| AuthZ | **Verified live** | 29/29 probe: anonymous → login redirect; admin API → 401; catalog-manager → 403 on APIs and **zero module data** rendered on denied pages; permitted modules work |
| CSRF | Complete | 222/222 admin routes assert same-origin/`APP_ORIGIN` on non-GET |
| SQL injection | **None found** | All raw SQL uses tagged templates with bound params or `Prisma.join`. The three dynamic `ORDER BY` sites use hardcoded map lookups + a ternary; `bucket` is zod-enum validated. `*Unsafe` calls exist only in the seed |
| Secrets at rest | Complete | AES-256-GCM per-purpose keys for 2FA secrets, bank accounts, SMTP and payment credentials; reads return `{ isSet, last4 }` |
| Rate limiting | Partial | Login, uploads, checkout, coupons, reviews, contact covered; 17 cached public GETs uncovered |
| XSS | Strong | `sanitize-html` on write **and** on public output; admin HTML previews in sandboxed iframes |
| Audit | Strong | 329 audit call sites; append-only enforced at the database |
| Data leakage | **Verified** | Automated denylist scan over every `/api/v1` response: no `costPaise`, `passwordHash`, PII, KYC, `commissionPaise`, internal notes |
| Known gap | Medium | Denied **page** returns 200 with the no-access screen (API returns 403) |

# T. Scalability Assessment

[FACT] Current dataset: 74 products, 176 variants, 161 orders, 315 ledger entries, 48 customers. All timings above are at this scale — **they do not prove behaviour at 100×**, and the plans show where it breaks first.

| Component | Expected first bottleneck | Impact | Fix | Priority |
|---|---|---|---|---|
| `Product` category filter | ~10k+ products | Full scan on every storefront category page | `text_pattern_ops` index | **Critical** |
| `/api/v1/products` | Any scraping traffic | Cache-key explosion → DB per request | Rate limit + param allowlist | High |
| `markEarningsAvailable` | ~100k ledger rows | Long transaction, memory | Chunked cursor | High |
| `AuditLog`, `StockMovement`, `OrderEvent` | ~10M rows | Slow admin history views | Time partitioning + retention policy | Medium |
| Job queue | High job volume | Single worker throughput | It already uses `FOR UPDATE SKIP LOCKED` — run N workers | Low |
| Postgres connections | Serverless deploy | Pool exhaustion | Pooled URL (documented in README) | Medium |

At **100 → 1,000 users** the system is fine as built. At **10,000+** the index fix and the public-API cap are prerequisites, not optimisations.

# U. Tech Stack Recommendation

## **Option 1 — Keep the current stack. Optimise only.**

| Technology | Keep | Upgrade | Replace | Reason |
|---|---|---|---|---|
| Next.js 16 (App Router) | ✅ | | | Server Components keep per-route JS small; typed routes caught real errors during the build |
| React 19 + TypeScript strict | ✅ | | | 0 type errors across 1,201 files |
| Tailwind v4 + shadcn/ui | ✅ | | | Consistent, no runtime cost |
| Prisma 7 + PostgreSQL 18 | ✅ | | | 83 models, correct transactions; raw SQL available where aggregation needs it |
| Auth.js v5 + DB sessions | ✅ | | | Verified working incl. 2FA and revocation |
| Zod v4 | ✅ | | | **Server-side only** — remove from client bundles |
| Postgres-backed queue | ✅ | | | `SKIP LOCKED` is correct; Redis only if job volume demands it |
| Local/S3 storage abstraction | ✅ | | | Adapter already exists |
| Observability | | **Add** | | The one genuine gap: no error tracking, structured logs, metrics or tracing |

**Not recommended:** microservices (one team, one domain, no independent scaling need), a different framework, or a database change. Nothing measured here is caused by the stack; the critical issue is a missing index, and the biggest frontend issue is an import boundary — both fixable inside the current architecture in hours.

**Cost comparison [REC]:** optimise ≈ 2–3 days of work with immediate, measurable gains; migrate ≈ months and would reintroduce every bug this audit shows is absent.

# V. Recommended Target Architecture

```
Browser (admin)                     Customer website (separate app)
   │                                        │
   ▼                                        ▼
CDN / edge cache  ──────────────── caches /api/v1 GETs (s-maxage + tags)
   │
   ▼
Next.js 16 app (server components + route handlers)
   ├── requirePermission / withAdminApi        ← authz boundary (unchanged)
   ├── features/<domain>/service.ts            ← business logic in transactions
   └── unstable_cache + revalidateTag          ← public read cache
   │
   ├──────────────► Postgres 18  (+ text_pattern_ops index, ANALYZE, partitioning later)
   ├──────────────► Job queue (same Postgres, SKIP LOCKED) → worker process(es)
   └──────────────► Object storage (local dev / S3 prod)
   │
   └── ADD: error tracking + structured logs + metrics
```

**Unchanged:** framework, database, ORM, auth, module architecture, queue.
**Optimise:** the index, the client schema boundary, the earnings job, public-read limits.
**Add:** observability.
**Defer until real growth:** Redis, table partitioning, read replicas, multiple workers, microservices (probably never).

---

## Closing note on method

Every performance figure here was measured against the **production build** on a free port — my first measurements were wrong because a dev server held port 3000 and I was reading unminified HMR bundles (9 MB/page). The corrected figures are 1.4–1.9 MB raw per page. I am flagging this because it is exactly the kind of error that makes audits misleading, and the corrected numbers change the conclusion from "the frontend is bloated" to "the frontend is well split, with one removable library."
