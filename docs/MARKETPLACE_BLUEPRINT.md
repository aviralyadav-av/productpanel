# DIY Baazar Marketplace — Admin Platform Blueprint

> This document is the **contract** for the marketplace admin platform. **Section 14 (Amendments) is binding and overrides earlier sections wherever they differ.** Every module is implemented
> against it. When the code and this document disagree during implementation, the document wins
> unless a section is explicitly marked "revised". Amendments are appended in §14.

Reference marketplace: https://diybaazar.com/ — a multi-seller (artisan) marketplace for handmade,
DIY and personalised products: Home & Living, Fashion, Jewellery, Gifts, Stationery, Paintings, with
customised/personalised products (name, message, photo upload, engraving), COD + online payment,
returns, seller onboarding, and a content-rich homepage (hero sliders, category tiles, new arrivals,
bestsellers, seller highlights, testimonials, blog).

---

## 0. Decisions

| # | Decision | Why |
|---|----------|-----|
| D1 | **Extend the existing Next.js 16 app**; do not start a NestJS service. | The repo already has a hardened Next 16 + Prisma 7 + Auth.js foundation (~33K lines, typecheck clean). Route Handlers are a full REST layer; Server Actions are same-origin RPC. A second runtime doubles deploy surface for no functional gain. |
| D2 | **Three layers inside the monolith**: `app/` (UI + HTTP), `features/<domain>/service.ts` (business logic, transactional), `lib/` (infra). UI never talks to Prisma directly; pages call `queries.ts`, mutations call `service.ts` via `actions.ts` (Server Actions) **or** `app/api/admin/**` (REST). Both paths share the same service and the same permission check. | Spec §31/§34/§40: separation, no business logic in UI, server-side authorization. |
| D3 | **All admin UI lives under `/admin/*`**, login at `/admin/login`. Public storefront API at `/api/v1/*`. Admin REST API at `/api/admin/*`. | Spec §33, §35. |
| D4 | **RBAC with granular permission codes** (`products.edit`), stored in `Permission`/`RolePermission`, enforced by `requirePermission()` in every page, action and API handler. Sidebar filtering is a convenience only. | Spec §23, §28. |
| D5 | **Money = Int paise. Percentages = Int basis points (bps, 1% = 100).** Never floats. | Existing convention, avoids rounding drift in commission maths. |
| D6 | **Statuses are String columns validated by Zod enums in `src/lib/enums.ts`**; jsonb for payloads. | Existing convention; workflows gain states without migrations. |
| D7 | **Stock changes only via `applyStockMovement()`**, which writes a `StockMovement` ledger row and updates `InventoryItem` in one transaction. | Spec §11. |
| D8 | **Categories are an unbounded tree** (parentId + materialised `path` + `depth`). Products attach to any category; listings include descendants. **Filter attributes are assigned per category (inherited down the tree)**, so phones and laptops show different filters. | User's explicit requirement; spec §5. |
| D9 | **Product variants are generated from variant-defining attributes** (Size × Colour …) and each variant has its own SKU/price/stock/images. | Spec §3. |
| D10 | **Customisation options are per-product rows**; the shopper's answers are snapshotted into `OrderItem.customization` so fulfilment sees exactly what was asked. | Spec §4. |
| D11 | **Provider abstractions**: `StorageAdapter` (local disk / S3-compatible), `PaymentProvider` (COD / manual / mock gateway; Razorpay-shaped interface), `Queue` (Postgres-backed jobs + worker; Redis/BullMQ later), `Mailer` (outbox table + SMTP transport via nodemailer, console transport in dev). | Spec §9, §26, §31. |
| D12 | **Seed data is data, not code.** Categories, attribute sets, sellers, demo products, sections, menus and templates are seeded rows that the admin can freely change or delete. Nothing in `src/` hardcodes a category, product or homepage section. | Spec §5, §40. |
| D13 | **Existing Niya Bags storefront contract (`/api/v1` legacy shape) is retired.** The public API is redesigned for the marketplace. The legacy bag images stay as sample media. | The product model changes fundamentally (sellers, attributes, tree). |
| D14 | Reports export as **CSV, XLSX (exceljs) and printable HTML (browser print → PDF)**. | Spec §2, §20; avoids a heavy PDF dependency. |
| D15 | New dependencies allowed (installed once, up front): `@tiptap/react @tiptap/starter-kit @tiptap/extension-link @tiptap/extension-image @tiptap/extension-placeholder`, `exceljs`, `sharp`, `@aws-sdk/client-s3`, `nodemailer` (+types), `qrcode` (+types). Everything else stays stdlib/Prisma/zod. | Rich text, Excel export, image optimisation, S3, SMTP, 2FA QR. |

---

## 1. Module Breakdown

| Module | Folder (`src/features/…`) | Admin routes | Summary |
|---|---|---|---|
| Dashboard | `dashboard` | `/admin/dashboard` | KPIs (revenue today/week/month/total, order pipeline counts, returns, refunds, customers, sellers, products, stock, pending reviews/inquiries), charts (revenue, orders, customer growth, seller growth, product sales, category sales), top products/sellers, recent orders/customers/sellers/reviews/activity. Presets: today, yesterday, 7d, 30d, this month, last month, this year, custom. Export CSV/XLSX. |
| Products | `products` | `/admin/products`, `/new`, `/[id]` | Full editor (all §3 fields), variants matrix from attributes, images/gallery/video via media picker, SEO, tags, customisation option builder, seller assignment, attribute values per category set, bulk actions, duplicate, preview link, advanced filters. |
| Categories | `categories` | `/admin/categories`, `/new`, `/[id]` | Tree CRUD (unbounded depth), drag reorder, image/icon/banner, SEO, featured, enable/disable, commission override, attribute-set assignment (filterable/required/variant flags). |
| Attributes | `attributes` | `/admin/attributes`, `/[id]` | Attribute definitions (input type, filter type, unit, values with colour swatch), global vs category-scoped, usage counts. |
| Inventory | `inventory` | `/admin/inventory`, `?variant=` | Stock table (on hand, reserved, available), adjustments (ledger), history, alerts, bulk update (CSV), low-stock thresholds. |
| Orders | `orders` | `/admin/orders`, `/new`, `/[id]`, `/[id]/invoice` | Status tabs, list filters, detail (customer, addresses, items with variant + customisation, seller per line, money breakdown, coupon, payments, shipments/tracking, timeline, notes), state machine, manual order entry, invoice print view. |
| Shipping | `shipping` | `/admin/shipping` (tabs) | Zones, rates, free-shipping rules, pincode serviceability (CSV import), partners with tracking URL templates; shipments created from an order. |
| Payments | `payments` | `/admin/payments`, `/[id]` | Transaction list (charges/refunds, provider, method, status), record manual payment, provider configs (in Settings). |
| Returns | `returns` | `/admin/returns`, `/[id]` | RMA workflow §18, QC, pickup, refund initiation, notes, events. |
| Refunds | `refunds` | `/admin/refunds`, `/[id]` | Refund records, approve/process/complete/fail, links to payment + return. |
| Sellers | `sellers` | `/admin/sellers`, `/new`, `/[id]`, `?status=PENDING` (approvals) | Seller CRUD, workflow §6, KYC documents, bank accounts, commission override, products/orders/revenue/reviews/performance tabs, reset access. |
| Finance (commissions + payouts) | `finance` | `/admin/commissions`, `/admin/payouts`, `/[id]` | Commission rules (global/category/seller/product), earnings ledger, payout statements (generate for period), approve/process/mark paid/fail, history. |
| Customers | `customers` | `/admin/customers`, `/new`, `/[id]` | CRM list + segments (new/returning/VIP/high-value/inactive), profile tabs (addresses, orders, wishlist, reviews, returns, refunds, payments, activity), block, reset password, delete (soft). |
| Coupons | `coupons` | `/admin/coupons`, `/new`, `/[id]` | All §12 types + usage history; status derived. |
| Promotions | `promotions` | `/admin/promotions`, `/[id]` | Scheduled sale campaigns over categories/products/sellers. |
| Banners | `banners` | `/admin/banners`, `/[id]` | Placement-based banners with schedule and link targets. |
| Homepage (sections) | `content` | `/admin/homepage` | Section-based CMS (registry-driven), reorder/enable/schedule, per-section fields, blocks. |
| Navigation | `navigation` | `/admin/navigation` | Menus (main, footer columns, mobile), nested items, link types, drag reorder. |
| Pages | `pages` | `/admin/pages`, `/new`, `/[id]` | Rich-text CMS pages, SEO, draft/publish, preview. |
| Blog | `blog` | `/admin/blog`, `/new`, `/[id]`, `/categories` | Posts, categories, tags, featured image, author, SEO, related products/categories. |
| FAQs | `faqs` | `/admin/faqs` | Grouped FAQs, reorder, enable. |
| Reviews | `reviews` | `/admin/reviews` | Moderation, feature, reply, delete, images; testimonials. |
| Inquiries | `inquiries` | `/admin/inquiries`, `/[id]` | Contact inquiries, assign, reply, resolve, spam. |
| Newsletter | `newsletter` | `/admin/newsletter` | Subscribers, export, unsubscribe. |
| Reports | `reports` | `/admin/reports`, `/[report]` | 13 reports §20 with range/filters/sort/pagination/export. |
| Notifications | `notifications` | `/admin/notifications` | Center + per-user preferences. |
| Email templates | `email` | `/admin/email-templates`, `/[id]` | Editable templates with `{{variables}}`, preview with sample data, outbox viewer. |
| Media | `media` | `/admin/media` | Upload (drag-drop, validated, sharp-optimised, thumbnails), folders, search, delete, replace, metadata, picker dialog used app-wide. |
| Users | `users` | `/admin/users`, `/[id]` | Admin users, role assignment, activate/deactivate, force reset, sessions. |
| Roles | `roles` | `/admin/roles`, `/[id]` | Permission matrix editor; system roles locked. |
| Audit log | `audit` | `/admin/audit-log` | Filterable, diff viewer. |
| Settings | `settings` | `/admin/settings?tab=` | General, e-commerce (tax/orders/inventory/returns), payments (providers, test/live), email (SMTP), marketplace (registration, commission, payout), SEO (meta, sitemap, robots), social, security (2FA, sessions), account. |
| Search | `search` | `/admin/search`, ⌘K | Cross-entity search (products, orders, customers, sellers, categories, coupons, pages). |
| Public API | `storefront` | `/api/v1/**` | Read + intake endpoints the separately built customer website consumes (no storefront UI here). |

---

## 2. Information Architecture (sidebar)

```
Dashboard                         /admin/dashboard
Catalog
  Products                        /admin/products
  Categories                      /admin/categories
  Attributes                      /admin/attributes
  Inventory                       /admin/inventory
Orders
  All Orders                      /admin/orders
  Pending                         /admin/orders?status=PENDING
  Processing                      /admin/orders?status=PROCESSING
  Shipped                         /admin/orders?status=SHIPPED
  Delivered                       /admin/orders?status=DELIVERED
  Returns                         /admin/returns
  Refunds                         /admin/refunds
  Payments                        /admin/payments
  Shipping                        /admin/shipping
Marketplace
  Sellers                         /admin/sellers
  Seller Approvals                /admin/sellers?status=PENDING   (badge: pending count)
  Commissions                     /admin/commissions
  Payouts                         /admin/payouts
Customers                         /admin/customers
Marketing
  Coupons                         /admin/coupons
  Promotions                      /admin/promotions
  Banners                         /admin/banners
Content
  Homepage                        /admin/homepage
  Navigation                      /admin/navigation
  Pages                           /admin/pages
  Blog                            /admin/blog
  FAQs                            /admin/faqs
  Reviews                         /admin/reviews                  (badge: pending)
Communication
  Inquiries                       /admin/inquiries                (badge: new)
  Newsletter                      /admin/newsletter
  Email Templates                 /admin/email-templates
Reports                           /admin/reports
Notifications                     /admin/notifications            (badge: unread)
Media Library                     /admin/media
System
  Admin Users                     /admin/users
  Roles & Permissions             /admin/roles
  Audit Log                       /admin/audit-log
  Settings                        /admin/settings
```

Each nav item declares `permission` (the `*.view` code). Items the actor lacks are hidden; the route
itself still enforces the permission. Badges are computed in the shell layout in one query batch.

Header: sidebar trigger · breadcrumbs · ⌘K search · notification bell · theme · user menu.
Page: `PageHeader` (title, description, actions) → toolbar (search/filters/tabs) → `DataTable` →
`PaginationBar`. Detail pages: 2-column (main + right contextual panel) collapsing to 1 on tablet.

---

## 3. Roles & Permission Matrix

Permission codes (`group.action`). `*.view` is required to open a module.

```
dashboard.view
products.view products.create products.edit products.delete products.publish products.bulk
categories.view categories.manage
attributes.view attributes.manage
inventory.view inventory.adjust
orders.view orders.create orders.update orders.cancel orders.notes orders.ship orders.export
payments.view payments.manage
refunds.view refunds.process
returns.view returns.manage
shipping.view shipping.manage
sellers.view sellers.create sellers.edit sellers.approve sellers.suspend sellers.delete
commissions.view commissions.manage
payouts.view payouts.approve payouts.process
customers.view customers.create customers.edit customers.block customers.delete customers.reset_password
coupons.view coupons.manage
promotions.view promotions.manage
banners.view banners.manage
homepage.view homepage.manage
navigation.view navigation.manage
pages.view pages.manage pages.publish
blog.view blog.manage blog.publish
faqs.view faqs.manage
reviews.view reviews.moderate reviews.reply reviews.delete
inquiries.view inquiries.manage
newsletter.view newsletter.manage newsletter.export
reports.view reports.export
notifications.view
media.view media.upload media.delete
email_templates.view email_templates.manage
users.view users.create users.edit users.delete
roles.view roles.manage
audit.view
settings.view settings.manage
```

| Role (slug) | Grants |
|---|---|
| `super-admin` | Bypasses all checks (isSystem, cannot be deleted; at least one active super-admin must always exist). |
| `admin` | Everything except `roles.manage`, `users.delete`, `settings.manage` (payments/security groups). |
| `catalog-manager` | dashboard.view, products.*, categories.*, attributes.*, inventory.*, media.view/upload, reviews.view. |
| `order-manager` | dashboard.view, orders.*, payments.view/manage, refunds.*, returns.*, shipping.*, customers.view, inventory.view, notifications.view. |
| `seller-manager` | dashboard.view, sellers.*, commissions.view/manage, payouts.view, products.view, orders.view, reviews.view. |
| `customer-support` | dashboard.view, customers.view/edit/reset_password, orders.view/notes, returns.view/manage, refunds.view, reviews.view/moderate/reply, inquiries.*, notifications.view. |
| `content-manager` | dashboard.view, homepage.*, navigation.*, pages.*, blog.*, faqs.*, banners.*, reviews.view/moderate, media.*. |
| `finance-manager` | dashboard.view, payments.*, refunds.*, payouts.*, commissions.*, reports.*, orders.view, sellers.view. |
| `marketing-manager` | dashboard.view, coupons.*, promotions.*, banners.*, newsletter.*, homepage.view/manage, reports.view, customers.view. |

