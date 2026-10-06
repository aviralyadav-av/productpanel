# DIY Baazar Public API (`/api/v1`) — contract for the customer website

This is the read + intake API the separately built customer website consumes. It is served by the
admin platform (Next.js App Router). Everything in this document is implemented and typed in
`src/lib/serializers/public.ts` (response shapes), `src/features/storefront/queries/*.ts`
(query semantics) and `src/app/api/v1/**/route.ts` (routes). The binding source of truth is
`docs/MARKETPLACE_BLUEPRINT.md` §5.1, §5.3 and §14 (A10, D7, D11, D12, E1, E6).

## 1. Basics

| Item | Value |
|---|---|
| Base URL | `${APP_ORIGIN}/api/v1` — locally `http://localhost:3000/api/v1` |
| Format | JSON only. Success `{ "data": …, "meta"?: … }`. Error `{ "error": { "code", "message", "details"? } }` |
| Money | **Rupees** as JSON numbers (`1299`, `12.5`). The database stores paise; the API divides by 100. Field names never carry a unit suffix. |
| Dates | ISO-8601 strings in UTC (`"2026-09-08T10:15:00.000Z"`), or `null` |
| Media | `{ "url", "alt", "width", "height" }` — `url` is **absolute** (`http://localhost:3000/media/...` or the CDN URL) |
| HTML | Fields documented as *sanitised HTML* are run through the D12 allowlist sanitiser on output; render them as HTML. Everything else is plain text — escape it. |
| Slugs / ids | You navigate by **slug**; `id` is included for keys/analytics only and is never needed to build a URL |
| Encoding | Responses are UTF-8 `application/json`; `X-Content-Type-Options: nosniff` |

### CORS

- **Anonymous cacheable reads** (every `GET` in §3 without a preview token) answer `Access-Control-Allow-Origin: *`.
  They are identical for every caller, so there is nothing origin-specific to protect.
- **Everything else** (preview requests, every POST/intake endpoint, every error) echoes the request `Origin`
  only when it is in the server's `STOREFRONT_ORIGINS` allowlist (comma-separated env var; also the
  `storefront.cors_origins` setting). Ask ops to add every website origin (including preview deploys).
- Preflight: every route answers `OPTIONS` with `204` and `Access-Control-Allow-Headers: Content-Type, Authorization, X-Storefront-Key`.

### Caching

- Cacheable reads carry `Cache-Control: public, max-age=30, s-maxage=30, stale-while-revalidate=300`
  (`/seo/sitemap`: `s-maxage=300, stale-while-revalidate=3600`). Put a CDN in front; browsers cache 30 s.
- Server-side the same responses are cached per normalised query and **invalidated by tag** the moment an
  admin saves (catalog / content / nav / settings / blog / pages), with a 60 s revalidation safety net for
  scheduled changes (sale windows, banner schedules, scheduled posts). Expect a change to be visible within
  roughly a minute even without an invalidation, and immediately after an admin write once the CDN TTL passes.
- Preview responses and errors are `Cache-Control: no-store`.
- Two requests that differ only in the order of `attr[color]=red,blue` vs `blue,red` share one cache entry.

### Rate limits

- The reads in §3 are not rate-limited by the application (the CDN is the defence). The intake endpoints in
  §6 are: `POST /orders` 10/min/IP, reviews 5/h/IP, contact/newsletter 10/h/IP, uploads 20/h/IP,
  seller registration 5/h/IP (blueprint D9). A limited call returns `429` with `Retry-After`.

### Error envelope

```json
{ "error": { "code": "NOT_FOUND", "message": "Product not found.", "details": { "field": "reason" } } }
```

`code` ∈ `VALIDATION_ERROR | BAD_REQUEST | UNAUTHORIZED | FORBIDDEN | NOT_FOUND | CONFLICT | RATE_LIMITED | INTERNAL`.
Status codes: 200, 201 (create), 204 (delete/preflight), 400 (malformed), 401, 403, 404, 409, 422 (validation), 429, 500.
`details` is present on 400/422 and maps field → message. Errors are never cached and never carry `*` CORS.

## 2. URL patterns (what the website must route)

Every link the API returns is a **path on the website**, built from these patterns. Implement exactly these routes:

