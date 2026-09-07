import { Plug } from "lucide-react";

import { Panel } from "@/components/shared/panel";
import { StatusPill } from "@/components/shared/status-badge";
import type { BadgeTone } from "@/lib/enums";

/**
 * What stands between this admin panel and the live shop.
 *
 * Every claim below was checked against the storefront source in
 * ../e-commerce_frontend-main, not assumed. There are deliberately no buttons
 * here: none of this can be performed from inside the panel, and a button that
 * only pretends to would be worse than no button at all.
 */

type CutoverStatus = "env" | "code" | "not-started";

const STATUS_META: Record<
  CutoverStatus,
  { label: string; tone: BadgeTone; blurb: string }
> = {
  env: {
    label: "env only",
    tone: "info",
    blurb: "no code change, one environment variable",
  },
  code: {
    label: "code change",
    tone: "warning",
    blurb: "existing file has to be edited",
  },
  "not-started": {
    label: "not started",
    tone: "danger",
    blurb: "nothing to edit yet — it does not exist",
  },
};

type CutoverItem = {
  title: string;
  detail: string;
  files: string[];
  status: CutoverStatus;
};

const ITEMS: CutoverItem[] = [
  {
    title: "The API base URL is already an environment variable",
    detail:
      "axiosClient.js builds its api client from import.meta.env.VITE_API_BASE_URL and only falls back to https://shieldnest.theglamstreet.in/api, an unrelated backend. Pointing that one variable at this panel's /api/v1 is the entire change.",
    files: ["src/api/axiosClient.js"],
    status: "env",
  },
  {
    title: "Product, homepage and footer calls return static local data",
    detail:
      "productApi.js re-exports src/data/products.js, homeApi.js re-exports src/data/homeData.js and footerApi.js re-exports src/data/footerData.js. Their axios bodies have to come back. productApi.js still carries every one of them commented out at the bottom of the file; homeApi.js and footerApi.js have no commented original and need writing.",
    files: [
      "src/api/productApi.js",
      "src/api/homeApi.js",
      "src/api/footerApi.js",
    ],
    status: "code",
  },
  {
    title: "contentApi.js is dead code aimed at a local mock server",
    detail:
      "Every function in it is commented out, and the axios client it would use points at VITE_MOCKOON_API_BASE_URL, default http://localhost:3001. Nothing imports it — homeApi.js is the live adapter — so it should be deleted rather than restored. notFoundApi.js does use that same mockoon client, so the 404 page already calls localhost today.",
    files: ["src/api/contentApi.js", "src/api/notFoundApi.js"],
    status: "code",
  },
  {
    title: "Two homepage components call their API synchronously",
    detail:
      "BrandCraftsmanship.jsx does const data = getCraftsmanship() and CustomerReviews.jsx does const reviews = getReviews() — no await, no state, no effect, because both functions currently return a plain object. The moment they return promises, craftsmanship renders empty headings and reviews?.length is undefined, so the reviews section returns null and disappears. Repointing the api folder is not enough on its own.",
    files: [
      "src/components/home/BrandCraftsmanship.jsx",
      "src/components/home/CustomerReviews.jsx",
    ],
    status: "code",
  },
  {
    title: "There is no order API client at all",
    detail:
      "src/api/orderApi.js does not exist. OrderPage.jsx has await createOrder(orderPayload) commented out, waits a simulated second, then pushes the order into localStorage under niyaOrders. This panel already has the receiving end (POST /api/v1/orders); the storefront has nothing to call it with, so no order placed on the shop can ever appear in Orders here.",
    files: ["src/pages/OrderPage.jsx"],
    status: "not-started",
  },
  {
    title: "Trust badges are hardcoded inside the component",
    detail:
      "TrustBadges.jsx holds its four items in a module-level array whose icon values are react-icons components (FiBox, FiShield, FiRefreshCw, FiHelpCircle). Data from an API can carry the string \"FiBox\" but not the component, so making this section editable needs an icon-name to component map in the storefront.",
    files: ["src/components/home/TrustBadges.jsx"],
    status: "code",
  },
  {
    title: "Cart and wishlist live in the shopper's own browser",
    detail:
      "CartContext.jsx persists to localStorage under niya_cart and WishlistContext.jsx keeps its own key. No server has ever seen either, which is why this panel reports no abandoned carts, no saved items and no cross-device behaviour — those numbers cannot be computed, so they are not shown.",
    files: [
      "src/context/CartContext.jsx",
      "src/context/WishlistContext.jsx",
    ],
    status: "not-started",
  },
  {
    title: "There is no payment gateway",
    detail:
      "OrderPage.jsx offers an ONLINE radio labelled \"Pay instantly via gateway\", but nothing is integrated and the submit path is identical to COD. Until a gateway exists, PAID is a bookkeeping fact an operator records by hand on the order.",
    files: ["src/pages/OrderPage.jsx"],
    status: "not-started",
  },
];

