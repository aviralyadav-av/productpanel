import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";

import { can, requirePermission } from "@/lib/auth/guards";
import type { SearchParams } from "@/lib/list-params";
import { PageHeader } from "@/components/shared/page-header";

import { FaqsBoard } from "@/features/faqs/components/faqs-board";
import { FaqsToolbar } from "@/features/faqs/components/faqs-toolbar";
import { getFaqBoard } from "@/features/faqs/queries";
import { isFaqFiltered, parseFaqListFilters } from "@/features/faqs/schemas";

export const metadata: Metadata = { title: "FAQs" };

/**
 * /admin/faqs (blueprint §1 FAQs, §4.8 Faq): one board, grouped exactly as the
 * storefront accordion renders it. There is no pagination and no detail route -
 * the whole set is a few dozen rows and the value is in seeing the order.
 */
export default async function FaqsPage({ searchParams }: PageProps<"/admin/faqs">) {
  const actor = await requirePermission("faqs.view");

  const raw = (await searchParams) as SearchParams;
  const filters = parseFaqListFilters(raw);
  const data = await getFaqBoard(filters);

  return (
    <div className="space-y-4">
      <PageHeader
        title="FAQs"
        description={
          <>
            Questions and answers, grouped and ordered exactly as the storefront accordion renders them. The FAQ page itself is a CMS page -{" "}
            <Link href={"/admin/pages?template=FAQ" as Route} className="underline underline-offset-2">
              edit its intro under Pages
            </Link>
            .
          </>
        }
      />

      <FaqsToolbar groups={data.allGroups} />

      <FaqsBoard data={data} canManage={can(actor, "faqs.manage")} filtered={isFaqFiltered(filters)} />
    </div>
  );
}