| Entity | Path | Example |
|---|---|---|
| Home | `/` | |
| Category (incl. descendants) | `/c/<category-path-without-leading-slash>` | `/c/fashion/kurta` |
| Product | `/p/<product-slug>` | `/p/hand-painted-ceramic-mug` |
| CMS page | `/pages/<slug>` | `/pages/return-policy` |
| Blog index / post | `/blog`, `/blog/<slug>` | `/blog/how-we-fire-our-pottery` |
| Seller shop | `/sellers/<seller-slug>` | `/sellers/kala-pottery` |

Category `path` is the materialised slug path (`/fashion/kurta`); the last segment is the category's own `slug`,
so `/c/fashion/kurta` should call `GET /categories/kurta` and `GET /products?category=kurta`.

Links are delivered as `{ "type": "NONE|URL|CATEGORY|PRODUCT|PAGE|BLOG", "url": string | null }`. `url` is
`null` when the target no longer exists or is unpublished — render the element without a link.
Navigation items additionally carry `isAvailable: false` in that case.

## 3. Read endpoints

### 3.1 `GET /categories`

Full active category tree with product counts rolled up to ancestors (only PUBLISHED products of ACTIVE
sellers are counted; counts are computed, never stored).

```json
{ "data": [
  { "id": "ck…", "slug": "fashion", "name": "Fashion", "description": null, "url": "/c/fashion",
    "image": { "url": "http://localhost:3000/media/categories/2026/09/abc.jpg", "alt": "Fashion", "width": 1200, "height": 800 },
    "icon": null, "iconName": "shirt", "banner": null, "isFeatured": true, "position": 1, "productCount": 42,
    "children": [
      { "id": "ck…", "slug": "kurta", "name": "Kurta", "url": "/c/fashion/kurta", "productCount": 17, "children": [], "…": "same fields" }
    ] }
] }
```

### 3.2 `GET /categories/:slug`

Lightweight header for a category page. 404 for unknown or inactive slugs.

```json
{ "data": {
  "category": { "id", "slug": "kurta", "name": "Kurta", "description", "url": "/c/fashion/kurta", "image", "icon", "iconName", "banner",
                "isFeatured": false, "productCount": 17,
                "seo": { "metaTitle", "metaDescription", "metaKeywords", "canonicalUrl", "ogImage": { "url", "alt", "width", "height" } | null, "noIndex": false } },
  "breadcrumb": [ { "slug": "fashion", "name": "Fashion", "url": "/c/fashion" }, { "slug": "kurta", "name": "Kurta", "url": "/c/fashion/kurta" } ],
  "children":   [ { "slug": "cotton-kurta", "name": "Cotton kurta", "url": "/c/fashion/kurta/cotton-kurta", "image", "icon", "iconName", "productCount": 9 } ],
  "filterAttributes": [ { "code": "color", "name": "Colour", "filterType": "COLOR_SWATCH", "inputType": "COLOR", "unit": null, "position": 1 },
                        { "code": "fabric", "name": "Fabric", "filterType": "CHECKBOX", "inputType": "SELECT", "unit": null, "position": 2 } ]
} }
```

`filterAttributes` tells you which filters this category *offers* (its effective attribute set); the values and
counts come from `GET /products?category=kurta&include=facets` (§3.3) — call it with the same filters the user has applied.

### 3.3 `GET /products` — the listing (blueprint §14.A10, fixed contract)

Query parameters (all optional):

| Param | Meaning |
|---|---|
| `category=<slug>` | Category **and all descendants**. Unknown slug → empty list (not 404). |
| `q=<text>` | Case-insensitive match on title, short description, brand, tag names |
| `attr[<code>]=v1,v2` | Attribute filter, OR within the attribute (`red` OR `blue`), AND across attributes. Values are the facet `value` strings. |
| `attr[<code>]=min..max` | Range filter for NUMBER attributes (`attr[weight]=100..500`, `attr[weight]=..500`) |
| `minPrice`, `maxPrice` | Rupees, applied to `effectivePrice` |
| `seller=<slug>` | One seller's products |
| `featured`, `newArrival`, `bestseller`, `trending`, `customizable` | `=true`/`=1` flags |
| `sort` | `position` (default: merchandised order, then newest) · `newest` · `price_asc` · `price_desc` · `popular` · `rating` |
| `page`, `pageSize` | 1-based; `pageSize` default 24, max 48 |
| `include=category,facets` | Add `meta.category` (the §3.2 header) and/or `meta.facets` + `meta.builtinFacets` + `meta.priceRange` |

Only PUBLISHED, non-deleted products of ACTIVE sellers (or platform-owned) in active categories are ever returned.

