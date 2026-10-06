# DIY Baazar — Marketplace Admin

The administration platform for a multi-seller handmade/DIY marketplace: catalogue, sellers,
orders, money and content, run from one dashboard. It also **serves the API the customer website
reads from**, so anything changed here appears on the site without a code change or a deploy.

**Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind v4 · shadcn/ui · Auth.js v5 ·
Prisma 7 · PostgreSQL 18**

---

## What this is (and is not)

| | |
|---|---|
| **In scope** | The admin dashboard, its REST API (`/api/admin/**`), and the public API the website consumes (`/api/v1/**`). |
| **Out of scope** | The customer-facing website itself. You build that separately; it talks to this over `/api/v1`. The contract is [`docs/PUBLIC_API.md`](docs/PUBLIC_API.md). |

The design contract — schema, permissions, money rules, state machines, every decision and why —
is [`docs/MARKETPLACE_BLUEPRINT.md`](docs/MARKETPLACE_BLUEPRINT.md). Section 14 is binding and
overrides anything earlier in that document.

---

## Setup

PostgreSQL 18 must be running locally (this project was built against `postgres` on port 5432).

```bash
cp .env.example .env      # then fill in the values below
npm install
npm run db:migrate        # creates diybaazar_db and applies the schema
npm run db:seed           # taxonomy, roles, settings, templates + demo data
npm run dev               # http://localhost:3000/admin
```

`.env` values that matter:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | `postgresql://postgres:PASSWORD@localhost:5432/diybaazar_db?schema=public` |
| `AUTH_SECRET` | `openssl rand -base64 32`. Rotating it signs everyone out. |
| `ENCRYPTION_KEY` | 32 random bytes, base64. Encrypts 2FA secrets, bank accounts, payment and SMTP credentials. **Must differ from `AUTH_SECRET`; production refuses to start otherwise.** Losing it makes those fields unreadable. |
| `APP_ORIGIN` | Public origin of this admin. Used for password-reset links and the CSRF check. |
| `STOREFRONT_ORIGINS` | Comma-separated origins allowed to call `/api/v1` (CORS). |
| `STOREFRONT_API_KEY` | Shared secret for the website's server-to-server `/api/v1/integration/**` calls. |
| `CRON_SECRET` | ≥32 bytes; guards `POST /api/internal/jobs/run`. |
| `STORAGE_DRIVER` | `local` (default) or `s3`. Local files live in `storage/`, never in `public/`. |
| `SEED_DEMO_DATA` | `false` to seed only real configuration and skip the demo catalogue. |

### Signing in

| Account | Password | Role |
|---|---|---|
| `admin@diybaazar.local` | `Admin@123456` | Super admin (bypasses every permission check) |
| `<role-slug>@diybaazar.local` | `Admin@123456` | One test user per role, e.g. `catalog-manager@`, `finance-manager@`, `order-manager@` |

Change the super-admin password at `/admin/account/password` before deploying anywhere.

---

## What the admin manages

| Group | Screens |
|---|---|
| **Catalog** | Products (variants, images, SEO, customisation options), Categories (unlimited depth), Attributes, Inventory |
| **Orders** | All orders + status views, manual order entry, invoices, packing slips, Returns (RMA), Refunds, Payments, Shipping (zones, rates, pincodes, partners) |
| **Marketplace** | Sellers, Seller approvals, Commissions, Payouts |
| **Customers** | CRM with segments, addresses, orders, wishlist, reviews, returns, activity |
| **Marketing** | Coupons, Promotions, Banners |
| **Content** | Homepage sections, Navigation menus, CMS pages, Blog, FAQs, Reviews moderation |
| **Communication** | Contact inquiries, Newsletter, Email templates + outbox |
| **Reports** | 13 reports (sales, orders, products, categories, sellers, customers, revenue, commissions, payouts, inventory, refunds, coupons, tax) with date ranges, filters and CSV/XLSX/print export |
| **System** | Admin users, Roles & permissions, Audit log, Settings, Background jobs, Media library |

### Categories, filters and variants

This is the part the marketplace lives or dies on, so it is worth stating plainly:

- Categories are a **tree of unlimited depth**, created and reordered from the admin. Nothing is hardcoded.
- **Filters are per category.** You assign attributes (Colour, Material, Size, Painting Medium, …) to a
  category; children inherit them, can override a flag, or exclude one entirely. Jewellery therefore
  shows different filters from Paintings — and the category screen previews exactly what the website
  will render, using the same facet builder the public API uses.
- Attributes marked *variant-defining* generate **product variants** (Colour × Size), each with its own
  SKU, price, stock and images.

---

## Architecture

```
src/
  app/
    admin/(auth)/        login · forgot / reset password · two-factor
    admin/(shell)/       every admin screen, behind the sidebar shell
    api/admin/**         admin REST API (permission-checked)
    api/v1/**            public API the customer website reads + intake endpoints
    api/internal/**      cron entry point
    media/[...key]       public file serving for the local storage driver
  features/<domain>/     queries.ts (reads) · schemas.ts (zod) · service.ts (business logic,
                         transactional, no Next imports) · actions.ts (server actions) · components/
  components/shared/     data tables, forms, pickers, tree view, charts, dialogs
  lib/                   db · auth · api · storage · queue · payments · email · export · crypto
prisma/                  schema (83 models) · migration · seed modules
scripts/                 worker.ts (background jobs) · disable-2fa.ts (break-glass)
```