Enforcement: `requirePermission(code)` in every page (redirects to `/admin/unauthorized`),
`requirePermissionOrThrow(code)` in every Server Action, `withAdminApi({ permission })` in every
`/api/admin` handler. Super-admin short-circuits. Guards re-read user + session row per request.

---

## 4. Database Schema Plan (Prisma / PostgreSQL)

Conventions: `id String @id @default(cuid())` unless noted; `createdAt/updatedAt`; money `Int`
paise; rates `Int` bps; statuses `String` (Zod-validated); arrays use Postgres `String[]`;
soft delete via `deletedAt` where noted. Indexes listed as `idx(...)`.

### 4.1 Identity & access
- **User** (admin users): email uq, name, passwordHash, phone?, image?, roleId → Role (nullable only during migration; seed assigns), isActive, twoFactorEnabled, twoFactorSecretEnc?, forcePasswordChange, lastLoginAt, createdAt, updatedAt. idx(roleId), idx(isActive).
- **Role**: slug uq, name, description?, isSystem, createdAt, updatedAt. rel: users, permissions(RolePermission).
- **Permission**: code uq, group, label, description?. 
- **RolePermission**: roleId, permissionId, @@id([roleId, permissionId]).
- **AdminSession**: userId, tokenHash uq (sid stored in JWT), userAgent?, ip?, deviceLabel?, createdAt, lastSeenAt, expiresAt, revokedAt?. idx(userId), idx(expiresAt).
- **PasswordResetToken**: userId, tokenHash uq, expiresAt, usedAt?, createdAt.
- **LoginAttempt**: (existing) email, ip?, userAgent?, success, createdAt.
- **NotificationPreference**: userId, type, inApp Boolean, email Boolean; @@unique([userId, type]).

### 4.2 Catalog
- **Category**: slug uq, name, description?, parentId? (self, SetNull), depth Int, path String (e.g. `/home-living/woodcrafts`; idx), position, isFeatured, isActive, imageMediaId?, iconMediaId?, bannerMediaId?, iconName? (lucide/emoji), commissionBps?, metaTitle?, metaDescription?, metaKeywords?, createdAt, updatedAt. idx(parentId, position), idx(isActive). rel: children, products, categoryAttributes, commissionRules, banners, navItems.
- **Attribute**: code uq, name, description?, inputType (SELECT|MULTI_SELECT|TEXT|NUMBER|BOOLEAN|COLOR), filterType (CHECKBOX|RADIO|RANGE|COLOR_SWATCH|TOGGLE|NONE), unit?, isVariantDefining, isFilterableDefault, isGlobal, position, isActive. rel: values, categoryAttributes, productValues, variantValues.
- **AttributeValue**: attributeId, value, label?, colorHex?, position, isActive; @@unique([attributeId, value]).
- **CategoryAttribute**: categoryId, attributeId, isRequired, isFilterable, isVariant, showInSpecs, inheritToChildren (default true), position; @@unique([categoryId, attributeId]).
- **Product**: slug uq, sku? uq, title, shortDescription?, description (HTML), categoryId?, sellerId? (null = platform), brand?, status (DRAFT|PUBLISHED|ARCHIVED), publishedAt?, pricePaise, salePricePaise?, saleStartsAt?, saleEndsAt?, costPaise?, taxRateBps?, hsnCode?, weightGrams?, lengthMm?, widthMm?, heightMm?, shippingNote?, isFeatured, isNewArrival, isBestseller, isTrending, isCustomizable, minOrderQty (1), maxOrderQty?, position, ratingAvg Float, reviewCount, orderCount, viewCount, videoUrl?, videoMediaId?, metaTitle?, metaDescription?, metaKeywords?, canonicalUrl?, ogImageMediaId?, customFields Json ({} key/value), createdById?, createdAt, updatedAt, deletedAt?. idx(status, position), idx(categoryId), idx(sellerId), idx(isFeatured), idx(isNewArrival), idx(isBestseller), idx(createdAt), idx(pricePaise), GIN trigram on title (raw SQL in migration; `pg_trgm`).
- **Tag**: slug uq, name. implicit m-n with Product.
- **ProductImage**: productId, variantId?, mediaId (Restrict), alt?, position, isPrimary. idx(productId, position).
- **ProductAttributeValue**: productId, attributeId, valueId?, textValue?, numberValue Float?, boolValue?. idx(attributeId, valueId), idx(productId). @@unique([productId, attributeId, valueId]).
- **ProductVariant**: productId, name (e.g. "Red / M"), sku? uq, barcode?, pricePaise?, salePricePaise?, costPaise?, weightGrams?, position, isActive, isDefault, createdAt, updatedAt. @@unique([productId, name]).
- **VariantAttributeValue**: variantId, attributeId, valueId; @@unique([variantId, attributeId]). idx(valueId).
- **CustomizationOption**: productId, type (TEXT|NAME|MESSAGE|ENGRAVING|PHOTO|IMAGE|DESIGN_SELECT|COLOR_SELECT|SIZE_SELECT|INSTRUCTIONS|DROPDOWN|CHECKBOX), label, helpText?, placeholder?, isRequired, minLength?, maxLength?, maxFiles?, allowedMimeTypes String[], choices Json ([{value,label,priceDeltaPaise,imageUrl}]), priceDeltaPaise (0), position, isActive.

### 4.3 Inventory
- **InventoryItem**: variantId uq, onHand, reserved, lowStockThreshold (3), allowBackorder, location ("DEFAULT"), updatedAt. idx(onHand).
- **StockMovement**: variantId, delta (signed on-hand change), reservedDelta (signed, default 0), type (PURCHASE|SALE|RETURN|ADJUSTMENT|CORRECTION|DAMAGE|SEED|RESERVE|RELEASE|TRANSFER), reason?, note?, orderId?, actorId?, balance (onHand after), reservedBalance, createdAt. idx(variantId, createdAt), idx(orderId), idx(type).