```json
{ "data": [
  { "id": "ck…", "slug": "hand-painted-ceramic-mug", "title": "Hand-painted ceramic mug", "url": "/p/hand-painted-ceramic-mug",
    "shortDescription": "Stoneware, 300 ml", "brand": null,
    "image": { "url": "http://localhost:3000/media/products/2026/09/mug.jpg", "alt": "Blue mug", "width": 1200, "height": 1200 },
    "price": 799, "salePrice": 649, "effectivePrice": 649, "priceFrom": 649, "priceTo": 749, "discountPercent": 19, "promotionBadge": null,
    "badges": ["sale", "new", "customizable"],
    "ratingAvg": 4.6, "reviewCount": 12,
    "seller": { "slug": "kala-pottery", "displayName": "Kala Pottery", "url": "/sellers/kala-pottery" },
    "category": { "slug": "mugs", "name": "Mugs", "url": "/c/home-living/kitchen/mugs" },
    "stockState": "in", "isCustomizable": true,
    "createdAt": "2026-09-01T09:00:00.000Z", "publishedAt": "2026-09-02T09:00:00.000Z" }
],
  "meta": {
    "page": 1, "pageSize": 24, "total": 17, "totalPages": 1, "sort": "position",
    "category": { "…": "the §3.2 category header incl. breadcrumb and children" },
    "facets": [
      { "code": "color", "name": "Colour", "filterType": "COLOR_SWATCH", "inputType": "COLOR", "unit": null, "position": 1,
        "values": [ { "value": "blue", "label": "Blue", "colorHex": "#1e40af", "count": 9 }, { "value": "red", "label": "Red", "colorHex": "#b91c1c", "count": 4 } ] },
      { "code": "weight", "name": "Weight", "filterType": "RANGE", "inputType": "NUMBER", "unit": "g", "position": 3,
        "range": { "min": 120, "max": 900, "unit": "g" } }
    ],
    "builtinFacets": {
      "availability": { "inStock": 15 },
      "customizable": { "count": 6 },
      "sellers": [ { "slug": "kala-pottery", "name": "Kala Pottery", "count": 11 } ],
      "rating": [ { "min": 4, "count": 10 }, { "min": 3, "count": 14 } ]
    },
    "priceRange": { "min": 249, "max": 4999 }
  } }
```

Card field notes:

- `price` list price; `salePrice` only while the sale window is open; `effectivePrice` is what the shopper pays
  (lowest of list / sale / active promotion — never stacked); `priceFrom`/`priceTo` span the variants
  (equal to `effectivePrice` without variants) — show "from ₹priceFrom" when they differ.
- `discountPercent` is computed from `price` vs `effectivePrice`; `promotionBadge` is the promotion's badge text when a promotion (not a sale price) produced the discount.
- `badges` ⊆ `sale | new | bestseller | trending | customizable`.
- `stockState` ∈ `in | low | out | backorder` — the best state across purchasable variants (`out` when there are none).

#### Rendering facets

Facet counts are computed against the **full current filter set** (v1 semantics): selecting a colour narrows every
other facet *and* the colour facet itself; values with a zero count are omitted unless they are currently selected.
Re-fetch `include=facets` after every filter change. Send the selection back as `attr[<code>]=<value>[,<value>]`.

| `filterType` | Render | Send |
|---|---|---|
| `CHECKBOX` | multi-select list of `values` with counts | `attr[code]=v1,v2` |
| `RADIO` | single choice list | `attr[code]=v1` |
| `COLOR_SWATCH` | swatches using `values[].colorHex` (fallback to label) | `attr[code]=v1,v2` |
| `TOGGLE` | one switch; use the value whose label reads as "yes"/"true" | `attr[code]=true` |
| `RANGE` | slider between `range.min` and `range.max` (`range.unit` for the label) | `attr[code]=min..max` (either side optional) |
| `NONE` | never appears in `facets` | |

Built-ins: `availability.inStock` → an "In stock" toggle is a client-side filter on `stockState` (no server param yet);
`customizable.count` → `customizable=true`; `sellers[]` → `seller=<slug>`; `rating[]` → `min` stars-and-up buckets
(client-side on `ratingAvg`); `priceRange` → seed the price slider and send `minPrice`/`maxPrice`.

### 3.4 `GET /products/:slug` — product detail

All card fields plus:

