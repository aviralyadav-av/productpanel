import { db } from "@/lib/db";
import { toPublicPage } from "@/lib/serializers/public";
import { notFoundJson, publicJson } from "../../_lib/response";

/**
 * GET /api/v1/pages/:slug
 *
 * Replaces getFooterPage(slug), which returns footerPagesData[slug] || null for
 * about, our-story, contact, shipping-returns, size-guide, faq, privacy-policy
 * and terms-of-use.
 *
 * The FAQ page is special: its questions were imported as first-class Faq rows
 * so they can be reordered and toggled independently, and they are stitched
 * back into the `faqs` key here because FAQPage.jsx reads `data.faqs`.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const page = await db.cmsPage.findFirst({
    where: { slug, status: "PUBLISHED" },
  });

  if (!page) return notFoundJson("Page");

  const faqs =
    slug === "faq"
      ? await db.faq.findMany({
          where: { enabled: true },
          orderBy: { position: "asc" },
          select: { question: true, answer: true },
        })
      : [];

  return publicJson(toPublicPage(page, faqs));
}
