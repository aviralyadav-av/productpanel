import { Star } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EmptyState } from "@/components/shared/empty-state";
import { HtmlPreview } from "@/components/shared/html-preview";
import { ProductThumb } from "@/components/shared/product-thumb";
import { StatusPill } from "@/components/shared/status-badge";
import { sectionDefinition } from "@/features/content/registry";

import type { SectionPreviewData } from "../schemas";
import { SCHEDULE_STATE_META } from "./schedule-state";

/**
 * "What the website receives": the resolved `items[]` of one section, drawn
 * as the storefront would - product cards, category tiles, banner slides,
 * seller cards, reviews, badges - plus the effective `settings`. Server
 * compatible (no hooks) so the page can render it into the editor Sheet and
 * the REST preview route can return the same data as JSON.
 *
 * Items are `unknown[]` by contract (each resolver returns its own public
 * shape), so every card reads defensively through small guards instead of
 * trusting a type the resolver might change under us.
 */

type Rec = Record<string, unknown>;

const rec = (value: unknown): Rec => (value && typeof value === "object" ? (value as Rec) : {});
const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const imageUrl = (value: unknown): string | null => str(rec(value).url);

const rupees = (value: number) => `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

function ProductCard({ item }: { item: Rec }) {
  const price = num(item.effectivePrice);
  const list = num(item.price);
  const badges = Array.isArray(item.badges) ? item.badges.filter((badge): badge is string => typeof badge === "string") : [];
  return (
    <li className="surface flex gap-3 p-2">
      <ProductThumb src={imageUrl(item.image)} alt="" size={56} className="rounded-md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{str(item.title) ?? "Untitled product"}</p>
        <p className="text-muted-foreground truncate text-[11px]">{str(rec(item.seller).displayName) ?? "Platform"} · {str(rec(item.category).name) ?? "No category"}</p>
        <p className="text-xs" data-numeric>
          {price !== null ? rupees(price) : "—"}
          {list !== null && price !== null && list > price ? <span className="text-muted-foreground ml-1 line-through">{rupees(list)}</span> : null}
        </p>
        {badges.length > 0 ? <p className="text-brand text-[11px]">{badges.join(" · ")}</p> : null}
      </div>
    </li>
  );
}

function CategoryTile({ item }: { item: Rec }) {
  return (
    <li className="surface flex items-center gap-3 p-2">
      <ProductThumb src={imageUrl(item.image) ?? imageUrl(item.icon)} alt="" size={44} className="rounded-md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{str(item.name) ?? "Category"}</p>
        <p className="text-muted-foreground truncate font-mono text-[11px]">{str(item.url)}</p>
      </div>
      <span className="text-muted-foreground text-[11px]" data-numeric>
        {num(item.productCount) ?? 0} products
      </span>
    </li>
  );
}

function BannerSlide({ item }: { item: Rec }) {
  const link = rec(item.link);
  return (
    <li className="surface flex gap-3 p-2">
      <ProductThumb src={imageUrl(item.image)} alt="" size={56} className="rounded-md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{str(item.title) ?? "Banner"}</p>
        {str(item.subtitle) ? <p className="text-muted-foreground line-clamp-1 text-xs">{str(item.subtitle)}</p> : null}
        <p className="text-muted-foreground truncate text-[11px]">
          {str(item.buttonText) ? `"${str(item.buttonText)}" → ` : ""}
          {str(link.url) ?? (str(link.type) === "NONE" ? "no link" : "link target unavailable")}
        </p>
      </div>
    </li>
  );
}

function SellerCard({ item }: { item: Rec }) {
  return (
    <li className="surface flex items-center gap-3 p-2">
      <ProductThumb src={imageUrl(item.logo)} alt="" size={44} className="rounded-full" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{str(item.displayName) ?? "Seller"}</p>
        <p className="text-muted-foreground truncate text-[11px]">{[str(item.city), str(item.state)].filter(Boolean).join(", ") || str(item.url)}</p>
      </div>
      <span className="inline-flex items-center gap-1 text-[11px]" data-numeric>
        <Star className="fill-warning text-warning size-3" /> {(num(item.ratingAvg) ?? 0).toFixed(1)} ({num(item.reviewCount) ?? 0})
      </span>
    </li>
  );
}

function ReviewCard({ item }: { item: Rec }) {
  const rating = num(item.rating);
  return (
    <li className="surface space-y-1 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-medium">{str(item.authorName) ?? "Customer"}</p>
        {rating !== null ? <span className="text-[11px]" data-numeric>{"★".repeat(Math.round(rating))}</span> : null}
      </div>
      {str(item.title) ? <p className="text-xs font-medium">{str(item.title)}</p> : null}
      <p className="text-muted-foreground line-clamp-3 text-xs">{str(item.body)}</p>
      {str(rec(item.product).title) ? <p className="text-muted-foreground text-[11px]">on {str(rec(item.product).title)}</p> : null}
    </li>
  );
}

function BlockCard({ item }: { item: Rec }) {
  const { id, position, image, ...rest } = item;
  void id;
  void position;
  return (
    <li className="surface flex gap-3 p-2">
      {imageUrl(image) ? <ProductThumb src={imageUrl(image)} alt="" size={40} className="rounded-md" /> : null}
      <dl className="min-w-0 flex-1 space-y-0.5 text-xs">
        {Object.entries(rest).map(([key, value]) => (
          <div key={key} className="flex gap-2">
            <dt className="text-muted-foreground w-24 shrink-0 truncate font-mono text-[11px]">{key}</dt>
            <dd className="min-w-0 truncate">{value === null || value === "" ? <span className="text-muted-foreground">—</span> : String(value)}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

function FooterSummary({ item }: { item: Rec }) {
  const menus = Array.isArray(item.menus) ? item.menus.map(rec) : [];
  return (
    <li className="surface space-y-2 p-3 text-xs">
      <p className="text-sm font-medium">{str(item.brandName) ?? "Footer"}</p>
      <p className="text-muted-foreground line-clamp-2">{str(item.brandDescription)}</p>
      <ul className="grid gap-2 sm:grid-cols-3">
        {menus.map((menu, index) => (
          // The public payload is untyped JSON, so a slug can be missing. This
          // list is render-only and never reordered, so the index is a stable key.
          <li key={str(menu.slug) ?? `menu-${index}`} className="rounded-md border p-2">
            <p className="font-medium">{str(menu.name) ?? str(menu.slug)}</p>
            <p className="text-muted-foreground text-[11px]">{Array.isArray(menu.items) ? menu.items.length : 0} links</p>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground">{str(item.copyright)}</p>
    </li>
  );
}

function SettingsTable({ settings }: { settings: Record<string, unknown> }) {
  const entries = Object.entries(settings).filter(([key]) => key !== "html");
  if (entries.length === 0) return null;
  return (
    <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="flex gap-2">
          <dt className="text-muted-foreground w-32 shrink-0 truncate font-mono text-[11px]">{key}</dt>
          <dd className="min-w-0 truncate" data-numeric>
            {Array.isArray(value) ? `${value.length} id${value.length === 1 ? "" : "s"}` : value === null || value === "" ? <span className="text-muted-foreground">—</span> : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionPreview({ preview }: { preview: SectionPreviewData }) {
  const definition = sectionDefinition(preview.type);
  const state = SCHEDULE_STATE_META[preview.state];
  const items = preview.items.map(rec);
  const html = typeof preview.settings.html === "string" ? preview.settings.html : null;

  const Card = (() => {
    switch (definition.resolver) {
      case "products":
      case "collection":
        return ProductCard;
      case "categories":
        return CategoryTile;
      case "banners":
        return BannerSlide;
      case "sellers":
        return SellerCard;
      case "testimonials":
      case "featuredReviews":
        return ReviewCard;
      case "footer":
        return FooterSummary;
      case "blocks":
      default:
        return BlockCard;
    }
  })();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <StatusPill label={state.label} tone={state.tone} />
        <span className="text-muted-foreground">
          {preview.state === "live" ? "Included in GET /api/v1/home right now." : `Not sent to the website while ${state.label.toLowerCase()} - this is what it would contain.`}
        </span>
      </div>

      {preview.error ? (
        <Alert variant="destructive">
          <AlertTitle>The resolver failed</AlertTitle>
          <AlertDescription>{preview.error}</AlertDescription>
        </Alert>
      ) : null}

      <SettingsTable settings={preview.settings} />

      {html !== null ? <HtmlPreview html={html} title="Rendered content" /> : null}

      {definition.resolver === "stored" ? null : items.length === 0 ? (
        <EmptyState compact icon={definition.icon} title="Nothing to show" description={definition.resolver === "blocks" ? `No enabled ${definition.blockNoun}s inside their publish window.` : "The rule or list produced no eligible items - check the source, the picked ids, or whether the targets are published."} />
      ) : (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs">
            {items.length} item{items.length === 1 ? "" : "s"} · as returned by the <code className="font-mono">{preview.resolver}</code> resolver
          </p>
          <ul className={definition.resolver === "footer" || definition.resolver === "blocks" || definition.resolver === "testimonials" || definition.resolver === "featuredReviews" ? "space-y-2" : "grid gap-2 sm:grid-cols-2"}>
            {items.map((item, index) => (
              <Card key={str(item.id) ?? str(item.slug) ?? index} item={item} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