```json
{ "data": {
  "…": "card fields",
  "description": "<p>Sanitised HTML…</p>",
  "images": [ { "id": "ck…", "isPrimary": true, "url": "…", "alt": "…", "width": 1200, "height": 1200 } ],
  "video": "https://…/clip.mp4" ,
  "minOrderQty": 1, "maxOrderQty": null,
  "specs": [ { "code": "material", "name": "Material", "unit": null, "values": ["Stoneware"] },
             { "code": "capacity", "name": "Capacity", "unit": "ml", "values": ["300"] } ],
  "variants": [
    { "id": "ck…", "name": "Blue / Large", "sku": "MUG-BL-L", "isDefault": true,
      "price": 799, "salePrice": 649, "effectivePrice": 649, "stockState": "low",
      "options": [ { "attributeCode": "color", "attributeName": "Colour", "value": "blue", "label": "Blue", "colorHex": "#1e40af" },
                   { "attributeCode": "size", "attributeName": "Size", "value": "l", "label": "Large", "colorHex": null } ],
      "images": [ { "id", "isPrimary", "url", "alt", "width", "height" } ] }
  ],
  "variantAxes": [ { "code": "color", "name": "Colour", "values": [ { "value": "blue", "label": "Blue", "colorHex": "#1e40af" } ] },
                   { "code": "size",  "name": "Size",   "values": [ { "value": "l", "label": "Large", "colorHex": null } ] } ],
  "customizationOptions": [
    { "id": "ck…", "type": "NAME", "label": "Name to print", "helpText": "Up to 12 characters", "placeholder": "Aarav",
      "isRequired": true, "minLength": 1, "maxLength": 12, "maxFiles": null, "allowedMimeTypes": [],
      "choices": [], "priceDelta": 50 },
    { "id": "ck…", "type": "PHOTO", "label": "Your photo", "isRequired": false, "maxFiles": 1,
      "allowedMimeTypes": ["image/jpeg", "image/png"], "choices": [], "priceDelta": 0, "…": "" },
    { "id": "ck…", "type": "DESIGN_SELECT", "label": "Design", "choices": [ { "value": "floral", "label": "Floral", "priceDelta": 0, "image": "http://…/floral.png" } ], "…": "" }
  ],
  "seller": { "slug": "kala-pottery", "displayName": "Kala Pottery", "url": "/sellers/kala-pottery", "description": "…",
              "logo": {…}, "banner": {…}, "city": "Jaipur", "state": "Rajasthan", "ratingAvg": 4.7, "reviewCount": 88, "memberSince": "2025-03-01T…" },
  "category": { "id", "slug": "mugs", "name": "Mugs", "url": "/c/home-living/kitchen/mugs", "description", "image" },
  "breadcrumb": [ { "slug": "home-living", "name": "Home & Living", "url": "/c/home-living" }, { "slug": "kitchen", "…": "" }, { "slug": "mugs", "…": "" } ],
  "tags": [ { "slug": "diwali", "name": "Diwali" } ],
  "seo": { "metaTitle", "metaDescription", "metaKeywords", "canonicalUrl", "ogImage", "noIndex": false },
  "related": [ "…up to 8 product cards from the same category" ],
  "reviewsSummary": { "average": 4.6, "count": 12, "distribution": { "1": 0, "2": 0, "3": 1, "4": 3, "5": 8 } }
} }
```

- `variants` are the purchasable (active) variants; pick the one whose `options` match the shopper's
  choice on each axis of `variantAxes`. Variant prices inherit the product's when not set and follow the
  product's sale window and promotion.
- `customizationOptions.type` ∈ `TEXT | NAME | MESSAGE | ENGRAVING | PHOTO | IMAGE | DESIGN_SELECT | COLOR_SELECT | SIZE_SELECT | INSTRUCTIONS | DROPDOWN | CHECKBOX`.
  `PHOTO`/`IMAGE` answers are uploaded through `POST /uploads/customization` (§6) and referenced by token in the order.
  `priceDelta` (option and per-choice) is a per-unit surcharge in rupees; the server re-prices at checkout anyway.
- `specs` = attributes flagged "show in specs" for the category, then the product's free-form custom fields.
- Each successful non-preview request increments the product's view counter asynchronously.

### 3.5 `GET /products/:slug/reviews?page=&pageSize=`

APPROVED reviews, newest first (`pageSize` default 10, max 50). 404 when the product is not on sale.

