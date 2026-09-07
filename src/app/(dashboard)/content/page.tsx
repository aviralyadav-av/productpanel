import type { Metadata } from "next";

import { requireAdmin } from "@/lib/auth/guards";
import {
  one,
  parseListParams,
  type SearchParams,
} from "@/lib/list-params";
import { REVIEW_STATUSES, type ReviewStatus } from "@/lib/enums";
import { PageHeader } from "@/components/shared/page-header";
import { FilterTabs } from "@/components/shared/list-controls";
import {
  getCmsPages,
  getContentCounts,
  getFaqs,
  getFooter,
  getMedia,
  getReviews,
  getSections,
} from "@/features/content/queries";
import { FaqTab } from "@/features/content/components/faq-tab";
import { FooterTab } from "@/features/content/components/footer-tab";
import { HomepageTab } from "@/features/content/components/homepage-tab";
import { MediaTab } from "@/features/content/components/media-tab";
import { PagesTab } from "@/features/content/components/pages-tab";
import { ReviewsTab } from "@/features/content/components/reviews-tab";

export const metadata: Metadata = { title: "Content" };

/**
 * One route, six tabs, driven by ?tab= - the same shape as Settings and
 * Products.
 *
 * Homepage sections, static pages, FAQ, footer, media and reviews are each
 * one screen's worth of content for a single-brand store. Six sidebar entries
 * for six mostly-short lists would be navigation for its own sake; as tabs
 * they stay one click apart and share this page's header.
 *
 * The tab keys are part of the app's public surface: every Server Action in
 * features/content/actions.ts revalidates "/content", and the dashboard's
 * quick actions link straight to ?tab=homepage.
 */
const TABS = [
  {
    value: "homepage",
    label: "Homepage",
    description:
      "The sections the storefront home page is built from, in the order they render. Reorder them, edit their copy, and add or remove the items inside each one.",
  },
  {
    value: "pages",
    label: "Pages",
    description:
      "The static pages the footer links to - About, Contact, Shipping, Returns and the rest - with their body blocks and SEO metadata.",
  },
  {
    value: "faq",
    label: "FAQ",
    description:
      "Questions and answers, grouped and ordered exactly as the storefront's FAQ accordion renders them.",
  },
  {
    value: "footer",
    label: "Footer",
    description:
      "The brand blurb, the link columns, the social profiles and the copyright line at the bottom of every storefront page.",
  },
  {
    value: "media",
    label: "Media",
    description:
      "Every image and video this store references, where it came from, and what is using it.",
  },
  {
    value: "reviews",
    label: "Reviews",
    description:
      "Product reviews awaiting moderation, and the testimonials the homepage quotes.",
  },
] as const;

type ContentTab = (typeof TABS)[number]["value"];

function resolveTab(raw: string | undefined): ContentTab {
  const match = TABS.find((tab) => tab.value === raw);
  return match?.value ?? "homepage";
}

function resolveReviewStatus(raw: string | undefined): ReviewStatus | undefined {
  return (REVIEW_STATUSES as readonly string[]).includes(raw ?? "")
    ? (raw as ReviewStatus)
    : undefined;
}

export default async function ContentPage({
  searchParams,
}: PageProps<"/content">) {
  await requireAdmin();

  const params = (await searchParams) as SearchParams;
  const tab = resolveTab(one(params, "tab"));
  const counts = await getContentCounts();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Content"
        description={TABS.find((entry) => entry.value === tab)?.description}
      >
        <FilterTabs
          paramKey="tab"
          allLabel="Homepage"
          options={TABS.filter((entry) => entry.value !== "homepage").map(
            (entry) => ({
              value: entry.value,
              label: entry.label,
              count:
                entry.value === "pages"
                  ? counts.pages
                  : entry.value === "faq"
                    ? counts.faqs
                    : entry.value === "media"
                      ? counts.media
                      : entry.value === "reviews"
                        ? counts.reviews
                        : undefined,
            }),
          )}
        />
      </PageHeader>

      {tab === "pages" ? (
        <PagesSection />
      ) : tab === "faq" ? (
        <FaqSection params={params} />
      ) : tab === "footer" ? (
        <FooterSection />
      ) : tab === "media" ? (
        <MediaSection params={params} />
      ) : tab === "reviews" ? (
        <ReviewsSection params={params} />
      ) : (
        <HomepageSection />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

async function HomepageSection() {
  return <HomepageTab sections={await getSections()} />;
}

async function PagesSection() {
  return (
    <div className="surface overflow-hidden">
      <PagesTab pages={await getCmsPages()} />
    </div>
  );
}

async function FaqSection({ params }: { params: SearchParams }) {
  const q = (one(params, "q") ?? "").trim();
  const group = one(params, "group");
  const data = await getFaqs({ q, group });

  return (
    <div className="surface overflow-hidden">
      <FaqTab
        faqs={data.rows}
        groups={data.groups}
        total={data.total}
        filtered={Boolean(q || group)}
      />
    </div>
  );
}

async function FooterSection() {
  return (
    <div className="surface overflow-hidden">
      <FooterTab footer={await getFooter()} />
    </div>
  );
}

async function MediaSection({ params }: { params: SearchParams }) {
  const list = parseListParams(params, {
    defaultSort: "createdAt",
    defaultOrder: "desc",
    pageSize: 24,
  });

  const data = await getMedia({
    list,
    kind: one(params, "kind"),
    folder: one(params, "folder"),
  });

  return (
    <div className="surface overflow-hidden">
      <MediaTab
        rows={data.rows}
        meta={data.meta}
        kinds={data.kinds}
        folders={data.folders}
        total={data.total}
      />
    </div>
  );
}

async function ReviewsSection({ params }: { params: SearchParams }) {
  const list = parseListParams(params, {
    defaultSort: "createdAt",
    defaultOrder: "desc",
    pageSize: 25,
  });

  const status = resolveReviewStatus(one(params, "status"));
  const data = await getReviews({ list, status });

  return (
    <div className="surface overflow-hidden">
      <ReviewsTab
        rows={data.rows}
        meta={data.meta}
        statusCounts={data.statusCounts}
        total={data.total}
        isFiltered={Boolean(list.q || status)}
      />
    </div>
  );
}