### 4.4 Sellers & finance
- **Seller**: slug uq, displayName, legalName?, ownerName, email uq, phone?, passwordHash?, status (PENDING|UNDER_REVIEW|APPROVED|ACTIVE|SUSPENDED|REJECTED), description?, logoMediaId?, bannerMediaId?, addressLine1?, addressLine2?, city?, state?, pinCode?, country ("IN"), gstin?, pan?, commissionBps?, ratingAvg, reviewCount, approvedAt?, approvedById?, suspendedAt?, suspensionReason?, rejectedAt?, rejectionReason?, lastActiveAt?, createdAt, updatedAt, deletedAt?. idx(status), idx(createdAt).
- **SellerDocument**: sellerId, type (PAN|AADHAAR|GSTIN|BANK_PROOF|ADDRESS_PROOF|OTHER), label?, mediaId?, fileUrl?, status (PENDING|VERIFIED|REJECTED), note?, reviewedById?, reviewedAt?, createdAt.
- **SellerBankAccount**: sellerId, accountHolder, bankName, accountNumberEnc, accountNumberLast4, ifsc, upiId?, isPrimary, isVerified, createdAt, updatedAt.
- **CommissionRule**: scope (GLOBAL|CATEGORY|SELLER|PRODUCT), categoryId?, sellerId?, productId?, rateBps, fixedPaise (0), isActive, startsAt?, endsAt?, note?, createdAt, updatedAt. Resolution order PRODUCT → SELLER → nearest CATEGORY ancestor → GLOBAL. Exactly one active GLOBAL row seeded (10%).
- **SellerLedgerEntry**: sellerId, orderId?, orderItemId?, payoutId?, type (SALE|COMMISSION|CHARGE|REFUND_REVERSAL|ADJUSTMENT|PAYOUT), amountPaise (signed: + credit to seller), description, status (PENDING|AVAILABLE|PAID|REVERSED), availableAt?, createdAt. idx(sellerId, status), idx(orderId), idx(payoutId).
- **SellerPayout**: payoutNumber uq (PO-yyyymm-####), sellerId, periodFrom, periodTo, grossSalesPaise, commissionPaise, chargesPaise, refundsPaise, adjustmentsPaise, netPaise, status (PENDING|APPROVED|PROCESSING|PAID|FAILED|CANCELLED), method (BANK_TRANSFER|UPI|MANUAL), bankAccountId?, referenceNumber?, failureReason?, notes?, approvedById?, approvedAt?, processedAt?, paidAt?, createdById?, createdAt, updatedAt. idx(sellerId, status).

### 4.5 Customers
- **Customer**: email uq, passwordHash?, fullName?, phone?, status (ACTIVE|BLOCKED), emailVerifiedAt?, acceptsMarketing, notes?, tags String[], lastOrderAt?, lastLoginAt?, createdAt, updatedAt, deletedAt?. idx(createdAt), idx(status), idx(phone).
- **Address**: customerId, label?, fullName, phone?, line1, line2?, landmark?, city, state, pinCode, country ("IN"), type (SHIPPING|BILLING|BOTH), isDefault, createdAt, updatedAt.
- **CustomerSession**: customerId, tokenHash uq, userAgent?, ip?, expiresAt, revokedAt?, createdAt.
- **Wishlist**: customerId uq, createdAt. **WishlistItem**: wishlistId, productId, variantId?, createdAt; @@unique([wishlistId, productId, variantId]).
- **Cart**: customerId?, sessionToken? uq, status (ACTIVE|CONVERTED|ABANDONED), couponCode?, expiresAt?, createdAt, updatedAt. **CartItem**: cartId, productId, variantId?, quantity, customization Json?, createdAt, updatedAt.

### 4.6 Orders, payments, shipping, returns
- **Order**: orderNumber uq (`DB` + 5+ digit sequence from a Postgres sequence, e.g. DB10291), customerId?, guestEmail?, status (PENDING|CONFIRMED|PROCESSING|PACKED|SHIPPED|OUT_FOR_DELIVERY|DELIVERED|CANCELLED|RETURN_REQUESTED|RETURNED|REFUNDED|FAILED), paymentStatus (PENDING|AUTHORIZED|PAID|FAILED|REFUNDED|PARTIALLY_REFUNDED|CANCELLED), paymentMethod (COD|ONLINE|MANUAL), source (STOREFRONT|MANUAL|API), currency ("INR"), subtotalPaise, discountPaise (promotions/sale allocation), couponDiscountPaise, shippingPaise, codFeePaise, taxPaise, totalPaise, refundedPaise, couponId?, couponCode?, shippingRateId?, shippingMethodName?, customerNote?, placedAt, confirmedAt?, packedAt?, shippedAt?, deliveredAt?, cancelledAt?, cancelReason?, ipAddress?, userAgent?, createdAt, updatedAt. idx(status, placedAt), idx(paymentStatus), idx(customerId), idx(placedAt), idx(orderNumber).
- **OrderAddress**: orderId, type (SHIPPING|BILLING), fullName, phone, email?, line1, line2?, landmark?, city, state, pinCode, country. @@unique([orderId, type]).
- **OrderItem**: orderId, productId?, variantId?, sellerId?, titleSnapshot, variantSnapshot?, skuSnapshot?, sellerNameSnapshot?, imageUrl?, attributesSnapshot Json?, customization Json? ([{optionId,type,label,value,fileUrls[],priceDeltaPaise}]), listPricePaise, unitPricePaise, customizationPaise (0), quantity, discountPaise (0), taxRateBps (0), taxPaise (0), lineTotalPaise, commissionBps (0), commissionPaise (0), sellerPayablePaise (0), status (ACTIVE|CANCELLED|RETURNED|REFUNDED), returnedQty (0). idx(orderId), idx(productId), idx(sellerId).
- **OrderEvent**: (existing) type (STATUS_CHANGE|PAYMENT|SHIPMENT|NOTE|SYSTEM|REFUND|RETURN), fromStatus?, toStatus?, message, isInternal, metadata Json?, actorId?, createdAt.
- **OrderPayment**: orderId, provider (COD|MANUAL|MOCK|RAZORPAY|STRIPE|PAYU|PHONEPE), providerOrderId?, providerPaymentId?, method (COD|UPI|CARD|NETBANKING|WALLET|BANK_TRANSFER|CASH|OTHER), type (CHARGE|REFUND|AUTHORIZATION|CAPTURE), status (PENDING|SUCCEEDED|FAILED|CANCELLED), amountPaise, currency, failureCode?, failureMessage?, rawPayload Json?, refundId?, capturedAt?, createdAt, updatedAt. idx(orderId), idx(providerPaymentId), idx(status, createdAt).
- **ShippingPartner**: code uq, name, trackingUrlTemplate? (`{tracking}` placeholder), phone?, email?, website?, isActive, position.
- **Shipment**: orderId, shipmentNumber uq, partnerId?, carrierName?, trackingNumber?, trackingUrl?, status (PENDING|PACKED|SHIPPED|IN_TRANSIT|OUT_FOR_DELIVERY|DELIVERED|FAILED_DELIVERY|RETURNED_TO_ORIGIN|CANCELLED), weightGrams?, costPaise (0), estimatedDeliveryAt?, shippedAt?, deliveredAt?, note?, createdAt, updatedAt. **ShipmentItem**: shipmentId, orderItemId, quantity. **ShipmentEvent**: shipmentId, status, location?, message?, occurredAt, createdAt.
- **ShippingZone**: name, description?, countries String[] (["IN"]), states String[], pincodePrefixes String[], isDefault, isActive, position. **ShippingRate**: zoneId, name, method (STANDARD|EXPRESS|SAME_DAY|PICKUP), ratePaise, freeAbovePaise?, minWeightGrams?, maxWeightGrams?, minOrderPaise?, maxOrderPaise?, codAvailable, codFeePaise (0), estimatedDaysMin, estimatedDaysMax, isActive, position. **PincodeServiceability**: pincode @id, city?, state?, zoneId?, isServiceable, codAvailable, estimatedDays?, updatedAt.
- **ReturnRequest**: rmaNumber uq (RMA-######), orderId, orderItemId, customerId?, sellerId?, quantity, reason (DAMAGED|DEFECTIVE|WRONG_ITEM|NOT_AS_DESCRIBED|SIZE_ISSUE|CHANGED_MIND|LATE_DELIVERY|OTHER), reasonDetail?, imageUrls String[], status (REQUESTED|UNDER_REVIEW|APPROVED|REJECTED|PICKUP_SCHEDULED|RECEIVED|QC_PASSED|QC_FAILED|REFUND_INITIATED|REFUND_COMPLETED|CLOSED|CANCELLED), resolution (REFUND|REPLACEMENT|STORE_CREDIT), rejectionReason?, pickupScheduledAt?, pickupPartnerId?, pickupTrackingNumber?, receivedAt?, qcNote?, refundId?, handledById?, requestedAt, resolvedAt?, createdAt, updatedAt. **ReturnEvent**: returnRequestId, fromStatus?, toStatus?, message, isInternal, actorId?, createdAt.
- **Refund**: refundNumber uq (RF-######), orderId, returnRequestId?, orderPaymentId?, amountPaise, reason?, method (ORIGINAL|BANK_TRANSFER|STORE_CREDIT|MANUAL), status (PENDING|APPROVED|PROCESSING|COMPLETED|FAILED|CANCELLED), provider?, providerRefundId?, failureReason?, notes?, initiatedById?, approvedById?, processedAt?, completedAt?, createdAt, updatedAt. idx(orderId), idx(status).

### 4.7 Marketing
- **Coupon**: code uq (uppercase), name, description?, type (PERCENT|FIXED|FREE_SHIPPING), value Int (percent points or paise), maxDiscountPaise?, minOrderPaise?, appliesTo (ALL|CATEGORIES|PRODUCTS|SELLERS), categoryIds String[], productIds String[], sellerIds String[], excludedProductIds String[], firstOrderOnly, customerIds String[], usageLimit?, perCustomerLimit?, usageCount, startsAt?, endsAt?, isActive, isPublic, createdById?, createdAt, updatedAt. Derived status ACTIVE|SCHEDULED|EXPIRED|DISABLED|EXHAUSTED. **CouponUsage**: couponId, orderId, customerId?, discountPaise, createdAt; @@unique([couponId, orderId]).
- **Promotion**: name, slug uq, description?, type (SALE|FLASH_SALE|CLEARANCE), discountType (PERCENT|FIXED), value, appliesTo (ALL|CATEGORIES|PRODUCTS|SELLERS), categoryIds String[], productIds String[], sellerIds String[], badgeText?, bannerMediaId?, priority, startsAt, endsAt, isActive, createdAt, updatedAt.
- **Banner**: title, subtitle?, placement (HOME_HERO|HOME_PROMO|HOME_STRIP|CATEGORY_TOP|SIDEBAR|POPUP|ANNOUNCEMENT|CHECKOUT), mediaId?, mobileMediaId?, altText?, linkType (NONE|URL|CATEGORY|PRODUCT|PAGE|BLOG), linkUrl?, categoryId?, productId?, pageId?, buttonText?, textColor?, bgColor?, position, isActive, startsAt?, endsAt?, clickCount, impressionCount, createdAt, updatedAt.

### 4.8 Content
- **ContentSection** / **ContentBlock**: existing generic pair (registry-driven). Section fields: key uq, page, type, title, subtitle?, position, enabled, publishAt?, unpublishAt?, payload Json, draftPayload Json?. Block: sectionId, position, enabled, publishAt?, unpublishAt?, payload Json, mediaId?.
- **NavigationMenu**: slug uq (main|footer-1|footer-2|footer-3|mobile), name, description?. **NavigationItem**: menuId, parentId?, label, type (CATEGORY|PRODUCT|PAGE|BLOG|URL|HOME), url?, categoryId?, productId?, pageId?, iconName?, badgeText?, openInNewTab, isMegaMenu, position, isActive, createdAt, updatedAt.
- **CmsPage**: slug uq, title, excerpt?, content (HTML), template (DEFAULT|CONTACT|FAQ|LEGAL|ABOUT), status (DRAFT|PUBLISHED|ARCHIVED), publishedAt?, isSystem (about-us, contact-us, privacy-policy … cannot be deleted, slug locked), showInFooter, metaTitle?, metaDescription?, metaKeywords?, canonicalUrl?, ogImageMediaId?, noIndex, authorId?, createdAt, updatedAt.
- **BlogCategory**: slug uq, name, description?, position, isActive. **BlogPost**: slug uq, title, excerpt?, content (HTML), featuredImageMediaId?, categoryId?, tags String[], authorId?, authorName?, status (DRAFT|PUBLISHED|SCHEDULED|ARCHIVED), publishedAt?, readingMinutes?, viewCount, isFeatured, metaTitle?, metaDescription?, metaKeywords?, canonicalUrl?, relatedProductIds String[], relatedCategoryIds String[], createdAt, updatedAt. idx(status, publishedAt).
- **Faq**: question, answer (HTML), group, position, enabled, isFeatured, createdAt, updatedAt.
- **FooterConfig**: single row (existing shape + `paymentIcons String[]`, `appLinks Json`).
- **Review**: productId?, customerId?, sellerId?, orderItemId?, authorName, authorLocation?, rating Int?, title?, body, status (PENDING|APPROVED|REJECTED), isFeatured, isTestimonial, isVerifiedPurchase, helpfulCount, reply?, repliedAt?, repliedById?, position, createdAt, updatedAt. **ReviewImage**: reviewId, mediaId?, url, position.
- **ContactInquiry**: name, email, phone?, subject, message, type (GENERAL|ORDER|SELLER|COMPLAINT|PARTNERSHIP|OTHER), orderId?, status (NEW|OPEN|REPLIED|RESOLVED|SPAM), priority (LOW|NORMAL|HIGH), assignedToId?, resolvedAt?, createdAt, updatedAt. **InquiryReply**: inquiryId, message, authorId?, isInternal, emailSent, createdAt.
- **NewsletterSubscriber**: email uq, name?, status (SUBSCRIBED|UNSUBSCRIBED|BOUNCED), source?, unsubscribeToken uq, subscribedAt, unsubscribedAt?, createdAt.

### 4.9 Media, communication, operations
- **MediaFolder**: path uq (`products/mugs`), name, parentId?, createdAt. **MediaAsset**: url uq, storageKey?, storageProvider (local|s3|external), filename, kind (image|video|document), mimeType?, width?, height?, sizeBytes?, checksum?, alt?, folder (path string, idx), thumbnailUrl?, uploadedById?, createdAt, updatedAt. Named relations for every FK pointing at it.
- **EmailTemplate**: key uq (welcome, order_confirmation, payment_confirmation, order_shipped, order_delivered, order_cancelled, return_approved, refund_processed, seller_approved, seller_rejected, password_reset, admin_password_reset, admin_invite, contact_ack, newsletter_welcome), name, subject, htmlBody, textBody?, variables String[], isActive, updatedById?, createdAt, updatedAt.
- **EmailOutbox**: templateKey?, toEmail, toName?, subject, htmlBody, textBody?, status (QUEUED|SENDING|SENT|FAILED|CANCELLED), attempts, lastError?, providerMessageId?, scheduledAt, sentAt?, entityType?, entityId?, createdAt. idx(status, scheduledAt).
- **Job**: type, payload Json, status (PENDING|RUNNING|COMPLETED|FAILED|CANCELLED), priority (0), attempts, maxAttempts (5), runAt, lockedAt?, lockedBy?, lastError?, result Json?, createdAt, updatedAt, completedAt?. idx(status, runAt, priority).
- **Notification**: userId (per recipient), type (NEW_ORDER|ORDER_CANCELLED|PAYMENT_FAILED|NEW_SELLER|SELLER_APPROVAL_REQUIRED|LOW_STOCK|OUT_OF_STOCK|RETURN_REQUESTED|REFUND_REQUESTED|NEW_REVIEW|NEW_INQUIRY|PAYOUT_DUE|CONTENT_EXPIRING|SYSTEM), severity (info|warning|critical), title, body?, entityType?, entityId?, href?, readAt?, createdAt. idx(userId, readAt, createdAt).
- **PaymentProviderConfig**: provider uq (COD|MANUAL|MOCK|RAZORPAY|STRIPE|PAYU|PHONEPE), displayName, isEnabled, mode (TEST|LIVE), credentialsEnc Json (encrypted values), settings Json, supportedMethods String[], position, createdAt, updatedAt.
- **Setting**: (existing) key @id, value, type (string|number|boolean|json|money|secret), group, label, helpText?, isPublic (exposed via `/api/v1/settings`), updatedAt.
- **AuditLog**: (existing) actorId?, actorEmail, action, entityType, entityId?, entityLabel?, summary, diff Json?, ip?, userAgent?, createdAt. Append-only.

Sequences (raw SQL in migration): `order_number_seq START 10001`, `payout_number_seq`, `rma_number_seq`, `refund_number_seq`, `shipment_number_seq`.

### 4.10 Removed from the old schema
`User.role String` → `roleId`; `User.customer`/`Customer.userId` (customers are not admin users);
`Product.gender`; `Discount` → `Coupon`; `Order.ship*` snapshot columns → `OrderAddress` rows;
`Order.legacyDateString`.

---

## 5. API Architecture

### 5.1 Conventions (both `/api/admin` and `/api/v1`)
- JSON only. Success: `{ "data": …, "meta"?: { page, pageSize, total, totalPages } }`.
  Error: `{ "error": { "code": "VALIDATION_ERROR"|"UNAUTHORIZED"|"FORBIDDEN"|"NOT_FOUND"|"CONFLICT"|"RATE_LIMITED"|"INTERNAL", "message": string, "details"?: Record<string,string> } }`.
- Status codes: 200, 201 (create), 204 (delete), 400 (malformed), 401, 403, 404, 409, 422 (validation), 429, 500.
- Lists: `?page&pageSize(≤100)&sort&order&q` plus module filters. Money in paise on admin API; **rupees on the public API** (documented per field).
- Admin handlers are wrapped by `withAdminApi(handler, { permission })` in `src/lib/api/admin.ts`: resolves actor (session cookie), checks permission, for non-GET verifies same-origin (`Origin`/`Sec-Fetch-Site`) as CSRF defence, applies rate limits, maps thrown `ApiError`/Zod/Prisma errors to the envelope.
- Public handlers use `src/lib/api/public.ts`: `publicJson` (cache headers for GET, CORS for storefront origin), rate limiting on writes, optional customer bearer token (`CustomerSession`).
- Every mutation goes through a `features/<domain>/service.ts` function that receives `{ actor }` and performs authorization-independent business rules, transactions, audit and side effects. Server Actions and API routes are thin adapters.

### 5.2 Admin endpoints (representative; each module mirrors its actions)
```
GET    /api/admin/dashboard?range=…                     dashboard.view
GET    /api/admin/search?q=&scopes=                     (any admin)
GET|POST /api/admin/products            GET|PUT|DELETE /api/admin/products/:id
POST   /api/admin/products/:id/duplicate   PUT /api/admin/products/:id/status   POST /api/admin/products/bulk
GET|POST /api/admin/products/:id/variants   PUT|DELETE /api/admin/products/:id/variants/:variantId
GET|POST /api/admin/products/:id/images … /customizations … /attributes
GET|POST /api/admin/categories  GET|PUT|DELETE /api/admin/categories/:id  PUT /api/admin/categories/reorder  GET|PUT /api/admin/categories/:id/attributes
GET|POST /api/admin/attributes  GET|PUT|DELETE /api/admin/attributes/:id  POST /api/admin/attributes/:id/values
GET    /api/admin/inventory  POST /api/admin/inventory/adjust  POST /api/admin/inventory/bulk  GET /api/admin/inventory/:variantId/movements
GET|POST /api/admin/orders  GET /api/admin/orders/:id  PUT /api/admin/orders/:id/status  POST /api/admin/orders/:id/notes  POST /api/admin/orders/:id/shipments  PUT /api/admin/orders/:id/address
GET    /api/admin/payments  GET /api/admin/payments/:id  POST /api/admin/orders/:id/payments (manual)
GET    /api/admin/returns  GET /api/admin/returns/:id  PUT /api/admin/returns/:id/status
GET|POST /api/admin/refunds  PUT /api/admin/refunds/:id/status
GET|POST /api/admin/shipping/zones|rates|partners|pincodes  POST /api/admin/shipping/pincodes/import
GET|POST /api/admin/sellers  GET|PUT|DELETE /api/admin/sellers/:id  PUT /api/admin/sellers/:id/status  PUT /api/admin/sellers/:id/commission  POST /api/admin/sellers/:id/reset-access  GET /api/admin/sellers/:id/earnings
GET|POST /api/admin/commissions  PUT|DELETE /api/admin/commissions/:id
GET|POST /api/admin/payouts (generate)  GET /api/admin/payouts/:id  PUT /api/admin/payouts/:id/status
GET|POST /api/admin/customers  GET|PUT|DELETE /api/admin/customers/:id  PUT /api/admin/customers/:id/status  POST /api/admin/customers/:id/reset-password
GET|POST /api/admin/coupons  GET|PUT|DELETE /api/admin/coupons/:id
GET|POST /api/admin/promotions | banners | pages | blog | blog/categories | faqs | navigation/menus | navigation/items
GET|PUT /api/admin/homepage/sections  POST /api/admin/homepage/sections/reorder  … blocks
GET    /api/admin/reviews  PUT /api/admin/reviews/:id/status  POST /api/admin/reviews/:id/reply  DELETE /api/admin/reviews/:id
GET    /api/admin/inquiries  PUT /api/admin/inquiries/:id  POST /api/admin/inquiries/:id/replies
GET    /api/admin/newsletter  GET /api/admin/newsletter/export
GET    /api/admin/reports/:report?from&to&format=json|csv|xlsx
GET    /api/admin/notifications  PUT /api/admin/notifications/read  GET|PUT /api/admin/notifications/preferences
GET|POST /api/admin/media  POST /api/admin/media/upload (multipart)  PUT|DELETE /api/admin/media/:id  POST /api/admin/media/:id/replace  GET|POST /api/admin/media/folders
GET|PUT /api/admin/email-templates/:key  POST /api/admin/email-templates/:key/preview  GET /api/admin/email-outbox
GET|POST /api/admin/users  GET|PUT|DELETE /api/admin/users/:id  GET|DELETE /api/admin/users/:id/sessions
GET|POST /api/admin/roles  GET|PUT|DELETE /api/admin/roles/:id  GET /api/admin/permissions
GET    /api/admin/audit-log
GET|PUT /api/admin/settings  GET|PUT /api/admin/settings/payment-providers/:provider
POST   /api/admin/jobs/run (header X-Cron-Secret)  GET /api/admin/jobs
```

### 5.3 Public integration endpoints (`/api/v1`) — for the separately built customer website

> Scope note (user decision, 2026-09-07): the customer website is built separately. This project
> delivers **the admin dashboard and the API the website reads from**. No storefront UI and no
> customer-account endpoints (`/auth`, `/me`, wishlist/cart sync) are built here; the tables exist so
> the admin can show wishlists/carts if the website later writes them.

```
GET  /categories                       full active tree (id, slug, name, image, icon, children, productCount)
GET  /categories/:slug                 category + breadcrumb + children + facets (attributes with values & counts) + price range
GET  /products?category=&q=&attr[color]=red,blue&minPrice=&maxPrice=&sort=&page=&pageSize=&seller=&featured=&newArrival=&bestseller=&trending=
GET  /products/:slug                   detail: images, variants (+attribute values, stock state), customization options, specs, seller card, related
GET  /products/:slug/reviews           POST /products/:slug/reviews (rate-limited; lands as PENDING)
GET  /home                             enabled sections in order with resolved data (products, categories, banners)
GET  /banners?placement=
GET  /navigation/:menu
GET  /pages/:slug     GET /faqs     GET /footer     GET /settings (public keys only)
GET  /blog?category=&tag=&page=   GET /blog/:slug
GET  /sellers/:slug                    shop page: profile + products
POST /coupons/validate                 { code, items, email? } → discount
GET  /shipping/pincode/:pin            serviceability + estimate + COD
POST /shipping/quote                   { pinCode, items } → rates
POST /orders                           checkout intake (server re-prices, validates stock/customisation, reserves stock, creates payment record)
GET  /orders/:number?email=            order tracking for the website "my orders" page
POST /uploads/customization            customer photo upload (image only, ≤5 MB)
POST /returns                          return request intake { orderNumber, email, orderItemId, quantity, reason }
POST /contact    POST /newsletter/subscribe    GET /newsletter/unsubscribe/:token
POST /payments/:provider/webhook       gateway webhooks (signature verified by provider adapter)
GET  /seo/sitemap                      JSON list of public URLs for the website sitemap
```

---

## 6. Admin Route Structure

```
src/app/
  admin/
    (auth)/login  forgot-password  reset-password/[token]  two-factor
    unauthorized
    (shell)/layout.tsx                    ← requireAdmin + permission-aware sidebar + badges
      dashboard
      products/ [new, [id]]
      categories/ [new, [id]]
      attributes/ [[id]]
      inventory
      orders/ [new, [id], [id]/invoice]
      returns/ [[id]]        refunds/ [[id]]       payments/ [[id]]      shipping
      sellers/ [new, [id]]   commissions           payouts/ [[id]]
      customers/ [new, [id]]
      coupons/ [new, [id]]   promotions/ [[id]]    banners/ [[id]]
      homepage  navigation  pages/ [new, [id]]  blog/ [new, [id], categories]  faqs  reviews
      inquiries/ [[id]]  newsletter  email-templates/ [[id]]
      reports/ [[report]]  notifications  media
      users/ [[id]]  roles/ [[id]]  audit-log  settings  search
  api/
    auth/[...nextauth]
    admin/**            (see §5.2)
    v1/**               (see §5.3)
  page.tsx → redirect /admin/dashboard
```

Every list page: `loading.tsx` skeleton; shell `error.tsx`; `not-found.tsx`. List state in URL.

---

## 7. Data Flow

```
Admin UI (RSC page / client form)
   │  Server Action (same-origin)            or   REST /api/admin/* (cookie + CSRF check)
   ▼
requirePermission → Zod validate → features/<domain>/service.ts
   │  db.$transaction: business rules, ledgers, snapshots
   │  writeAudit (append-only) · notify() · queueEmail() · enqueue(job)
   ▼
PostgreSQL (single source of truth)
   ▼
revalidatePath(/admin/…)   +   public API cache (s-maxage 60, stale-while-revalidate 300)
   ▼
Customer website reads /api/v1/* → shows the change (category, product, price, banner, menu, page…)
```

Propagation examples: create category → `/api/v1/categories` includes it; assign attribute to
category → `/api/v1/categories/:slug` facets change; publish product → appears in its category and
ancestors; unpublish → removed from all public reads (status filter everywhere); change price →
`/api/v1/products/:slug` returns new price; add hero slide → `/api/v1/home` includes it; update order
status → `/api/v1/orders/:number` and `/me/orders` reflect it, email queued.

---

## 8. Component / Design-System Plan

Keep the existing tokens (neutral + one brand accent), borders over shadows, dense tables. Keep the
shadcn primitives in `components/ui`. Add/upgrade in `components/shared`:

- `DataTable` family: sortable `Th` (URL-driven), `RowCheckbox` + `BulkActionBar` (client, holds
  selection), `ColumnVisibilityMenu` (persisted per table in localStorage), sticky header, mobile
  card fallback (`MobileRow`).
- `ConfirmDialog` (destructive confirm with typed reason support), `useActionToast` (moved to shared).
- `DateRangePicker` (presets + custom, writes `?from&to&range`), `ExportButton` (format menu).
- `MoneyInput`, `PercentInput`, `SlugInput` (auto from title, editable), `TagInput`, `KeyValueEditor`.
- `RichTextEditor` (tiptap; toolbar: headings, bold, italic, lists, link, image via media picker, quote, code).
- `MediaPicker` (dialog: browse folders, search, upload, select one/many) + `MediaThumb`.
- `EntityPicker` (async combobox for product/category/seller/page/customer search via `/api/admin/search`).
- `TreeView` (drag-drop reorder with dnd-kit, used by categories and navigation).
- `StatusTimeline` (vertical event list), `StatCard` (existing), `Panel` (existing), `EmptyState`, `ErrorState`.
- `FormSection` / `FormRow` layout helpers, `FieldError`.
- `PermissionGate` (client, hides UI when actor lacks permission; server still enforces).
- Charts: `components/charts/*` on recharts, dataviz palette from `--chart-*` tokens.

---

## 9. Implementation Phases

| Wave | Scope | Parallelism |
|---|---|---|
| 0 | This blueprint; adversarial critique; dependency install. | — |
| 1 | **Schema**: full Prisma schema (§4), migration with sequences + pg_trgm, `enums.ts`, `permissions.ts`, regenerate client, fix all existing code to compile, minimal seed (roles, permissions, super-admin, settings, GLOBAL commission, email templates, menus, system pages). | 1 agent (critical path) |
| 2 | **Shell**: `/admin` route move, RBAC guards + sessions, nav registry + permission-aware sidebar + badges, login/forgot/reset/2FA pages, proxy, breadcrumbs, `/api/admin` plumbing, global search. **Shared components** (§8). **Infra**: storage, upload API, queue + worker, email outbox + templates renderer + mailer, rate limiting, crypto, payments abstraction, notifications service, inventory service, finance service skeleton, export helpers. **Media library** (page + picker). **Seed**: full DIY Baazar demo dataset. | 5 agents |
| 3 | Modules (§1) in parallel, each owning only its `features/<x>`, `app/admin/(shell)/<x>`, `app/api/admin/<x>` files. Frozen: schema, enums, permissions, nav, shared components, lib. Schema gaps are reported, not patched. | ≤6 concurrent, ~17 agents |
| 3.5 | Apply reported schema/nav gaps; re-typecheck; fix cross-module compile errors. | 1–3 agents |
| 4 | Verification: typecheck, lint, `next build`, `db:reset`, authenticated smoke test over every route + API; adversarial review per module (correctness, permissions, transactions, XSS); fix rounds; docs + README. | workflows |

Rules for wave-3 agents: never run `prisma migrate/generate/db push/seed` or `next dev`; verify with
`npx next typegen && npx tsc --noEmit` and `npx eslint <own files>`; report `schemaRequests`,
`navRequests`, `seedRequests` in the final output.

---

## 10. Cross-Module Service Contracts (fixed signatures)

```ts
// src/lib/auth/guards.ts
type Actor = { id; email; name; image; roleSlug; roleName; permissions: ReadonlySet<string>; isSuperAdmin; sessionId }
getActor(): Promise<Actor|null>; requireAdmin(); requireAdminOrThrow();
requirePermission(code: string | string[]): Promise<Actor>            // pages → redirect
requirePermissionOrThrow(code: string | string[]): Promise<Actor>     // actions/API → forbidden()
can(actor: Actor, code: string): boolean

// src/lib/api/admin.ts
withAdminApi(handler: (ctx: { req; actor; params; searchParams }) => Promise<Response>, opts: { permission?: string|string[]; rateLimit?: {limit, windowMs} })
apiOk(data, init?), apiCreated(data), apiNoContent(), apiList(rows, meta), ApiError(status, code, message, details?)
parseListQuery(searchParams, opts) → ListParams

// src/features/inventory/service.ts
applyStockMovement(tx, { variantId, delta, reservedDelta?, type, reason?, note?, orderId?, actorId?, allowNegative? }) → { onHand, reserved }
reserveStock(tx, { variantId, quantity, orderId, actorId? }); releaseStock(tx, {...}); commitReservation(tx, {...})  // reserve→sale
afterStockChange(variantId) → low/out-of-stock notifications (called outside tx)

// src/features/finance/service.ts
resolveCommission({ productId, sellerId, categoryId }) → { rateBps, fixedPaise, ruleId, scope }
computeOrderItemFinancials({ unitPricePaise, customizationPaise, quantity, discountPaise, taxRateBps, commission }) → { lineTotalPaise, taxPaise, commissionPaise, sellerPayablePaise }
recordEarningsForOrder(tx, orderId, actorId?)      // on DELIVERED: SALE + COMMISSION entries, PENDING until availableAt
reverseEarningsForRefund(tx, refundId)              // REFUND_REVERSAL entries
markEarningsAvailable()                             // job: PENDING → AVAILABLE when availableAt passed

// src/features/notifications/service.ts
notify({ type, severity?, title, body?, href?, entityType?, entityId?, permission? }) → creates per-user rows by preference; queues email where enabled

// src/features/email/service.ts
queueEmail({ templateKey, to: { email, name? }, vars: Record<string, string|number>, entity?: { type, id } })
renderTemplate({ subject, htmlBody, textBody }, vars) → { subject, html, text }    // {{var}} substitution, HTML-escaped

// src/lib/queue/index.ts
enqueue(type, payload, { runAt?, priority?, maxAttempts? }); registerJobHandler(type, fn); runPendingJobs({ limit, workerId })
// job types: email.send, earnings.mark_available, stock.check_low, report.export, promotions.expire, content.expire, payout.generate

// src/lib/storage/index.ts
storage.put({ key, body: Buffer, contentType }) → { url, key }; storage.delete(key); storage.publicUrl(key)

// src/lib/payments/index.ts
interface PaymentProvider { code; createPayment(order) ; verifyWebhook(req) ; capture(paymentId) ; refund({ payment, amountPaise, reason }) → { providerRefundId, status } }
getPaymentProvider(code) ; listEnabledProviders()

// src/features/orders/service.ts
transitionOrder({ orderId, toStatus, actor, reason?, note? })   // state machine + inventory + ledger + notify + email, in one tx
createManualOrder(input, actor) ; createStorefrontOrder(input)   // shared pricing/validation core
```

Order state machine: PENDING→CONFIRMED|CANCELLED|FAILED; CONFIRMED→PROCESSING|CANCELLED;
PROCESSING→PACKED|CANCELLED; PACKED→SHIPPED|CANCELLED; SHIPPED→OUT_FOR_DELIVERY|DELIVERED|RETURNED;
OUT_FOR_DELIVERY→DELIVERED|SHIPPED(failed attempt)|RETURNED; DELIVERED→RETURN_REQUESTED;
RETURN_REQUESTED→RETURNED|DELIVERED(rejected); RETURNED→REFUNDED; CANCELLED/REFUNDED/FAILED terminal.
Side effects: PENDING (created) reserves stock; CONFIRMED commits reservation to SALE; CANCELLED before
SHIPPED releases/restocks; RETURNED restocks (QC_PASSED) via return flow; DELIVERED records seller
earnings; REFUNDED writes reversal entries.

Return flow: REQUESTED→UNDER_REVIEW→APPROVED|REJECTED; APPROVED→PICKUP_SCHEDULED→RECEIVED→QC_PASSED|QC_FAILED;
QC_PASSED→REFUND_INITIATED (creates Refund)→REFUND_COMPLETED→CLOSED; QC_FAILED→CLOSED; any→CANCELLED (by customer before pickup).

Payout flow: generate statement for seller/period from AVAILABLE ledger entries not yet paid →
PENDING→APPROVED→PROCESSING→PAID (entries → PAID, PAYOUT entry) | FAILED (entries back to AVAILABLE).

Commission maths per item: `sellerGross = lineTotal − tax`; `commission = round(sellerGross × rateBps/10000) + fixedPaise`;
`sellerPayable = sellerGross − commission`. Coupon discount funded by platform unless coupon.appliesTo=SELLERS (then allocated to that seller's lines).

---

## 11. Edge Cases (must be handled)

1. Deleting a category with children/products: block unless `?reassignTo=` provided; never orphan silently.
2. Moving a category under its own descendant: reject (cycle). Recompute `path`/`depth` for subtree in one tx.
3. Removing an attribute from a category that has products with values: keep values, hide filter; warn with counts.
4. Changing variant-defining attributes after variants exist: block until variants are removed or remapped.
5. Product publish requires: ≥1 image, price > 0, category set, required category attributes filled, seller ACTIVE (or platform), ≥1 active variant with inventory row.
6. Sale price ≥ price: reject. Sale window end < start: reject. Promotion + sale: lowest wins, never stack.
7. Stock can't go negative unless `allowBackorder`; reservations release on cancel/failed payment/expiry job.
8. Order re-pricing server-side; client totals ignored; coupon re-validated at checkout under the same rules as `/coupons/validate`; usage counted in the order tx with `@@unique([couponId, orderId])`.
9. Customisation validation: required options, min/max length, allowed choices, file mime/size; snapshot everything into `OrderItem.customization`.
10. Order number/ RMA / refund / payout numbers from Postgres sequences (no collisions under concurrency).
11. Refund total cannot exceed paid − already refunded; partial refunds accumulate; payment status derived (PARTIALLY_REFUNDED vs REFUNDED).
12. Refund on a COD order: method must be BANK_TRANSFER/STORE_CREDIT/MANUAL (no original payment).
13. Seller suspension: products become invisible publicly (status filter includes seller.status ACTIVE or null); existing orders still fulfil.
14. Deleting a seller with products/orders: soft delete only; block hard delete.
15. Payout can only include AVAILABLE entries; a refund after payout creates a negative entry carried into the next statement (net may be negative → held).
16. Last super-admin cannot be deactivated/demoted/deleted; a user cannot change their own role; role with users cannot be deleted; system roles locked.
17. Session revocation takes effect on next request (guards check `AdminSession.revokedAt`); password change revokes other sessions.
18. Password reset tokens single-use, 30 min TTL, hashed at rest; identical response whether email exists.
19. Login lockout per email and per IP; 2FA challenge after password when enabled; recovery via super-admin reset.
20. Upload: validate mime by magic bytes (sharp for images), cap size (images 10 MB, video 100 MB), strip EXIF, generate thumbnail, randomised storage key, never trust filename.
21. Rich text sanitised server-side (allowlist) before storage and again on public output.
22. Media asset in use (product image, banner, category) cannot be deleted; show usage.
23. Slug uniqueness per entity; auto-suffix on duplicate for create, explicit error on edit.
24. CMS system pages: slug locked, cannot delete, can unpublish with warning.
25. Navigation item pointing to a deleted/unpublished target: rendered inactive publicly, flagged in admin.
26. Homepage section outside its publish window: excluded from `/home`; admin shows "scheduled/expired".
27. Timezone: all bucketing in IST (existing helpers); date filters accept `YYYY-MM-DD` interpreted as IST days.
28. Reports/exports stream rows in pages (≤ 5,000 per file chunk) and never `findMany()` without `take`.
29. Concurrency on stock: `SELECT … FOR UPDATE` semantics via `tx.$queryRaw` on InventoryItem row inside the movement tx.
30. Emails/jobs are idempotent (job id + entity keys); failures retry with backoff; dead-letter after maxAttempts.
31. Public API never leaks: cost price, internal notes, seller bank/KYC, customer PII of other customers, draft content.
32. Guest checkout creates/links Customer by email but never exposes another customer's history without the token.
33. Bulk actions capped (≤ 500 ids) and run in a single tx with a summary result.
34. Soft-deleted products keep order history; slugs of soft-deleted items are freed by suffixing `-deleted-<ts>`.

---

## 12. Seed Dataset (data, all editable)

- Roles + permissions (§3); super-admin `admin@diybaazar.local` / env password; one user per role for testing.
- Settings: store name "DIY Baazar", currency INR, timezone Asia/Kolkata, tax default 0 bps (handmade, GST-exempt threshold) with `tax.prices_include_tax=true`, free shipping above ₹999, COD enabled with ₹49 fee, return window 7 days, seller registration open, hold period 7 days after delivery, payout cycle weekly.
- Categories: the taxonomy from the brief (Home & Living, Fashion, Jewellery, Gifts, Stationery, Paintings and their children) plus example third-level nodes (Fashion → Kurta → Men's/Women's) to prove depth.
- Attributes: Colour (swatch), Material, Size, Pattern, Occasion, Style, Weight (range), Dimensions, Fabric, Painting medium, Frame type, Personalisable (toggle)… and per-category assignments so Jewellery filters (Material, Colour, Occasion) differ from Paintings (Medium, Size, Frame) and Fashion (Size, Fabric, Colour, Pattern).
- Sellers: 8 artisans across statuses (5 ACTIVE, 1 PENDING, 1 UNDER_REVIEW, 1 SUSPENDED) with documents and bank accounts (masked).
- Products: ~60 across categories with variants, images (local SVG placeholders generated by the seed under `public/uploads/demo/` + the legacy bag photos for Fashion → Bags), attribute values, 10+ customisable products with options, tags, SEO.
- Inventory opening balances via SEED movements; a few low/out-of-stock.
- Customers: 40 with addresses, wishlists; Orders: ~150 across 90 days in all statuses with payments, shipments, events, customisation snapshots, coupons; returns: 10; refunds: 6; ledger + one paid payout + one pending.
- Coupons (all types), 2 promotions, banners for each placement, homepage sections (hero slider, categories, new arrivals, bestsellers, trending, featured, seller highlights, testimonials, promo, newsletter, trust badges), navigation menus (main + 3 footer + mobile), system CMS pages, blog categories + 6 posts, FAQs, reviews (pending/approved/featured), inquiries, newsletter subscribers, email templates, notifications.

Demo rows are flagged by a `SEED_DEMO_DATA=true` guard and a dashboard banner.

---

## 13. Ownership Map for Implementation Agents

| Area | Owner | Files |
|---|---|---|
| Schema & enums & permissions | wave 1 | `prisma/schema.prisma`, `prisma/migrations/**`, `src/lib/enums.ts`, `src/lib/permissions.ts`, minimal `prisma/seed.ts` |
| Shell & auth & API plumbing & search | wave 2 shell | `src/app/admin/**` (move), `src/app/page.tsx`, `src/proxy.ts`, `src/config/nav.ts`, `src/lib/auth/**`, `src/lib/api/**`, `src/components/layout/**`, `src/features/search/**`, `src/features/users|roles|audit` (basic) |
| Shared components | wave 2 components | `src/components/shared/**`, `src/components/charts/**`, `src/components/ui/**` (additions only) |
| Infra libs + services | wave 2 infra | `src/lib/{storage,queue,email,crypto,rate-limit,payments,export,sanitize}/**`, `src/features/{notifications,email,inventory,finance}/service.ts`, `scripts/worker.ts`, `src/app/api/admin/jobs/**`, `src/app/api/v1/payments/**` |
| Media library | wave 2 media | `src/features/media/**`, `src/app/admin/(shell)/media/**`, `src/app/api/admin/media/**`, `src/components/shared/media-picker.tsx` |
| Seed | wave 2 seed | `prisma/seed.ts`, `prisma/seed/**`, `public/uploads/demo/**` |
| Each module | wave 3 | `src/features/<x>/**`, `src/app/admin/(shell)/<x>/**`, `src/app/api/admin/<x>/**`; public API agent owns `src/app/api/v1/**`, `src/lib/serializers/**`, `src/features/storefront/**` |

---

## 14. Amendments (adopted after adversarial review — BINDING; override earlier sections where they conflict)

### 14.A Catalog: categories, attributes, filters, variants, pricing (the client's core requirement)

- **A1 Effective attribute set.** `src/features/catalog/attribute-resolution.ts` (wave 2a, shared):
  `resolveCategoryAttributes(categoryId, tx?) → EffectiveAttribute[]`. Walk ancestors root→leaf using
  `Category.path`. Start with every `Attribute.isGlobal && isActive` as a pseudo-row (`source:'global'`).
  At each level add that category's `CategoryAttribute` rows where the level is the target itself OR
  `inheritToChildren=true`; a deeper row with the same attributeId fully replaces the shallower one.
  `CategoryAttribute.isExcluded Boolean @default(false)`: an excluded row removes the attribute from that
  category and its descendants. Result rows:
  `{ attribute, values[], source:'own'|'inherited'|'global', sourceCategoryId, isRequired, isFilterable, isVariant, showInSpecs, position }`.
  Product editor, publish validation, facet builder and the admin category page ALL call this function.
- **A2 Admin category UX.** The category Attributes tab lists the effective set with a Source column
  (Own / Inherited from <link> / Global), inline toggles that create an override row on first change, an
  Exclude action, and a "Preview storefront filters" panel that calls the same facet builder. The Attributes
  module shows usage (own category rows, products with values, variants) and blocks delete while any usage exists.
- **A3 Denormalised facet + path columns on Product** (service-maintained, never edited by hand):
  `facetValueIds String[]` (GIN) = union of `ProductAttributeValue.valueId` and `VariantAttributeValue.valueId`
  of variants that are `isActive` and (available > 0 or allowBackorder), restricted to attributes in the
  product's effective set; `categoryPath String` (copy of Category.path) + `@@index([categoryPath])`.
  `recomputeProductFacets(productId, tx)` is called by product/variant/attribute-value services, by attribute
  removal (§11.3), by category change (A6) and by `afterStockChange` when a variant crosses zero.
  Filtering: `attr[<code>]=v1,v2` → OR within an attribute (`hasSome` on valueIds), AND across attributes;
  RANGE attributes use `attr[weight]=100..500` against `ProductAttributeValue.numberValue`.
- **A4 Effective price columns on Product**: `effectivePricePaise Int`, `minVariantPricePaise Int`,
  `maxVariantPricePaise Int`, `activePromotionId String?` (→ Promotion, SetNull, "ProductActivePromotion"),
  `promotionPricePaise Int?`, `pricingRecomputedAt DateTime`. `recomputeProductPricing({ productIds | promotionId | categoryId }, tx)`
  in `src/features/catalog/pricing.ts` (wave 2a) runs on product/variant/promotion save and from the
  `pricing.refresh` job at every sale/promotion boundary. Lowest of sale price / promotion wins, never stack.
  `minPrice/maxPrice/sort=price/priceRange` all use `effectivePricePaise`. Index `@@index([status, effectivePricePaise])`.
- **A5 Variant generation.** `POST /api/admin/products/:id/variants/generate { axes:[{ attributeId, valueIds[] }] }`
  and `generateVariants(tx, { productId, axes, actorId }) → { created, kept, deactivated }`. Cartesian product;
  `ProductVariant.optionKey String?` = sorted `attributeId:valueId` joined by `|`, `@@unique([productId, optionKey])`;
  upsert by key (existing variants keep SKU/price/stock/images); combinations no longer present →
  `isActive=false` (never deleted while orders reference them); new variants get InventoryItem + SEED movement;
  name = value labels joined by " / ". Axes may only use attributes with inputType SELECT or COLOR and
  `isVariant=true` in the effective set.
- **A6 Product category change.** Service keeps all values/variants, returns `orphanAttributes[]` and
  `missingRequired[]`; editor shows "Attributes not in <category>" with per-attribute Remove; publish
  validation uses the new effective set; facets recomputed. Re-parenting a category enqueues
  `catalog.recompute_subtree` for all products under it.
- **A7 Bulk operations.** `POST /api/admin/products/bulk { ids (≤500), op }` with ops
  `DELETE | PUBLISH | UNPUBLISH | ARCHIVE | SET_CATEGORY{categoryId} | ADJUST_PRICE{mode:PERCENT|FIXED|SET,value} | SET_STOCK{onHand,reason} | SET_ATTRIBUTE{attributeId, valueId|textValue|numberValue|boolValue, mode:set|add|remove} | SET_FLAGS{isFeatured?,isNewArrival?,isBestseller?,isTrending?}`
  (one tx, summary result; SET_STOCK via `applyStockMovement`, needs `inventory.adjust`). Also
  `GET /api/admin/products/attributes/export?category=` / `POST /api/admin/products/attributes/import`
  (CSV columns = effective attribute codes; unknown values reported, created only with `createValues=true`).
  Product list filters: `?category=&includeDescendants=1&seller=&status=&stock=in|low|out&minPrice=&maxPrice=&from=&to=&featured=&newArrival=&bestseller=&trending=&customizable=&q=`.
- **A8 ProductAttributeValue uniqueness**: add `valueKey String` (= valueId for select types, `"_"` for scalar
  types) and `@@unique([productId, attributeId, valueKey])`; index `@@index([attributeId, valueId, productId])`.
  On every variant save the service rewrites the product's rows derived from variants (`fromVariants=true`),
  so filters/facets read only ProductAttributeValue (+ the A3 array for speed).
- **A9 Category & SKU**: `Category.parentId` → `onDelete: Restrict`; `path String @unique` (slug-based; a slug
  change recomputes `path` + `Product.categoryPath` for the subtree in one tx); add `canonicalUrl?`,
  `ogImageMediaId?`, `noIndex Boolean`; remove `commissionBps` (B3). `Product.categoryId` → `onDelete: Restrict`.
  `Product.baseSku String?` (non-unique prefix); SKU uniqueness only on `ProductVariant.sku`. Category
  `productCount` is never stored: one `groupBy(categoryId)` over eligible products rolled up in memory along `path`.
- **A10 Public facet payload (fixed contract for the website)**:
  ```
  GET /api/v1/products?category=<slug>&include=category,facets&attr[color]=red,blue&attr[weight]=100..500
      &minPrice=&maxPrice=&sort=newest|price_asc|price_desc|popular|rating&page=&pageSize=
  → { data: PublicProduct[],
      meta: { page, pageSize, total, totalPages,
        category?: { id, slug, name, description, image, banner, breadcrumb:[{slug,name}],
                     children:[{slug,name,image,icon,productCount}] },
        facets?: [{ code, name, filterType:'CHECKBOX'|'RADIO'|'RANGE'|'COLOR_SWATCH'|'TOGGLE', inputType, unit, position,
                    values?: [{ value, label, colorHex, count }], range?: { min, max, unit } }],
        builtinFacets?: { availability:{ inStock }, customizable:{ count }, sellers:[{ slug, name, count }], rating:[{ min, count }] },
        priceRange?: { min, max } } }            // money in rupees
  ```
  Facet counts are computed against the full current `where` (v1). Values with count 0 omitted unless selected.
  `category` matches slug and includes descendants. `GET /categories/:slug` stays a lightweight header endpoint.
  `specs` on `/products/:slug` = `[{ code, name, unit, values:[label] }]` from `showInSpecs`. `PublicProduct`
  exposes `price, salePrice, effectivePrice, priceFrom, priceTo` (rupees) and `badges`.
- **A11** Built-in facet `customizable` replaces the seeded "Personalisable" attribute (drop it from §12).

### 14.B Money, commission, ledger, payouts (canonical formulas — unit-test fixture required)

- **B1 Line & order formulas** (integer paise; `roundHalfUp(a×b/10000) = floor((a*b + 5000)/10000)`):
  ```
  customizationPaise    = Σ selected option priceDeltaPaise (PER UNIT)
  lineGross             = (unitPricePaise + customizationPaise) × quantity
  item.discountPaise    = sellerFundedDiscountPaise + platformFundedDiscountPaise   (promotion + coupon allocations)
  lineNet               = lineGross − item.discountPaise
  inclusive (pricesIncludeTax=true):  taxPaise = roundHalfUp(lineNet × r / (10000 + r)); lineTotalPaise = lineNet
  exclusive:                          taxPaise = roundHalfUp(lineNet × r / 10000);        lineTotalPaise = lineNet + taxPaise
  Order.subtotalPaise        = Σ lineGross
  Order.discountPaise        = Σ promotion allocations            (sale-price savings Σ(list−unit)×qty are reporting-only)
  Order.couponDiscountPaise  = Σ coupon allocations (FREE_SHIPPING: = shippingPaise, no line allocation)
  Order.taxPaise             = Σ item.taxPaise
  Order.totalPaise           = Σ lineTotalPaise + shippingPaise + codFeePaise − (FREE_SHIPPING ? shippingPaise : 0)
  ```
  Shipping and COD fee carry no tax line and are platform revenue. Snapshot `Order.pricesIncludeTax Boolean`
  and `Order.taxRemittedBy ('SELLER'|'PLATFORM')` from settings at placement.
  Reference vector (unit test `src/features/finance/math.test.ts`, run with `tsx --test`): lines
  200000/55000/33300 at 12%/5%/12% inclusive, PERCENT coupon 10% capped ₹250 → allocations [17343, 4769, 2888]
  (largest-remainder), nets 182657/50231/30412, taxes 19570/2392/3258, taxPaise 25220, total 263300 + COD 4900 = 268200.
- **B2 Allocation**: `allocate(amount, weights[])` = floor shares + remainder one paisa at a time to the largest
  fractional remainders (tie → lowest line position). Weights = lineGross of ELIGIBLE lines only (scope minus
  excludedProductIds). PERCENT computed on eligible subtotal then capped by `maxDiscountPaise`; FIXED capped at
  eligible subtotal. Promotion allocation first (per line), coupon second on (lineGross − promotion).
- **B3 Commission — single source of truth**: `CommissionRule` only (remove `Category.commissionBps`,
  `Seller.commissionBps`). `targetKey String @unique` = `GLOBAL` | `CATEGORY:<id>` | `SELLER:<id>` | `PRODUCT:<id>`.
  Resolution order PRODUCT → SELLER → nearest CATEGORY ancestor → GLOBAL (a seller-wide rule beats a category
  rule — intended). Resolved in the order tx and snapshotted: `OrderItem.commissionBps`, `commissionFixedPaise`,
  `commissionRuleId?`. Ledger uses snapshots, never re-resolves. `fixedPaise` is PER UNIT.
  ```
  sellerBaseGross  = lineGross − sellerFundedDiscountPaise
  taxOnSellerBase  = pricesIncludeTax ? roundHalfUp(sellerBaseGross × r / (10000 + r)) : 0
  taxableValue     = sellerBaseGross − taxOnSellerBase
  commissionPaise  = roundHalfUp(taxableValue × rateBps / 10000) + fixedPaise × quantity
  chargesPaise     = Σ charge rules from setting marketplace.charges
                     [{ code, label, type: PERCENT_OF_GROSS|FIXED_PER_ITEM|FIXED_PER_ORDER, valueBps|valuePaise, appliesWhen: ALWAYS|ONLINE_PAYMENT|COD }]
  taxRemittedBy=SELLER (default): sellerGross = sellerBaseGross;  sellerPayable = sellerGross − commission − charges
  taxRemittedBy=PLATFORM:         sellerGross = taxableValue;     sellerPayable = sellerGross − commission − charges
  platformFundedDiscountPaise is absorbed by the platform (marketing cost). Items with sellerId null: no ledger rows, commission 0.
  ```
  `Coupon.fundedBy` and `Promotion.fundedBy` (`PLATFORM|SELLER`; coupon default PLATFORM, promotion admin-chosen).
  Sale-price savings are seller-funded by construction. Add `OrderItem.chargesPaise`, `sellerFundedDiscountPaise`,
  `platformFundedDiscountPaise`.
- **B4 Ledger**: types `SALE(+) COMMISSION(−) CHARGE(−) PAYOUT(−) ADJUSTMENT(±) REFUND_REVERSAL(±) COMMISSION_TAX(−, reserved)`;
  statuses `PENDING|AVAILABLE|SCHEDULED|PAID|REVERSED` (REVERSED only for admin-voided ADJUSTMENT). Never mutate
  SALE/COMMISSION rows; always append. `orderItemId` non-null for SALE/COMMISSION/CHARGE; `@@unique([orderItemId, type])`
  for those three; `@@index([sellerId, status, availableAt])`. Earnings are recorded per delivered shipment:
  `recordEarningsForDeliveredItems(tx, shipmentId)` (replaces `recordEarningsForOrder`),
  `availableAt = deliveredAt + settings.marketplace.payout_hold_days`. `reverseEarningsForRefund(tx, refundId)`
  (on Refund COMPLETED only): per affected item `REFUND_REVERSAL −round(sellerGross × k/n)` and
  `+round(commission × k/n)` (final unit = total − already reversed), status AVAILABLE, availableAt now; appended
  even if originals are PENDING/SCHEDULED. `markEarningsAvailable`: `PENDING→AVAILABLE where availableAt ≤ now AND no open ReturnRequest for that orderItemId`.
  `SellerBalance` projection (sellerId uq, pendingPaise, availablePaise, scheduledPaise, paidPaise) updated in the
  same tx as every ledger write.
- **B5 Payouts**: `generate(sellerId, periodTo)` in one tx: `updateMany({ where:{ sellerId, status:'AVAILABLE', payoutId:null, availableAt:{ lte } }, data:{ status:'SCHEDULED', payoutId } })`
  then read back scheduled rows for totals; partial unique index (raw SQL) `ON "SellerPayout"("sellerId") WHERE status IN ('PENDING','APPROVED','PROCESSING')`
  → a second open statement is 409. If `net ≤ settings.marketplace.min_payout_paise` (incl. ≤ 0) no statement is
  created; entries stay AVAILABLE and carry forward (the "held" state; no HELD status). Transitions
  PENDING→APPROVED|CANCELLED; APPROVED→PROCESSING|CANCELLED; PROCESSING→PAID|FAILED. FAILED/CANCELLED: entries
  back to AVAILABLE, payoutId null. PAID: entries → PAID + one PAYOUT entry (−net); `bankAccountSnapshot Json`
  written at PROCESSING. Statement columns are positive magnitudes; `netPaise = gross − commission − charges − refunds + adjustments`
  MUST equal Σ scheduled amounts (assert). Numbering `PO-` + 6-digit seq. CHARGE entries also arise from return
  pickup fees (`returns.pickup_fee_paise`) for reasons {DAMAGED, DEFECTIVE, WRONG_ITEM, NOT_AS_DESCRIBED}.
  Manual ADJUSTMENT needs `payouts.adjust`.
- **B6 Payments & refunds**: each payment attempt is an `OrderPayment` row; a FAILED attempt leaves the order
  PENDING (event recorded). Order→FAILED only by the `orders.expire_unpaid` job (ONLINE unpaid after
  `checkout.payment_timeout_minutes`, default 20) or explicit admin action; FAILED releases reservations.
  COD: on shipment DELIVERED create `OrderPayment{ provider:COD, method:CASH, type:CHARGE, status:SUCCEEDED, amount = Σ delivered lineTotals (+ shipping + COD fee on the first) }`.
  Derivation (same tx as any payment/refund change): `paid = Σ SUCCEEDED CHARGE|CAPTURE`; `refunded = Σ Refund COMPLETED`;
  paymentStatus = refunded ≥ paid && paid>0 → REFUNDED; refunded>0 → PARTIALLY_REFUNDED; paid ≥ total → PAID;
  authorised uncaptured → AUTHORIZED; order CANCELLED/FAILED with paid=0 → CANCELLED/FAILED; else PENDING.
  `Order.refundedPaise = refunded`. Refund cap: `amount ≤ paid − Σ Refund.amount where status IN (PENDING, APPROVED, PROCESSING, COMPLETED)`;
  RMA-linked: `≤ item.lineTotalPaise × qty/item.quantity − OrderItem.refundedPaise`, plus shipping only when every
  line is returned or reason ∈ {DAMAGED, DEFECTIVE, WRONG_ITEM, NOT_AS_DESCRIBED, LATE_DELIVERY}; COD fee never
  refunded unless cancelled before dispatch. Refund transitions PENDING→APPROVED|CANCELLED; APPROVED→PROCESSING|CANCELLED;
  PROCESSING→COMPLETED|FAILED; FAILED→PENDING. COD orders refund via BANK_TRANSFER/MANUAL. STORE_CREDIT is out of
  scope. `@@unique([provider, providerPaymentId])` on OrderPayment, `@@unique([provider, providerRefundId])` on Refund.
  PaymentProvider gains `getClientParams(payment)` and `verifyClientCallback(payload)`; public API adds
  `POST /payments/:provider/verify` and `POST /orders/:number/retry-payment` (token-authenticated, D1).
  `POST /orders` returns `{ order:{ number, total, accessToken }, payment:{ provider, providerOrderId, clientParams } | null }`.
- **B7 Free-shipping precedence**: `shipping = rate.ratePaise`; if `(rate.freeAbovePaise ?? settings.shipping.free_above_paise)`
  is set and item subtotal after discounts ≥ threshold → 0; a FREE_SHIPPING coupon then zeroes what remains
  (recorded as couponDiscountPaise). COD fee is never waived by free shipping.

### 14.C Orders, shipments, returns — line-level model

- **C1 Fulfilment is per shipment.** `OrderItem.shippedAt?`, `deliveredAt?`, `reservedQty Int`, `refundedPaise Int`,
  `categoryId?` (→ Category SetNull "OrderItemCategory"), `categoryPathSnapshot?`, `hsnCodeSnapshot?`,
  `costPaiseSnapshot?`, `brandSnapshot?`. `Order.fulfillmentStatus (UNFULFILLED|PARTIAL|FULFILLED)`,
  `Order.returnStatus (NONE|REQUESTED|PARTIAL|FULL)`, `Order.returnedPaise Int`, `Order.reservationExpiresAt?`
  (+ `@@index([status, reservationExpiresAt])`), `Order.accessTokenHash String` (D1). Order status from shipments:
  SHIPPED when ≥1 shipment SHIPPED/IN_TRANSIT; OUT_FOR_DELIVERY when any shipment OFD and not all delivered;
  DELIVERED when every ACTIVE line has deliveredAt. Return window is per line from `OrderItem.deliveredAt`.
- **C2 Manual transitions** via `PUT /orders/:id/status`: PENDING→CONFIRMED|CANCELLED|FAILED; CONFIRMED→PROCESSING|CANCELLED;
  PROCESSING→PACKED|CANCELLED; PACKED→SHIPPED (creates a shipment for all unshipped lines when none exists)|CANCELLED.
  SHIPPED/OUT_FOR_DELIVERY/DELIVERED are driven by shipment updates (`PUT /orders/:id/shipments/:sid/status`);
  RETURN_REQUESTED/RETURNED/REFUNDED are derived by the returns/refunds services and rejected as manual targets.
  RTO: shipment RETURNED_TO_ORIGIN → on admin "RTO received" the order becomes CANCELLED with `cancelReason='RTO'`,
  stock restocked, refund created if paid > 0 (never earnings). Failed delivery attempt = `ShipmentEvent FAILED_DELIVERY`
  (status unchanged). `cancelOrderItem({ orderItemId, quantity, reason })` allowed before the line ships:
  releases/restocks, item.status CANCELLED (or quantity reduced with a CANCELLED sibling), Refund for lineTotal×qty
  when paid>0 (+ shipping if all lines cancelled), coupon not re-allocated; all lines cancelled → order CANCELLED.
- **C3 Transition → stock movement table** (at most one movement per line per transition):
  ```
  order created (PENDING)                 RESERVE  reservedDelta +q
  PENDING→CONFIRMED                       SALE     delta −q, reservedDelta −q
  PENDING→CANCELLED|FAILED (expiry)       RELEASE  reservedDelta −q
  CONFIRMED|PROCESSING|PACKED→CANCELLED   RETURN   delta +q (reason ORDER_CANCELLED)
  line cancel before ship                 as above for that line's qty
  return QC_PASSED                        RETURN   delta +returnedQty
  return QC_FAILED disposition RESTOCK    RETURN   delta +qty ; DISPOSE → DAMAGE note-only (delta 0)
  RTO received                            RETURN   delta +q per line
  replacement shipped                     SALE     delta −q (no reserve)
  manual COD order                        CONFIRMED with RESERVE+SALE in one tx
  ```
  Remove the legacy "terminal states restock" rule from enums.ts.
- **C4 Return flow (final)**: REQUESTED→UNDER_REVIEW|APPROVED|REJECTED|CANCELLED; UNDER_REVIEW→APPROVED|REJECTED|CANCELLED;
  APPROVED→PICKUP_SCHEDULED|CANCELLED; PICKUP_SCHEDULED→RECEIVED|CANCELLED; RECEIVED→QC_PASSED|QC_FAILED; REJECTED→CLOSED (auto).
  QC_PASSED + resolution REFUND → REFUND_INITIATED (creates Refund) → REFUND_COMPLETED → CLOSED (refund FAILED keeps REFUND_INITIATED).
  QC_PASSED + REPLACEMENT → REPLACEMENT_SHIPPED (new Shipment on the same order, SALE movement, no refund) → CLOSED.
  QC_FAILED → `qcDisposition (RETURN_TO_CUSTOMER|RESTOCK|DISPOSE|PARTIAL_REFUND)`; PARTIAL_REFUND → REFUND_INITIATED with admin amount ≤ cap; others → CLOSED.
  Fields: `requestedResolution?`, `resolution?` (set at APPROVED), `qcDisposition?`, `replacementShipmentId?`;
  drop `ReturnRequest.refundId` — `Refund.returnRequestId String? @unique` is the only direction.
  Validation: `quantity ≤ item.quantity − item.returnedQty − Σ open RMA qty`; `returnedQty` increments at QC_PASSED.
  Order `returnStatus` derived: any open RMA → REQUESTED; all lines fully returned → FULL; some → PARTIAL.
- **C5 Seller state machine**: `transitionSeller({ sellerId, toStatus, actor, reason? })`:
  PENDING→UNDER_REVIEW|REJECTED; UNDER_REVIEW→APPROVED|REJECTED; APPROVED→ACTIVE (manual "Activate", or auto when
  ≥1 VERIFIED document and a primary bank account exist); ACTIVE→SUSPENDED; SUSPENDED→ACTIVE; REJECTED→UNDER_REVIEW.
  Side effects: APPROVED → `seller_approved` email; REJECTED → `seller_rejected` (reason required); SUSPENDED →
  products hidden publicly (reason required); every transition writes `SellerEvent` (sellerId, fromStatus,
  toStatus, message, actorId, createdAt) + audit. "Reset access" issues a `SellerPasswordResetToken` and emails
  `${storefront.base_url}/seller/reset-password/:token`.
- **C6 Seller registration intake**: `POST /api/v1/sellers/register` (honours `marketplace.seller_registration_open`;
  creates PENDING seller; notify NEW_SELLER + SELLER_APPROVAL_REQUIRED; email `seller_registration_received`),
  `POST /api/v1/uploads/seller-document` (pdf/jpg/png ≤5 MB, PRIVATE, returns uploadToken),
  `POST /api/v1/sellers/register/documents { registrationToken, type, uploadToken }`. Rate-limited by IP + email.
- **C7 Counters**: `Customer.orderCount`, `totalSpentPaise`, `firstOrderAt`, `@@index([totalSpentPaise])`
  (updated on DELIVERED/REFUNDED); `Seller.productCount`, `publishedProductCount`, `orderItemCount`,
  `grossSalesPaise` (maintained by publish/unpublish and ledger writes). Customer segments from settings:
  `customers.new_days` 30, `customers.returning_min_orders` 2, `customers.vip_min_orders` 10,
  `customers.high_value_min_spend_paise` 2000000, `customers.inactive_days` 180.
- **C8 Order list "shipping status"** = status of the most recently updated non-CANCELLED shipment or "—";
  `@@index([orderId, updatedAt])` on Shipment. Numbering: `DB` + seq (start 10001), `SH-######`, `RMA-######`,
  `RF-######`, `PO-######` — implemented as Prisma-native `seq Int @default(autoincrement()) @unique` on Order,
  Shipment, ReturnRequest, Refund, SellerPayout with `ALTER SEQUENCE … RESTART WITH …` appended to the init
  migration; the human number is written in the same tx from `seq`.

### 14.D Security (binding mechanisms)

- **D1 Order access token**: `Order.accessTokenHash` (SHA-256 of 32 random bytes); plaintext returned only by
  `POST /orders` and in the confirmation email. `GET /orders/:number?token=`, `POST /returns { orderNumber, token, … }`,
  `POST /orders/:number/retry-payment?token=`; mismatch → same 404 as unknown; `Cache-Control: no-store`;
  rate limit 20/min/IP + 100/day per order number.
- **D2 2FA as session state**: `AdminSession.mfaVerifiedAt DateTime?`; `authorize()` creates the session with null
  when `twoFactorEnabled`; `getActor()` reports `pendingMfa` and `requireAdmin` redirects to `/admin/two-factor`;
  proxy treats a pending JWT as signed-out except `/admin/two-factor` and `/api/auth`. TOTP RFC 6238, 30 s,
  ±1 step, `User.lastTotpStep` prevents reuse, 5 failures revoke the pending session. Enrolment provisional until
  one valid code; enable/disable requires current password; `User.recoveryCodesHash String[]` (10 single-use
  bcrypt codes) plus `scripts/disable-2fa.ts` break-glass.
- **D3 Privilege escalation rules** (users/roles services): an actor may assign only roles whose permission set ⊆
  their own; assigning/removing `super-admin` requires super-admin; users.edit/delete/reset/session-revoke on a
  target with a role the actor could not assign → FORBIDDEN; roles.manage cannot grant a permission the actor
  lacks and cannot edit the actor's own role; admins never set passwords, only trigger reset links; changing
  another user's email revokes their sessions. Users are never hard-deleted (`isActive=false`, `deletedAt`,
  email → `<id>@deleted.local`).
- **D4 Encryption at rest**: env `ENCRYPTION_KEY` (32 bytes base64; production startup fails if missing or equal
  to AUTH_SECRET; dev falls back to a derived key with a console warning). `encrypt(plaintext, purpose)` =
  AES-256-GCM, random 12-byte IV, key = HKDF-SHA256(ENCRYPTION_KEY, info=purpose), purpose ∈
  {`2fa`,`bank`,`payments`,`smtp`,`preview`}; stored as `v1:<iv>:<tag>:<data>`. `decrypt` callable only from
  service.ts. GET for secrets returns `{ isSet, last4 }`; empty/omitted secret on PUT = unchanged; no reveal
  endpoint except `POST /sellers/:id/bank-accounts/:bid/reveal` (payouts.process, audited). `redact()` covers
  `/(password|secret|token|hash|credential|Enc$|accountNumber)/i` and every `Setting.type=secret`.
- **D5 Webhooks**: raw body + headers to `verifyWebhook`; constant-time compare; reject when provider disabled or
  mode mismatch; `WebhookEvent { provider, providerEventId @@unique, payload, receivedAt, processedAt?, error? }`
  inserted first (duplicate → 200 no-op); resolve order only via our `OrderPayment.providerOrderId`; require
  amount+currency equality; 2xx only after commit; 4xx on signature failure; `no-store`.
- **D6 Private media**: `MediaAsset.visibility (PUBLIC|PRIVATE)`; local driver writes to `storage/public/**` and
  `storage/private/**` (NOT under `public/`); public files served by `GET /media/[...key]` route handler (stored
  mimeType, `X-Content-Type-Options: nosniff`, `Content-Disposition: attachment` for non-images); private files
  only via `GET /api/admin/media/:id/file` (permission by usage, audited `media.private_read`). KYC documents and
  customisation uploads are always PRIVATE. Public uploads return an opaque `uploadToken`
  (`PendingUpload { token @unique, storageKey, mimeType, sizeBytes, ip, expiresAt }`, 24 h) that `POST /orders`
  exchanges; a job deletes unreferenced pending uploads. Accept only image/jpeg|png|webp by magic bytes,
  re-encode via sharp (`limitInputPixels: 50e6`, max 5000×5000, EXIF stripped); admin SVG only with
  `media.upload` after sanitisation; video mp4/webm; documents pdf. Rate limit uploads 20/h/IP.
- **D7 Response helpers**: `publicCachedJson()` only for anonymous identical-for-everyone GETs (categories,
  products, home, banners, navigation, pages, blog, faqs, footer, settings, sitemap, pincode) with
  `s-maxage=30, stale-while-revalidate=300` + `unstable_cache`/`"use cache"` tagged `catalog|content|nav|settings`
  (services call `invalidatePublic(tags[])` after commit). `privateJson()` (`no-store`, `Vary: Authorization`)
  for every POST, every token/email-bearing endpoint and every error. CORS allowlist `STOREFRONT_ORIGINS`
  (comma-separated) with OPTIONS preflight; `*` only on cached reads.
- **D8 CSRF for /api/admin writes**: non-GET requires `Sec-Fetch-Site === 'same-origin'` OR `Origin === APP_ORIGIN`
  (new required env; also used for reset links); otherwise 403 `CSRF_REJECTED`; require JSON or multipart content
  type. `next.config.ts`: `serverActions.allowedOrigins`, `bodySizeLimit`, `serverExternalPackages`,
  `authInterrupts: true`. Cron: `POST /api/internal/jobs/run` with `X-Cron-Secret` (constant-time, ≥32 bytes,
  503 if unset), audited as SYSTEM actor.
- **D9 Rate limiting**: `RateLimitBucket { key @id, windowStart, count }` via `INSERT … ON CONFLICT DO UPDATE`
  (raw SQL) + purge job; `clientIp()` honours `TRUSTED_PROXY_HOPS`. Limits: POST /orders 10/min/IP; reviews
  5/h/IP; contact & newsletter 5/h/IP; coupons/validate 30/min/IP (uniform error); order tracking 20/min/IP;
  uploads 20/h/IP; shipping/quote 60/min/IP; login 30/15 min per IP evaluated first, then per-email exponential
  backoff (1 s→15 min) instead of a hard lockout, super-admin notification after 10 failures; forgot-password
  3/h per email, 10/h per IP. 429 carries `Retry-After`. LoginAttempt records ip + userAgent.
- **D10 Errors & guards**: `requirePermissionOrThrow` throws `ApiError(401|403)`; `withAdminApi` maps to the
  envelope, `runAction` maps to `fail()`; `forbidden()/unauthorized()` used only by `requirePermission` in pages
  (`authInterrupts` + `app/admin/forbidden.tsx`, `unauthorized.tsx`). Every `page.tsx` under the shell calls its
  own guard; the layout call is defence in depth. `forcePasswordChange` → redirect to `/admin/account/password`.
  Password reset: links from `APP_ORIGIN`; completing a reset marks token used, deletes siblings, revokes all
  sessions, clears forcePasswordChange, audits; min length 12; identical responses whether the email exists.
  Sessions: `expiresAt` absolute 12 h, idle 60 min from `lastSeenAt` (written at most every 5 min); sign-out
  deletes the row; production cookie `__Host-` prefix, secure, httpOnly, sameSite lax.
- **D11 Public serialisers are explicit allowlists** (never spread Prisma rows). Public seller fields: slug,
  displayName, description, logo, banner, city, state, ratingAvg, reviewCount, memberSince. Order tracking:
  orderNumber, status, paymentStatus, placedAt, items (title, variant, qty, unitPrice, customization text),
  totals, shipping address, shipments (carrier, tracking, public events), non-internal events. `/settings`
  excludes `type=secret` regardless of isPublic. Wave-4 test deep-scans every /api/v1 response for the denylist
  `costPaise, passwordHash, email, phone, pan, gstin, accountNumber, Enc, Hash, ipAddress, userAgent, rawPayload, isInternal, draftPayload, commissionPaise, sellerPayablePaise, notes, customerId`.
- **D12 Sanitisation**: dependency `sanitize-html`; `src/lib/sanitize/html.ts` with `sanitizeHtml(html, profile:'rich'|'basic'|'email')`
  — allowlist p, br, h2-h4, strong, em, u, s, ul, ol, li, a[href,title], img[src,alt,width,height], blockquote,
  pre, code, hr, table/thead/tbody/tr/th/td, figure/figcaption; schemes http/https/mailto/relative; strip
  style/class/on*/data-*; external links get `rel="noopener noreferrer nofollow" target="_blank"`; img src must
  be an app media origin. Applied on write in services and again in public serialisers. Shared Zod
  `safeUrlSchema` for every URL column. Admin HTML previews render in `<iframe sandbox srcdoc>` (`HtmlPreview`).
- **D13 Audit requirements**: mandatory events — login success/failure, logout, password change/reset, 2FA
  enable/disable, session revoke, user create/role change/deactivate, role permission change, settings and
  provider credential change (key names only), seller status/commission/bank change (last4), payout
  approve/process/paid/fail, refund approve/complete, manual order status override, coupon create, private media
  read, every export (filter + row count), bulk actions (id count). `writeAudit(tx?, { actor|SYSTEM_ACTOR, …, ip? })`
  accepts a transaction client so jobs and financial/security actions run it inside the tx (failure aborts).
  Seed `SYSTEM_ACTOR`. Migration adds a trigger rejecting UPDATE/DELETE on `AuditLog`.
- **D14 Search & reports respect permissions**: search scopes ∩ `can(actor, '<scope>.view')`; each report declares
  `requires: string[]` in addition to `reports.view`; dashboard widgets are bound to module permissions and omitted
  server-side. Extra permission codes: `jobs.view jobs.manage email_outbox.view payouts.adjust settings.manage_payments settings.manage_security`
  (the latter two super-admin only; `admin` gets `settings.manage` but not these).
- **D15 Checkout abuse controls**: reservation TTL (B6); COD orders not CONFIRMED within `orders.cod_confirm_hours`
  (48) auto-cancel; max 3 open PENDING orders per email and 10 per IP per day; optional `checkout.turnstile_secret`
  verified server-side when set; guest orders never attach to a Customer that has `passwordHash` unless the request
  carries a valid integration token — otherwise `guestEmail` only; blocklist setting for emails/phones/pincodes.
  Export cells starting with `= + - @ \t \r` are quoted (formula injection).

### 14.E Content, settings, communication contracts

- **E1 Homepage section registry** (`src/features/content/registry.ts`, wave 2a infra — frozen for wave 3 except
  the content agent). Types and payloads:
  | type | blocks | section payload | /home resolver |
  |---|---|---|---|
  | `hero_slider` | none (reads Banner placement HOME_HERO) | `{ placement:'HOME_HERO', limit, autoplaySeconds }` | active in-window banners by position |
  | `promo_banners` | none (Banner placement HOME_PROMO) | `{ placement:'HOME_PROMO', limit, layout:'grid'|'strip' }` | banners |
  | `featured_categories` | none | `{ source:'auto'|'manual', categoryIds[], limit }` | categories (isFeatured or listed) |
  | `new_arrivals` / `best_sellers` / `trending` / `featured_products` | none | `{ source:'auto'|'manual', productIds[], categoryId?, limit }` | products by createdAt / orderCount / isTrending / isFeatured |
  | `product_collection` | none | `{ productIds[], categoryId?, tag?, limit }` | custom collection |
  | `seller_highlights` | none | `{ source:'auto'|'manual', sellerIds[], limit }` | ACTIVE sellers by ratingAvg or listed |
  | `testimonials` | none | `{ source:'auto'|'manual', reviewIds[], limit }` | APPROVED isTestimonial reviews |
  | `product_reviews` | none | `{ limit, minRating }` | APPROVED isFeatured reviews |
  | `promo_section` | none | `{ imageMediaId, mobileImageMediaId?, heading, text, buttonText, linkType, linkUrl?, linkTargetId?, align }` | as stored |
  | `newsletter` | none | `{ heading, text, placeholder, buttonText }` | as stored |
  | `trust_badges` | yes | `{}`; blocks `{ iconName, title, text }` | blocks |
  | `announcement_bar` | yes | `{ rotateSeconds }`; blocks `{ text, linkUrl? }` | blocks |
  | `rich_text` | none | `{ html }` (sanitised) | as stored |
  | `footer` | none | `{}` (reads FooterConfig + footer menus) | footer config |
  Common section fields: `title`, `subtitle`, `enabled`, `position`, `publishAt`, `unpublishAt`, `imageMediaId`,
  `linkType (NONE|URL|CATEGORY|PRODUCT|PAGE|BLOG)`, `linkUrl`, `linkTargetId`, `buttonText`.
  `GET /api/v1/home` → `[{ key, type, title, subtitle, image, link:{ type, url }, buttonText, settings, items[] }]`,
  items resolved server-side and status-filtered. Banners remain the single editor for slide content; Homepage
  controls order/enable/schedule/title. Footer tab lives on `/admin/homepage` (`GET|PUT /api/admin/homepage/footer`,
  homepage.manage); footer link columns come from NavigationMenu `footer-1..3`; FooterConfig holds brand
  description, copyright, paymentIcons, appLinks, customerService.
- **E2 Setting keys** (seeded in wave 1, frozen; `*` = isPublic):
  `store.name*`, `store.tagline*`, `store.logo_media_id*`, `store.favicon_media_id*`, `store.contact_email*`, `store.contact_phone*`,
  `store.whatsapp*`, `store.address*`, `store.currency*` (INR), `store.timezone` (Asia/Kolkata), `storefront.base_url`,
  `storefront.cors_origins`, `storefront.preview_enabled`;
  `tax.default_bps`, `tax.prices_include_tax`, `tax.goods_remitted_by` (SELLER), `tax.commission_tax_bps` (0);
  `orders.cod_enabled*`, `orders.cod_fee_paise*`, `orders.cod_max_paise*`, `orders.min_order_paise*`, `orders.auto_confirm_prepaid`,
  `orders.cod_confirm_hours`, `orders.max_open_per_email`, `orders.max_per_ip_per_day`;
  `checkout.payment_timeout_minutes`, `checkout.turnstile_secret` (secret), `checkout.blocklist` (json);
  `inventory.default_low_stock_threshold`, `inventory.allow_backorder_default`;
  `returns.enabled*`, `returns.window_days*`, `returns.pickup_fee_paise`, `returns.customer_pays_pickup`;
  `shipping.free_above_paise*`, `shipping.default_estimate_days*`;
  `email.smtp_host`, `email.smtp_port`, `email.smtp_user`, `email.smtp_password` (secret), `email.smtp_secure`,
  `email.from_name`, `email.from_address`, `email.reply_to`, `email.transport` (smtp|console);
  `marketplace.seller_registration_open*`, `marketplace.payout_hold_days`, `marketplace.payout_cycle` (WEEKLY),
  `marketplace.min_payout_paise`, `marketplace.charges` (json);
  `customers.new_days`, `customers.returning_min_orders`, `customers.vip_min_orders`, `customers.high_value_min_spend_paise`, `customers.inactive_days`;
  `seo.meta_title*`, `seo.meta_description*`, `seo.og_image_media_id*`, `seo.robots_txt*`, `seo.sitemap_enabled*`;
  `social.facebook*`, `social.instagram*`, `social.youtube*`, `social.whatsapp*`, `social.twitter*`, `social.pinterest*`;
  `security.session_hours`, `security.idle_minutes`, `security.require_2fa_for_super_admin`; `notifications.digest_enabled`.
  Global commission lives ONLY in `CommissionRule GLOBAL` (no mirror setting).
- **E3 Event → notification → email matrix** (`src/features/notifications/events.ts`, wave 2a):
  order created → `NEW_ORDER` (orders.view) + `order_confirmation` {customer_name, order_id, order_total, order_items_html, order_url, payment_method};
  payment SUCCEEDED → `payment_confirmation` {…, transaction_id, amount}; payment FAILED → `PAYMENT_FAILED` (payments.view);
  shipment SHIPPED → `order_shipped` {tracking_number, tracking_url, carrier, eta}; shipment DELIVERED → `order_delivered`;
  order CANCELLED → `ORDER_CANCELLED` + `order_cancelled` {cancel_reason};
  return REQUESTED → `RETURN_REQUESTED` (returns.view); return APPROVED → `return_approved` {rma_number, pickup_date};
  refund PENDING → `REFUND_REQUESTED` (refunds.view); refund COMPLETED → `refund_processed` {refund_amount, refund_method};
  seller registered → `NEW_SELLER` + `SELLER_APPROVAL_REQUIRED` (sellers.approve) + `seller_registration_received`;
  seller APPROVED/REJECTED → `seller_approved` / `seller_rejected` {seller_name, reason};
  stock ≤ threshold → `LOW_STOCK`; = 0 → `OUT_OF_STOCK` (inventory.view); review created → `NEW_REVIEW` (reviews.moderate);
  inquiry created → `NEW_INQUIRY` (inquiries.view) + `contact_ack`; payout generated → `PAYOUT_DUE` (payouts.approve);
  customer created via integration → `welcome`; admin password reset → `admin_password_reset`; admin invite → `admin_invite`;
  newsletter subscribe → `newsletter_welcome`. `EmailTemplate.variables` seeded from this table; the editor warns on
  unknown `{{vars}}`. Additional template keys: `seller_registration_received`, `seller_password_reset`, `customer_password_reset`.
- **E4 Reports** (`REPORT_KEYS` in enums.ts): `sales, orders, products, categories, sellers, customers, revenue, commissions, payouts, inventory, refunds, coupons, tax`.
  Revenue = Σ Order.totalPaise − Σ refundedPaise for orders NOT IN (CANCELLED, FAILED), bucketed by placedAt (IST);
  net sales = revenue − shipping − COD fee. Tax report groups by (hsnCodeSnapshot, taxRateBps). Dashboard and
  reports share `src/features/reports/metrics.ts`. Exports: `format=csv|xlsx|print`.
- **E5 System CMS pages** (isSystem, slug locked): `about-us, contact-us, faqs (template FAQ), privacy-policy, terms-and-conditions, return-policy, shipping-policy, seller-terms, seller-guidelines`. Templates `DEFAULT|ABOUT|CONTACT|FAQ|POLICY`.
- **E6 Preview tokens**: `POST /api/admin/{products|pages|blog}/:id/preview-token` (module `.view`) → HMAC-SHA256 over
  `${entity}:${id}:${exp}` (HKDF `preview` key, exp ≤ 1 h). Public GETs accept `?preview=<token>` and bypass the
  status filter for that one entity with `no-store`. Admin "Preview" opens `${storefront.base_url}/{products|pages|blog}/{slug}?preview=…`.
- **E7 Customer identity & website integration** (`src/app/api/v1/integration/**`, owned by the customers agent;
  auth by `X-Storefront-Key` = env `STOREFRONT_API_KEY`, constant-time compare, rate-limited):
  `PUT /integration/customers` (upsert by email → `welcome` on create), `PUT /integration/customers/:email/wishlist { items:[{productId, variantId?}] }`,
  `PUT /integration/carts/:sessionToken { email?, items[] }`, `POST /integration/customers/:email/login-event`,
  `POST /integration/customers/verify-credentials { email, password }` (only when the website delegates password
  storage to us), `POST /integration/customers/reset-password { token, newPassword }`.
  `CustomerPasswordResetToken { customerId, tokenHash @unique, expiresAt, usedAt }`; admin "reset password" =
  create token + `customer_password_reset` email linking `${storefront.base_url}/reset-password/:token`.
  Soft-deleted customers: email → `deleted+<id>@invalid.local`, original in `deletedEmailHash`.

### 14.F Schema conventions (apply to every model in §4)

- **F1 Relation naming**: every `*ById` column is an FK to User, `onDelete: SetNull`, relation name `<Model><Field>`
  (e.g. `@relation("SellerPayoutApprovedBy")`), with an explicit back-relation on User. Every `*MediaId` FK is
  `onDelete: Restrict`, relation name `<Model><Field>` (e.g. `"CategoryIcon"`), with a back-relation on MediaAsset
  so the "usage" query (§11.22) is a fixed list of counts.
- **F2 Referential actions**: history tables (Order*, StockMovement, SellerLedgerEntry, CouponUsage, AuditLog,
  ReturnRequest, Refund, Shipment*, OrderPayment, WebhookEvent) never cascade from catalogue/people — FKs to
  Product/Variant/Seller/Customer/Coupon/ShippingPartner/User are `SetNull` with snapshot columns; FK to Order is
  `Cascade` only because orders are never deleted. `StockMovement.variantId` and `InventoryItem.variantId` →
  `Restrict`; `ProductVariant.deletedAt` for soft delete once movements exist. `Category.parentId`,
  `Product.categoryId`, `User.roleId` → `Restrict`. `CommissionRule.*Id` → `Cascade`. Child tables of an aggregate
  (ProductImage, ProductVariant, VariantAttributeValue, Address, ReviewImage, ShipmentItem, ContentBlock,
  NavigationItem children, CustomizationOption, SellerDocument, SellerBankAccount) → `Cascade`.
- **F3 Circular FK pairs resolved**: only `Refund.returnRequestId @unique → ReturnRequest`; only
  `Refund.orderPaymentId → OrderPayment ("RefundSourcePayment")`; a gateway refund echo row is
  `OrderPayment(type=REFUND, refundId → Refund "RefundSettlementPayment")`.
- **F4 Nullable uniqueness**: never rely on `@@unique` with nullable members. Use key columns (`valueKey`,
  `targetKey`) or partial unique indexes in the migration SQL (open payout per seller). `WishlistItem.variantId`
  and `CartItem.variantId` required (resolve default variant).
- **F5 Postgres features**: datasource `extensions = [pg_trgm]` with generator `previewFeatures = ["postgresqlExtensions"]`;
  Product `@@index([title(ops: raw("gin_trgm_ops"))], type: Gin)`; `facetValueIds`, `categoryIds`, `productIds`,
  `sellerIds` arrays get `type: Gin` indexes. Sequences via `seq Int @default(autoincrement()) @unique` (C8).
  Migration SQL is hand-appended (`prisma migrate dev --create-only`) with: `ALTER SEQUENCE … RESTART`, the partial
  unique index for open payouts, the AuditLog no-update/no-delete trigger. Remove the `db:push` script;
  `db:reset` (`migrate reset`) is the only bootstrap path.
- **F6 Idempotency columns**: `dedupeKey String? @unique` on EmailOutbox and Job; `queueEmail` sets
  `${templateKey}:${entity.type}:${entity.id}`; `enqueue(type, payload, { dedupeKey })`.
- **F7 InventoryItem** adds `available Int` and `stockState (IN_STOCK|LOW_STOCK|OUT_OF_STOCK|BACKORDER)` written inside
  `applyStockMovement()` and threshold edits; indexes on both. Badges query `stockState`.
- **F8 Additional indexes & rules**: ReturnRequest (status, requestedAt), (orderId), (customerId), (sellerId);
  Refund (returnRequestId), (orderPaymentId), (status); Shipment (orderId), (trackingNumber), (orderId, updatedAt);
  ShipmentItem @@unique([shipmentId, orderItemId]); Review (productId, status, createdAt), (sellerId, status),
  @@unique([orderItemId]); Banner (placement, isActive, position); NavigationItem (menuId, parentId, position);
  ContactInquiry (status, createdAt), (assignedToId); EmailOutbox (entityType, entityId); BlogPost (categoryId, status);
  CustomerSession (customerId); CouponUsage (couponId, customerId); OrderItem (categoryId), (sellerId, status);
  Coupon `deletedAt` (hard delete only when usageCount = 0; `Order.couponId` SetNull; `CouponUsage.couponId` Restrict);
  usage limit enforced with conditional `updateMany` whose count must be 1. MediaAsset `folderId?` (→ MediaFolder
  SetNull "MediaFolderAssets") replaces the folder string; `@@index([folderId, createdAt])`.
- **F9 New tables**: `WebhookEvent`, `RateLimitBucket`, `PendingUpload`, `SellerEvent`, `SellerBalance`,
  `CustomerPasswordResetToken`, `SellerPasswordResetToken`. `Product.id`/`ProductVariant.id` → `@default(cuid())`
  (legacy readable ids retired; `mintProductId/mintVariantId` deleted).
- **F10 Removed/renamed (complete)**: `User.role` → `roleId`; `User.customer`/`Customer.userId` gone; `Product.gender`,
  manual `Product.id`/`ProductVariant.id`, `ProductVariant.colorHex` (→ attribute value) gone; `Discount` → `Coupon`;
  `Order.ship*` snapshot columns → `OrderAddress`; `Order.legacyDateString` gone; `PLACED` → `PENDING`;
  `CmsPage.body/extra/eyebrow/intro` → `content` HTML + `excerpt`; `MediaAsset.source/pathname` →
  `storageProvider/storageKey/visibility/folderId`; `Notification` becomes per-user (`userId` required); `Setting`
  gains `isPublic`; `Review` gains seller/reply fields.

### 14.G Implementation protocol (replaces §9 rules where different)

- **G1 Wave 1 deliverables**: complete schema (§4 + §14), fresh single `init` migration (delete the old migration
  folder; the old `niyabags_db` database is left untouched — `.env`/`.env.example` `DATABASE_URL` switch to a new
  database `diybaazar_db`), `enums.ts` with `*_STATUSES`, `*Schema`, `*_META` and transition maps for EVERY
  vocabulary in §4/§10/§14, `src/lib/permissions.ts` (full code list + role grants), `src/lib/settings-keys.ts`
  (E2), `REPORT_KEYS`, existing code compiling against the new schema (features may be reduced to compile-only
  stubs where the model changed fundamentally — they are rewritten in wave 3), minimal seed (`prisma/seed.ts`
  orchestrator + `prisma/seed/modules/{access,settings,taxonomy,attributes,templates,menus,pages}.ts`),
  `npm run typecheck` clean, `npm run db:reset` succeeds.
- **G2 Wave 2a (parallel, 5 agents)**: (1) shell+auth+API plumbing+search+users/roles/audit basics, scaffolding a
  placeholder `page.tsx` + `loading.tsx` for EVERY route in §6 so `Route` types exist; (2) shared components
  (incl. `TreeView` per G5, `RichTextEditor`, `MediaPicker` shell); (3) infra libs + services
  (`src/lib/{storage,queue,email,crypto,rate-limit,payments,export,sanitize,api}`,
  `src/features/{notifications,email,inventory,finance,catalog}/…`, `src/features/content/registry.ts`,
  `next.config.ts`, `scripts/worker.ts`, `/media/[...key]`, `/api/internal/jobs/run`, `/api/v1/payments/**`);
  (4) media library (page + upload API + picker); (5) `/api/v1` catalog/content read layer
  (`src/lib/api/public.ts`, serializers, `/categories`, `/products`, `/home`, `/banners`, `/navigation`, `/pages`,
  `/faqs`, `/footer`, `/settings`, `/blog`, `/sellers/:slug`, `/seo/sitemap`).
- **G3 Wave 2b (1 agent, after 2a)**: full demo seed via `prisma/seed/modules/*.ts`, importing the finished pure
  services (`src/features/finance/math.ts`, `inventory/service.ts`, `catalog/*`) — service files must not import
  `server-only` or `next/*`; anything Next-specific lives in `actions.ts`/route files. Deterministic ids and
  numbers; `setval` sequences after insert; `createMany` for leaf tables.
- **G4 Wave 3 ownership**: a module owns `src/features/<x>/**`, `src/app/admin/(shell)/<x>/**`,
  `src/app/api/admin/<x>/**`, `prisma/seed/modules/<x>.ts`, AND its own `/api/v1` intake handlers (orders →
  `/api/v1/orders/**`; returns → `/api/v1/returns`; coupons → `/api/v1/coupons/validate`; shipping →
  `/api/v1/shipping/**`; reviews → `/api/v1/products/[slug]/reviews`; inquiries → `/api/v1/contact`; newsletter →
  `/api/v1/newsletter/**`; sellers → `/api/v1/sellers/register/**`, `/api/v1/uploads/seller-document`; customers →
  `/api/v1/integration/**`; products → `/api/v1/uploads/customization`). Frozen for wave 3: schema, migrations,
  enums, permissions, settings keys, nav, shared components, `src/lib/**`, wave-2a services (except the owning
  module's own `service.ts` body). Verification for wave-3 agents: `npx tsc --noEmit` only (no typegen, no prisma,
  no next dev/build); new hrefs not in the scaffold use `as Route`. Cross-module compile errors in files they do
  not own are reported, not fixed.
- **G5 TreeView contract**: `TreeView<T extends { id; parentId: string|null; position: number }>({ items, renderRow(item, { depth, isDragging }), onMove({ id, parentId, position }), maxDepth?, indentPx=24, collapsible=true })`
  using dnd-kit flatten+projection (SortableTree pattern), keyboard sensors, vertical restriction.
  `PUT /api/admin/categories/reorder` and `/navigation/items/reorder` accept `{ moves:[{ id, parentId, position }] }`
  and recompute `path`/`depth` in one tx.
- **G6 Tooling**: `RichTextEditor` is a Client Component via `next/dynamic(..., { ssr:false })` with
  `useEditor({ immediatelyRender:false })`, value = sanitised HTML, images only from MediaPicker.
  `next.config.ts`: `serverExternalPackages: ['exceljs','nodemailer','sharp','@aws-sdk/client-s3','qrcode','sanitize-html']`.
  `src/lib/export`: CSV streams via `ReadableStream`; XLSX lazily imports exceljs, hard cap 100k rows (else 422 "use CSV").
- **G7 Wave 4 verification** adds: the public-API denylist scan (D11), finance fixture test (B1), permission matrix
  smoke (each role hits each route), and an authenticated crawl of every admin page.