```json
{ "data": [ { "id": "ck…", "authorName": "Priya S.", "authorLocation": "Pune", "rating": 5, "title": "Lovely glaze", "body": "…plain text…",
              "images": [ { "url", "alt", "width", "height" } ], "isVerifiedPurchase": true, "helpfulCount": 3,
              "reply": "Thank you!", "repliedAt": "2026-09-05T…", "createdAt": "2026-09-04T…",
              "product": { "slug": "hand-painted-ceramic-mug", "title": "…", "url": "/p/hand-painted-ceramic-mug" } } ],
  "meta": { "page": 1, "pageSize": 10, "total": 12, "totalPages": 2 } }
```

### 3.6 `GET /home` — homepage sections (blueprint §14.E1)

Enabled, in-schedule sections in display order. Render each by `type`; `settings` carries the section's
configuration with internal ids removed; `items` is the server-resolved content.

```json
{ "data": [
  { "key": "home.hero_slider", "type": "hero_slider", "title": "Hero", "subtitle": null, "image": null,
    "link": { "type": "NONE", "url": null }, "buttonText": null,
    "settings": { "placement": "HOME_HERO", "limit": 5, "autoplaySeconds": 6 },
    "items": [ "…banners (see 3.7)" ] },
  { "key": "home.new_arrivals", "type": "new_arrivals", "title": "New arrivals", "subtitle": "Fresh from the workshop",
    "link": { "type": "CATEGORY", "url": "/c/gifts" }, "buttonText": "View all",
    "settings": { "source": "auto", "limit": 8, "category": { "slug": "gifts", "name": "Gifts", "url": "/c/gifts" } },
    "items": [ "…product cards (3.3)" ] }
] }
```

| `type` | `items` | notable `settings` |
|---|---|---|
| `hero_slider`, `promo_banners` | banners (§3.7) from placement `HOME_HERO` / `HOME_PROMO` | `limit`, `autoplaySeconds`; `layout: grid|strip` |
| `featured_categories` | category nodes (§3.1 shape, `children: []`) | `source`, `limit` |
| `new_arrivals`, `best_sellers`, `trending`, `featured_products`, `product_collection` | product cards (§3.3) | `source`, `limit`, `category` (`{slug,name,url}` or null), `tag` |
| `seller_highlights` | seller cards (as in §3.4 `seller`) | `source`, `limit` |
| `testimonials`, `product_reviews` | reviews (§3.5 shape) | `limit`, `minRating` |
| `promo_section` | `[]` | `heading`, `text`, `buttonText`, `align`, `image` (URL), `mobileImage` (URL), `link` (`{type,url}`) |
| `newsletter` | `[]` | `heading`, `text`, `placeholder`, `buttonText` → post to `POST /newsletter/subscribe` |
| `rich_text` | `[]` | `html` (sanitised HTML) |
| `trust_badges` | `[{ id, position, image, iconName, title, text }]` | — |
| `announcement_bar` | `[{ id, position, image, text, linkUrl }]` | `rotateSeconds` |
| `footer` | `[ footer payload (§3.10) ]` | — |

Unknown `type`s may appear in future; ignore them. A section whose content failed to resolve arrives with `items: []`.

### 3.7 `GET /banners?placement=HOME_HERO`

Active banners inside their schedule for a placement (`HOME_HERO | HOME_PROMO | HOME_STRIP | CATEGORY_TOP |
SIDEBAR | POPUP | ANNOUNCEMENT | CHECKOUT`); omit `placement` for all. Unknown placement → 400.

```json
{ "data": [ { "id": "ck…", "title": "Diwali sale", "subtitle": "Up to 40% off", "placement": "HOME_HERO",
  "image": { "url", "alt", "width", "height" }, "mobileImage": {…} | null, "altText": "Diwali sale",
  "link": { "type": "CATEGORY", "url": "/c/gifts/diwali" }, "buttonText": "Shop now",
  "textColor": "#ffffff", "bgColor": "#7c2d12", "position": 0, "startsAt": "2026-10-01T…", "endsAt": "2026-11-05T…" } ] }
```

### 3.8 `GET /navigation/:menu`

`menu` ∈ `main | footer-1 | footer-2 | footer-3 | mobile` (any slug an admin creates works). Nested, active items only.

```json
{ "data": { "slug": "main", "name": "Main navigation", "items": [
  { "id": "ck…", "label": "Fashion", "type": "CATEGORY", "url": "/c/fashion", "isAvailable": true,
    "iconName": null, "badgeText": "New", "openInNewTab": false, "isMegaMenu": true,
    "children": [ { "id": "ck…", "label": "Kurta", "type": "CATEGORY", "url": "/c/fashion/kurta", "isAvailable": true, "children": [], "…": "" } ] },
  { "id": "ck…", "label": "Blog", "type": "BLOG", "url": "/blog", "isAvailable": true, "children": [], "…": "" }
] } }
```