const COUNTS: Record<CutoverStatus, number> = { env: 0, code: 0, "not-started": 0 };
for (const item of ITEMS) COUNTS[item.status] += 1;

export function CutoverTab() {
  return (
    <div className="space-y-3">
      <div className="surface p-4">
        <div className="flex items-start gap-2.5">
          <Plug className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <div className="space-y-2 text-xs leading-relaxed">
            <p>
              <span className="font-medium">
                Nothing edited in this admin panel appears on the live
                storefront.
              </span>{" "}
              The shop is a Vite single-page app that imports static JavaScript
              modules from <code className="font-mono">src/data/</code> at build
              time. This panel writes to a Postgres database the shop has never
              heard of. Until the items below are done, every save here changes
              this database and nothing else.
            </p>
            <p className="text-muted-foreground">
              Each item was checked against the storefront source. Paths are
              relative to{" "}
              <code className="font-mono">../e-commerce_frontend-main</code>.
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t pt-3">
          {(Object.keys(STATUS_META) as CutoverStatus[]).map((status) => (
            <div key={status} className="flex items-center gap-1.5">
              <StatusPill
                label={STATUS_META[status].label}
                tone={STATUS_META[status].tone}
              />
              <span data-numeric className="text-xs font-medium">
                {COUNTS[status]}
              </span>
              <span className="text-muted-foreground text-[11px]">
                {STATUS_META[status].blurb}
              </span>
            </div>
          ))}
        </div>
      </div>

      <Panel
        title="Checklist"
        description={`${ITEMS.length} items between this panel and the live shop`}
        bodyClassName="p-0"
      >
        <ol className="divide-y">
          {ITEMS.map((item, index) => (
            <li
              key={item.title}
              className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 py-3 md:grid-cols-[1.5rem_minmax(0,1fr)_7.5rem]"
            >
              <span
                data-numeric
                className="text-muted-foreground pt-0.5 text-xs"
              >
                {index + 1}.
              </span>

              <div className="min-w-0 space-y-1.5">
                <h3 className="text-xs font-semibold">{item.title}</h3>
                <p className="text-muted-foreground max-w-prose text-[11px] leading-relaxed">
                  {item.detail}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {item.files.map((file) => (
                    <code
                      key={file}
                      className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-mono text-[10px]"
                    >
                      {file}
                    </code>
                  ))}
                </div>
              </div>

              <div className="col-start-2 md:col-start-3 md:justify-self-end">
                <StatusPill
                  label={STATUS_META[item.status].label}
                  tone={STATUS_META[item.status].tone}
                />
              </div>
            </li>
          ))}
        </ol>
      </Panel>

      <Panel title="Also worth knowing" bodyClassName="p-4">
        <ul className="text-muted-foreground list-disc space-y-1.5 pl-4 text-[11px] leading-relaxed">
          <li>
            The storefront cart bills <code className="font-mono">product.price</code>{" "}
            while product cards advertise{" "}
            <code className="font-mono">salePrice</code>. Ten products are
            affected, so a shopper is charged more than the card showed. Reading
            prices from this API fixes it, because the API sends one effective
            price per line.
          </li>
          <li>
            Three places disagree about free shipping: OrderPage.jsx hardcodes
            ₹2,000, the homepage trust badge advertises ₹10,000, and CartPage
            shows ₹0 shipping unconditionally. The value on the Store tab is the
            one this panel and its order endpoint use.
          </li>
        </ul>
      </Panel>
    </div>
  );
}