**Rules the code follows**

- Money is an integer number of **paise**; commission and tax rates are **basis points**. No floats.
- Statuses are `String` columns validated by Zod enums in `src/lib/enums.ts`, with the legal
  transitions declared next to them.
- UI never touches Prisma. Pages read through `queries.ts`; every mutation goes
  permission check → Zod → `service.ts` inside a transaction → audit row → cache invalidation.
- Stock only ever changes through `applyStockMovement()`, which writes a ledger row and the
  projected balance in the same transaction.
- List state (filters, search, sort, page, tab) lives in the URL, so pages stay Server Components
  and any view can be pasted to a colleague.

### Authorization

95 permission codes across 9 roles (super admin, admin, catalog / order / seller / finance /
marketing / content manager, customer support). Enforced **server-side** in three places:
`requirePermission()` in every page, `requirePermissionOrThrow()` in every server action, and
`withAdminApi({ permission })` in every API route. The sidebar hides what you cannot use, but that
is convenience — the server refuses regardless.

Sessions are database-backed (`AdminSession`): revoking one takes effect on the next request. TOTP
two-factor, password reset, login rate-limiting and per-device session management are built in.

### Background work

`npm run worker` runs the queue (emails, payout generation, price/facet recomputation, stock alerts,
reservation expiry). In production you can instead hit `POST /api/internal/jobs/run` from a cron with
the `X-Cron-Secret` header. `/admin/jobs` shows what is queued, running or failed and can run a batch
on demand.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` | Route typegen + `tsc --noEmit` |
| `npm test` | 410 unit tests (money maths, state machines, parsers, sanitisers) |
| `npm run lint` | ESLint |
| `npm run db:migrate` / `db:seed` / `db:reset` / `db:studio` | Prisma |
| `npm run worker` | Background job worker |

### Integration checks

29 scripts under `src/features/*/__checks__/` exercise real flows against the live database — the
full COD order lifecycle, the return → refund → ledger reversal chain, payout generation, category
moves, media upload, RBAC rules, and a scan proving no private field leaks through `/api/v1`. Run one with:

```bash
node --env-file=.env --import tsx --import ./src/features/storefront/__checks__/stub-server-only.ts \
  src/features/orders/__checks__/order-check.ts
```

They create rows deliberately (audit rows cannot be deleted — the table rejects `UPDATE`/`DELETE` by
design), so prefer a scratch database if you run them repeatedly.

---

## Demo data

`npm run db:seed` loads a working marketplace so every screen has something real in it: 47 categories,
21 attributes with 163 values, 74 products (176 variants, 39 customisation options), 8 sellers,
48 customers, 161 orders with 156 shipments, 14 returns, 10 refunds, 2 payouts over 315 ledger
entries, 12 coupons, 14 banners, 15 homepage sections, 123 reviews and 319 media assets.

Every demo row's id starts with `demo_`. Set `SEED_DEMO_DATA=false` and re-seed for a clean store
with only the taxonomy, roles, settings, email templates, menus and system pages.

---

## Going to production

1. Managed PostgreSQL in **ap-south-1 (Mumbai)** — a US database adds ~200 ms to every query for an
   operator in India. Put the pooled URL in `DATABASE_URL`.
2. Fresh `AUTH_SECRET` and `ENCRYPTION_KEY`; back the encryption key up somewhere you can recover it.
3. `prisma migrate deploy` in the release step (never `migrate dev`).
4. Set `APP_ORIGIN`, `STOREFRONT_ORIGINS` and `STOREFRONT_API_KEY` to the real origins/secret.
5. Switch `STORAGE_DRIVER=s3` and fill the `S3_*` variables, or mount a persistent volume for `storage/`.
6. Run the worker as a process, or point a cron at `/api/internal/jobs/run`.
7. Configure a payment provider under Settings → Payments (COD and manual work out of the box; the
   Razorpay adapter is wired and a mock provider exists for testing).
8. Deployment protection: the panel already sends `noindex`, but keep it off the public internet where
   you can.

---

## Known limitations

- **A denied admin page returns HTTP 200 with a "You do not have access" screen**, not 403. Next.js
  commits the status before the page's guard runs on these streamed routes. No data is rendered and
  the API returns a proper 403 — but do not build monitoring on the page status code.
- **Email templates lose inline styles when saved through the editor.** The sanitiser strips `style`
  attributes (the security rule), which is the only styling mail clients honour. Fix by allowing a
  vetted style allowlist on the `email` profile in `src/lib/sanitize/html.ts` if you need styled mail.
- A navigation item pointing at a blog post stores the slug, so renaming a published post's slug
  breaks that menu link.
- `report.export` and `catalog.recompute_facets` exist in `JOB_TYPES` with no handler; nothing
  enqueues them.