`type` ∈ `HOME | CATEGORY | PRODUCT | PAGE | BLOG | URL`. When `isAvailable` is false the target is missing,
unpublished or inactive — hide the item or render it without a link (`url` may still carry a fallback).

### 3.9 `GET /pages/:slug`

A PUBLISHED CMS page. System pages: `about-us, contact-us, faqs, privacy-policy, terms-and-conditions,
return-policy, shipping-policy, seller-terms, seller-guidelines`.

```json
{ "data": { "id": "ck…", "slug": "return-policy", "title": "Return Policy", "url": "/pages/return-policy", "excerpt": "…",
  "content": "<h2>…sanitised HTML…</h2>", "template": "POLICY", "publishedAt": "…", "updatedAt": "…",
  "seo": { "metaTitle", "metaDescription", "metaKeywords", "canonicalUrl", "ogImage", "noIndex": false } } }
```

`template` ∈ `DEFAULT | ABOUT | CONTACT | FAQ | POLICY`. For `FAQ` render `GET /faqs` beneath the content;
for `CONTACT` render the contact form (`POST /contact`).

### 3.10 `GET /faqs`, `GET /footer`, `GET /settings`

`GET /faqs` — enabled questions grouped, groups in display order:

```json
{ "data": [ { "group": "Orders", "items": [ { "id": "ck…", "question": "How do I track my order?", "answer": "<p>…sanitised HTML…</p>", "isFeatured": true } ] } ] }
```

`GET /footer` — one call for the whole footer:

```json
{ "data": {
  "brandName": "DIY Baazar", "brandDescription": "Handmade, personalised, Indian.",
  "socialLinks": [ { "platform": "instagram", "url": "https://instagram.com/diybaazar" } ],
  "social": { "instagram": "https://instagram.com/diybaazar", "youtube": "https://…" },
  "customerService": { "heading": "Need help?", "description": "Mon–Sat 10:00–18:00 IST", "supportEmail": "help@diybaazar.in" },
  "legalLinks": [ { "label": "Privacy", "url": "/pages/privacy-policy" } ],
  "paymentIcons": ["visa", "mastercard", "upi", "rupay", "cod"],
  "appLinks": { "playStore": null, "appStore": null },
  "copyright": "© 2026 DIY Baazar",
  "menus": [ { "slug": "footer-1", "name": "Footer · Shop", "items": [ "…§3.8 items" ] }, { "slug": "footer-2", "…": "" }, { "slug": "footer-3", "…": "" } ],
  "updatedAt": "…" } }
```

`socialLinks` is the footer's own editable list; `social` is the `social.*` settings (same data, admin may use either).
The support address is deliberately named `supportEmail`.

`GET /settings` — every setting flagged public, keyed by setting key, typed (number/boolean/json parsed).
Secrets are never included. Media-id keys gain a `*_url` sibling:

```json
{ "data": { "store.name": "DIY Baazar", "store.tagline": "…", "store.logo_media_id": "ck…", "store.logo_url": "http://…/logo.png",
  "store.favicon_media_id": "", "store.favicon_url": null, "store.contact_email": "help@diybaazar.in", "store.contact_phone": "+91…",
  "store.whatsapp": "+91…", "store.address": "…", "store.currency": "INR",
  "orders.cod_enabled": true, "orders.cod_fee_paise": 4900, "orders.cod_max_paise": 500000, "orders.min_order_paise": 19900,
  "returns.enabled": true, "returns.window_days": 7, "shipping.free_above_paise": 99900, "shipping.default_estimate_days": 5,
  "marketplace.seller_registration_open": true,
  "seo.meta_title": "…", "seo.meta_description": "…", "seo.og_image_media_id": "", "seo.og_image_url": null, "seo.robots_txt": "…", "seo.sitemap_enabled": true,
  "social.facebook": "", "social.instagram": "https://…", "social.youtube": "", "social.whatsapp": "", "social.twitter": "", "social.pinterest": "" } }
```

Note the exception to the rupee rule: keys that end in `_paise` are raw settings and stay in **paise** (their
name says so). Everything without that suffix follows the rest of the API.

### 3.11 `GET /blog`, `GET /blog/:slug`

