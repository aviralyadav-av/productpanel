# Niya Bags — Admin Panel

A standalone operations panel for the Niya Bags storefront. It deploys on its own
domain, owns its own PostgreSQL database, and does not touch the existing Vite
storefront in `../e-commerce_frontend-main`.

**Next.js 16 (App Router) · TypeScript · Tailwind v4 · shadcn/ui · Auth.js v5 · Prisma 7 · PostgreSQL**

---

## Read this first

The storefront has **no backend**. Its `src/api/*.js` modules return static local
JavaScript objects; auth is fake and lives in `localStorage`; orders are written
to the shopper's own browser and never transmitted.

So: **nothing you change in this admin appears on the live site yet.** That is not
a bug in this panel — it is the state of the storefront. The admin builds the
system of record now; the storefront is repointed at it later. `/settings?tab=cutover`
lists exactly what that will take, file by file.

What *is* real from day one: the full catalogue (39 products, 78 variants, 39
images), every homepage section, all 8 static pages, the FAQ, the footer, and
manual order and customer entry — which is how this store already takes COD
orders over WhatsApp.

---

## Setup

### 1. Point it at PostgreSQL

PostgreSQL 17 is already running on this machine (service `postgresql-x64-17`,
port 5432). Open `.env` and replace `YOUR_PASSWORD` with the password you set
when you installed it:

```
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/niya_admin?schema=public"
```

You do not need to create the `niya_admin` database by hand — the migration
creates it.

### 2. Create the schema and load the data

```bash
npm run db:migrate      # creates the database and applies the schema
npm run db:seed         # imports the storefront catalogue and content
npm run dev             # http://localhost:3000
```

If `db:migrate` reports a password failure, only `DATABASE_URL` is wrong —
nothing else needs changing.

### 3. Sign in

| Account | Password | What it proves |
|---|---|---|
| `admin@niyabags.com` | `Admin@12345` | Full access |
| `customer@example.com` | `Customer@12345` | Signs in, then is refused the dashboard — the authorization check working |

Change the admin password in `/settings?tab=account` before deploying anywhere.

---

## What the seed loads

Extracted verbatim from the storefront by `npm run extract:storefront`, which
reads `../e-commerce_frontend-main` and never writes to it:

| | |
|---|---|
| Products | 39 |
| Variants | 78 — the 14 that already had ids (`tote-001-brown`) keep them; the rest get the same shape |
| Product images | 78, after collapsing 156 duplicate references (the source repeats each file three times) |
| Media assets | 50, copied into `public/legacy/` so the library works offline |
| Content sections | 11, with 16 ordered blocks |
| CMS pages | 8 |
| FAQs | 6 |
| Testimonials | 3 |

**Chosen, not imported:** opening stock of 12 per variant, written as an explicit
`SEED` entry in the stock ledger. The storefront has no inventory concept at all,
so this is a starting balance for you to correct — not a measurement.

**Sample data:** 64 orders and 12 customers. The storefront never transmits
orders, so there was no history to import and the dashboard would otherwise be
empty. They are flagged with a banner on the dashboard. To work without them:

```bash
SEED_DEMO_ORDERS=false npm run db:reset
```

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | Route typegen + `tsc --noEmit` |
| `npm run db:migrate` | Create/apply migrations |
| `npm run db:seed` | Load catalogue and content |
| `npm run db:reset` | Drop, re-migrate, re-seed |
| `npm run db:studio` | Prisma Studio |
| `npm run extract:storefront` | Re-read the storefront's static data into `prisma/seed/source/` |

---

## Architecture

```
src/
  app/
    (auth)/login/            sign in
    (dashboard)/             the admin shell — sidebar, topbar, command menu
      dashboard/             KPIs, revenue chart, alerts, operational tables
      products/              products · categories · sale   (tabs, one route)
      products/[id]/         the product editor
      inventory/             stock levels · movement ledger  (tabs)
      orders/                order list
      orders/[id]/           order detail, timeline, state machine
      customers/             list, detail in a sheet via ?customer=
      content/               homepage · pages · faq · footer · media · reviews
      settings/              store · account · activity · cutover
    unauthorized/            a USER-role account lands here
    api/auth/[...nextauth]/  Auth.js route handler
  features/<domain>/         queries.ts · schemas.ts · actions.ts · components/
  components/ui/             shadcn primitives, unmodified
  components/shared/         cross-feature: DataTable, PageHeader, StatusBadge, …
  components/layout/         the shell
  lib/                       db · auth · enums · money · dates · media · audit
  config/nav.ts              the navigation registry
  proxy.ts                   Next 16's renamed middleware
```

### Decisions worth knowing

**Money is an integer number of paise.** The storefront data is in rupees, so the
seeder multiplies by 100 and the public serializer will divide by 100. Everything
goes through `src/lib/money.ts`. Floats are never used for money.

**`discountPercentage` is computed, never stored.** The storefront stores both a
sale price and a percentage, and they have drifted apart.

**Statuses are `String` columns validated by Zod**, not native Postgres enums.
Order workflows gain states often enough that the migration tax is not worth the
marginal integrity, and every write path already goes through Zod.

**List state lives in the URL.** Filters, search, sort, page and tab are all query
params, so pages stay Server Components, the back button works, and any view can
be pasted to someone else.

**Authorization is layered.** `proxy.ts` does a cheap optimistic cookie check so
signed-out visitors get a login screen instead of a flash of empty shell. The
real boundary is `requireAdmin()` in `src/lib/auth/guards.ts`, which re-reads the
user row from the database on every request — so deactivating an account takes
effect immediately rather than at token expiry. Every Server Action calls
`requireAdminOrThrow()` independently.

**The stock ledger is the source of truth.** `InventoryItem.onHand` is a cached
projection; every change writes a `StockMovement` with the resulting balance in
the same transaction.

**Two roles, permanently: `ADMIN` and `USER`.** No manager, editor or moderator.

---

## Going to production

1. Move `DATABASE_URL` to a managed Postgres **in ap-south-1 (Mumbai)** — a
   us-east-1 database adds roughly 200 ms to every query for an operator in India.
   On a serverless host put the pooled connection string in `DATABASE_URL`.
2. Generate a fresh `AUTH_SECRET` (`openssl rand -base64 32`). Rotating it signs
   everyone out.
3. Change the seeded admin password, or seed with `SEED_ADMIN_PASSWORD` set.
4. Run `prisma migrate deploy` in the release step, not `migrate dev`.
5. Turn on deployment protection. The panel already sends `noindex`.
6. Configure a media storage provider before relying on uploads — the media
   library currently manages assets by URL only.
