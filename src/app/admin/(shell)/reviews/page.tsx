import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { MessageSquareQuote, SearchX, Star } from "lucide-react";

import { requirePermission } from "@/lib/auth/guards";
import { REVIEW_STATUSES, REVIEW_STATUS_META } from "@/lib/enums";
import { one, parseListParams, type SearchParams } from "@/lib/list-params";
import { formatNumber } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { DataTableToolbar } from "@/components/shared/data-table-toolbar";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterTabs, PaginationBar, SearchInput } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGate } from "@/components/shared/permission-gate";
import { StatCard } from "@/components/shared/stat-card";

import { ReviewDetailSheet } from "@/features/reviews/components/review-detail-sheet";
import { ReviewExportButton, ReviewFilters } from "@/features/reviews/components/review-filters";
import { ReviewTable } from "@/features/reviews/components/review-table";
import { NewTestimonialButton, TestimonialTable } from "@/features/reviews/components/testimonials-tab";
import { getReviewDetail, getReviewFilterRefs, listReviews, listTestimonials, reviewKpis, reviewStatusCounts } from "@/features/reviews/queries";
import { hasReviewFilters, parseReviewFilters, parseReviewSort, parseReviewTab } from "@/features/reviews/schemas";

export const metadata: Metadata = { title: "Reviews" };

/**
 * /admin/reviews (blueprint §1 Reviews, §14.E1 testimonials). Two tabs share
 * the URL state: product reviews awaiting moderation and the hand-entered
 * testimonials the homepage quotes. `?review=<id>` opens the detail sheet;
 * `?product=`, `?seller=` and `?customer=` are the deep links other modules
 * use ("Open in Reviews").
 */
export default async function ReviewsPage({ searchParams }: PageProps<"/admin/reviews">) {
  await requirePermission("reviews.view");

  const params = (await searchParams) as SearchParams;
  const list = parseListParams(params, { defaultSort: "createdAt", defaultOrder: "desc", pageSize: 25 });
  const sort = parseReviewSort(list.sort);
  const filters = parseReviewFilters(params);
  const tab = parseReviewTab(one(params, "tab"));
  const openId = one(params, "review");

  const [kpis, counts, result, refs, detail] = await Promise.all([
    reviewKpis(),
    reviewStatusCounts(filters, tab === "testimonials"),
    tab === "testimonials" ? listTestimonials(list, filters) : listReviews({ ...list, sort }, filters),
    getReviewFilterRefs(filters),
    openId ? getReviewDetail(openId) : Promise.resolve(null),
  ]);

  const tabHref = (next: "reviews" | "testimonials") => (next === "reviews" ? "/admin/reviews" : "/admin/reviews?tab=testimonials") as Route;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reviews"
        description="Moderate what shoppers write about products, reply publicly, feature the best ones, and curate the testimonials the homepage quotes. Ratings on products and sellers are recomputed from approved reviews."
        actions={
          tab === "testimonials" ? (
            <PermissionGate require="reviews.moderate">
              <NewTestimonialButton />
            </PermissionGate>
          ) : (
            <ReviewExportButton />
          )
        }
      />

      <section aria-label="Review metrics" className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <StatCard label="Pending moderation" value={formatNumber(kpis.pending)} href={"/admin/reviews?status=PENDING" as Route} higherIsBetter={false} />
        <StatCard label="Approved" value={formatNumber(kpis.approved)} href={"/admin/reviews?status=APPROVED" as Route} />
        <StatCard label="Average rating" value={kpis.approved > 0 ? kpis.averageRating.toFixed(2) : "—"} hint="Across approved product reviews" />
        <StatCard label="Featured" value={formatNumber(kpis.featured)} href={"/admin/reviews?featured=1" as Route} />
        <StatCard label="Testimonials" value={formatNumber(kpis.testimonials)} href={tabHref("testimonials")} />
      </section>

      <div className="surface overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
          <nav aria-label="Review tabs" className="bg-muted inline-flex items-center gap-0.5 rounded-lg p-0.5">
            {(["reviews", "testimonials"] as const).map((item) => (
              <Link
                key={item}
                href={tabHref(item)}
                aria-current={tab === item ? "page" : undefined}
                className={
                  tab === item
                    ? "bg-background text-foreground rounded-md px-2.5 py-1 text-xs font-medium shadow-xs"
                    : "text-muted-foreground hover:text-foreground rounded-md px-2.5 py-1 text-xs font-medium"
                }
              >
                {item === "reviews" ? "Product reviews" : "Testimonials"}
              </Link>
            ))}
          </nav>
        </div>

        <DataTableToolbar
          search={<SearchInput placeholder={tab === "testimonials" ? "Search author or quote…" : "Search author, title, text or product…"} />}
          filters={
            <>
              <FilterTabs
                paramKey="status"
                allLabel={`All ${counts.all}`}
                options={REVIEW_STATUSES.map((status) => ({ value: status, label: REVIEW_STATUS_META[status].label, count: counts[status] }))}
              />
              <ReviewFilters refs={refs} showStatusFilters={tab === "reviews"} />
            </>
          }
        />

        {result.rows.length === 0 ? (
          hasReviewFilters(filters) ? (
            <EmptyState
              icon={SearchX}
              title={tab === "testimonials" ? "No testimonials match these filters" : "No reviews match these filters"}
              description="Try a different search, or clear the filters."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href={tabHref(tab)}>Clear filters</Link>
                </Button>
              }
            />
          ) : tab === "testimonials" ? (
            <EmptyState
              icon={MessageSquareQuote}
              title="No testimonials yet"
              description="Add customer quotes here; the homepage testimonials section shows approved ones in position order."
              action={
                <PermissionGate require="reviews.moderate">
                  <NewTestimonialButton />
                </PermissionGate>
              }
            />
          ) : (
            <EmptyState
              icon={Star}
              title="No reviews yet"
              description="Reviews arrive from the storefront (POST /api/v1/products/:slug/reviews) and land here as pending."
            />
          )
        ) : (
          <>
            {tab === "testimonials" ? <TestimonialTable rows={result.rows} /> : <ReviewTable rows={result.rows} sort={sort} order={list.order} />}
            <PaginationBar meta={result.meta} itemLabel={tab === "testimonials" ? "testimonials" : "reviews"} />
          </>
        )}
      </div>

      <ReviewDetailSheet review={detail} />
    </div>
  );
}