`GET /blog?category=<blog-category-slug>&tag=<tag>&q=<text>&featured=true&page=&pageSize=` (`pageSize` default 12, max 48). Published posts, newest first.

```json
{ "data": [ { "id": "ck…", "slug": "how-we-fire-our-pottery", "title": "How we fire our pottery", "url": "/blog/how-we-fire-our-pottery",
  "excerpt": "…", "featuredImage": {…}, "category": { "slug": "behind-the-craft", "name": "Behind the craft" },
  "tags": ["pottery", "makers"], "authorName": "Team DIY Baazar", "publishedAt": "…", "readingMinutes": 4, "isFeatured": false } ],
  "meta": { "page": 1, "pageSize": 12, "total": 1, "totalPages": 1,
            "categories": [ { "slug": "behind-the-craft", "name": "Behind the craft", "description": null, "postCount": 1 } ] } }
```

`GET /blog/:slug` adds `content` (sanitised HTML), `updatedAt`, `seo`, `relatedProducts` (product cards) and
`relatedCategories` (`[{ slug, name, url, image }]`).

### 3.12 `GET /sellers/:slug?page=&pageSize=&sort=`

An ACTIVE seller's public profile (exactly the D11 field list) and a page of their products (same params/limits as §3.3).

```json
{ "data": { "seller": { "slug": "kala-pottery", "displayName": "Kala Pottery", "url": "/sellers/kala-pottery", "description": "…",
                        "logo": {…}, "banner": {…}, "city": "Jaipur", "state": "Rajasthan", "ratingAvg": 4.7, "reviewCount": 88,
                        "memberSince": "2025-03-01T…", "productCount": 34 },
            "products": [ "…product cards" ] },
  "meta": { "page": 1, "pageSize": 24, "total": 34, "totalPages": 2, "sort": "position" } }
```

### 3.13 `GET /seo/sitemap`

```json
{ "data": { "generatedAt": "2026-09-08T…", "urls": [
  { "loc": "/", "lastmod": "…", "changefreq": "daily", "priority": 1 },
  { "loc": "/c/fashion", "lastmod": "…", "changefreq": "weekly", "priority": 0.7 },
  { "loc": "/p/hand-painted-ceramic-mug", "lastmod": "…", "changefreq": "daily", "priority": 0.8 },
  { "loc": "/pages/return-policy", "lastmod": "…", "changefreq": "monthly", "priority": 0.4 },
  { "loc": "/blog/how-we-fire-our-pottery", "lastmod": "…", "changefreq": "monthly", "priority": 0.5 },
  { "loc": "/sellers/kala-pottery", "lastmod": "…", "changefreq": "weekly", "priority": 0.5 } ] } }
```

`loc` is a path; prefix your origin and emit `<urlset>`. Categories/pages flagged `noIndex` are omitted.

## 4. Preview tokens (blueprint §14.E6)

When an admin clicks *Preview* on a draft product, page or blog post, the admin opens
`${storefront.base_url}/{p|pages|blog}/<slug>?preview=<token>`. Forward the `preview` query parameter unchanged
to the matching API call:

```
GET /products/<slug>?preview=<token>      GET /pages/<slug>?preview=<token>      GET /blog/<slug>?preview=<token>
```

With a valid token the API returns the row **regardless of status** (draft, scheduled, inactive seller) with
`Cache-Control: no-store` and allowlisted CORS instead of `*`. The token is bound to that one entity and
expires within an hour; an invalid, expired or foreign token yields the normal `404`. Do not cache preview
pages on your side and do not index them.

## 5. Putting it together (typical page loads)

| Website page | Calls |
|---|---|
| Home | `/home` (+ `/navigation/main`, `/footer`, `/settings` once per session) |
| Category `/c/<path>` | `/categories/<last-segment>` then `/products?category=<slug>&include=facets&…filters` |
| Search | `/products?q=…&include=facets` |
| Product `/p/<slug>` | `/products/<slug>` then `/products/<slug>/reviews?page=` |
| Seller `/sellers/<slug>` | `/sellers/<slug>?page=` |
| Blog | `/blog?page=`, `/blog/<slug>` |
| CMS page | `/pages/<slug>` (+ `/faqs` for the FAQ template) |
| sitemap.xml | `/seo/sitemap` |

## 6. Intake endpoints (arriving with the modules — blueprint §5.3, §14.C, D9, D10, E7)

The following are owned by the wave-3 module teams and are **not live yet**; shapes below are the planned
contract from the blueprint so the website can stub them. All are `no-store`, CORS-allowlisted, rate-limited,
and validate with Zod (`422 VALIDATION_ERROR` with `details`). Money in rupees unless stated.

| Endpoint | Purpose / planned shape |
|---|---|
| `POST /orders` | Checkout intake. Body `{ email, phone, customerName, shippingAddress:{ name, line1, line2?, city, state, pinCode, phone }, billingAddress?, items:[{ variantId, quantity, customization?:[{ optionId, value?, choice?, uploadToken? }] }], couponCode?, paymentMethod:'COD'\|'ONLINE', notes? }`. The server re-prices every line, validates stock and customisation, reserves stock and creates the payment record. → `201 { orderNumber, status, paymentStatus, totals:{ subtotal, discount, shipping, codFee, tax, total }, payment:{ provider, orderId, keyId }?, trackingToken }`. Limit 10/min/IP; max open orders per email and per IP per day apply. |
| `GET /orders/:number?token=` (or `?email=`) | Order tracking for "my orders": `{ orderNumber, status, paymentStatus, placedAt, items:[{ title, variant, quantity, unitPrice, customization }], totals, shippingAddress, shipments:[{ carrier, trackingNumber, trackingUrl, events:[{ status, at, note }] }], events:[…public events…] }`. Requires the `trackingToken` returned at checkout or the order email. |
| `POST /payments/:provider/verify` · `POST /payments/:provider/webhook` | **Live.** Gateway callback / webhook (Razorpay first). The website posts the browser-side success payload to `/verify` after checkout. |
| `POST /returns` | `{ orderNumber, email, orderItemId, quantity, reason, comment?, images?:[uploadToken] }` → `201 { rmaNumber, status }`. Honours `returns.enabled` / `returns.window_days`. |
| `POST /coupons/validate` | `{ code, items:[{ variantId, quantity }], email? }` → `{ valid, discount, freeShipping, message?, code }`. |
| `GET /shipping/pincode/:pin` | `{ serviceable, codAvailable, estimateDays, zone }`. |
| `POST /shipping/quote` | `{ pinCode, items:[{ variantId, quantity }] }` → `{ rates:[{ method, price, estimateDays, freeAbove? }], codFee }`. |
| `POST /products/:slug/reviews` | `{ authorName, email, rating (1–5), title?, body, images?:[uploadToken], orderNumber? }` → `201 { id, status:'PENDING' }` (moderated). 5/h/IP. |
| `POST /contact` | `{ name, email, phone?, subject, message, orderNumber? }` → `201 { id }`. 10/h/IP; may require a Turnstile token when configured. |
| `POST /newsletter/subscribe` · `GET /newsletter/unsubscribe/:token` | `{ email, source? }` → `201 { status:'SUBSCRIBED'\|'ALREADY' }`; unsubscribe by the token in the email. |
| `POST /sellers/register` · `POST /uploads/seller-document` | `{ displayName, ownerName, email, phone, password, city, state, pinCode, gstin?, pan?, description?, documents:[uploadToken] }` → `201 { status:'PENDING' }`. Gated by `marketplace.seller_registration_open`. Documents are private uploads (`multipart/form-data`, PDF/JPG/PNG ≤ 5 MB) → `{ uploadToken, expiresAt }`. |
| `POST /uploads/customization` | Shopper photo for PHOTO/IMAGE options: `multipart/form-data` image ≤ 5 MB → `201 { uploadToken, expiresAt, previewUrl? }`; pass `uploadToken` in the order line's `customization`. Tokens expire after 24 h if unused. 20/h/IP. |
| `/integration/*` | Server-to-server only, authenticated with header `X-Storefront-Key: <STOREFRONT_API_KEY>` (never call from the browser): `PUT /integration/customers { email, name, phone? }`, `PUT /integration/customers/:email/wishlist { items:[{ productId, variantId? }] }`, `PUT /integration/carts/:sessionToken { email?, items }`, `POST /integration/customers/:email/login-event`, `POST /integration/customers/verify-credentials { email, password }`, `POST /integration/customers/reset-password { token, newPassword }`. `503` when the key is not configured on the server, `401` on mismatch. |

Until an intake endpoint ships it answers `404`; feature-detect on status rather than on deploy dates.

## 7. Change log

- 2026-09-08 — initial read API: categories, products (+facets, detail, reviews), home, banners, navigation, pages, faqs, footer, settings, blog, sellers, sitemap; preview tokens for product/page/blog.
