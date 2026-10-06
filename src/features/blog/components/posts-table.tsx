"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Archive, Copy, MoreHorizontal, Newspaper, Pencil, Send, Star, StarOff, Trash2, Undo2 } from "lucide-react";

import { formatIstDateTime } from "@/lib/dates";
import { BLOG_STATUS_META, type BlogStatus } from "@/lib/enums";
import type { ListParams, PageMeta } from "@/lib/list-params";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { PaginationBar } from "@/components/shared/list-controls";
import { ProductThumb } from "@/components/shared/product-thumb";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { SortableTh } from "@/components/shared/sortable-th";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";

import { formatReadingTime } from "@/features/pages/text";

import { deleteBlogPostAction, duplicateBlogPostAction, setBlogPostFeaturedAction, setBlogPostStatusAction } from "../actions";
import type { BlogPostListRow } from "../schemas";

/**
 * /admin/blog list body. Shows the stored status and, when it differs, what
 * the storefront currently renders (a scheduled post whose time has passed).
 */
export function PostsTable({ rows, meta, params, canManage, canPublish, filtered }: { rows: BlogPostListRow[]; meta: PageMeta; params: ListParams; canManage: boolean; canPublish: boolean; filtered: boolean }) {
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const { pending, run } = useActionToast();

  const setStatus = (row: BlogPostListRow, status: BlogStatus) => run(() => setBlogPostStatusAction(row.id, { status }), { onSuccess: () => router.refresh() });
  const toggleFeatured = (row: BlogPostListRow) => run(() => setBlogPostFeaturedAction(row.id, !row.isFeatured), { onSuccess: () => router.refresh() });
  const duplicate = (row: BlogPostListRow) => run(() => duplicateBlogPostAction(row.id), { onSuccess: (data) => router.push(`/admin/blog/${data.id}` as Route) });

  async function remove(row: BlogPostListRow) {
    const answer = await confirm({
      title: `Delete "${row.title}"?`,
      description: "The post and its content are removed permanently. Archive it instead if you may want it back.",
      confirmLabel: "Delete post",
      destructive: true,
    });
    if (!answer.ok) return;
    await run(() => deleteBlogPostAction(row.id), { onSuccess: () => router.refresh() });
  }

  if (rows.length === 0) {
    return <EmptyState icon={Newspaper} title={filtered ? "No posts match these filters" : "No posts yet"} description={filtered ? "Clear the search or pick another status." : "Write the first post with New post; drafts stay invisible until published."} />;
  }

  const statusPills = (row: BlogPostListRow) => {
    const meta = BLOG_STATUS_META[row.status];
    const live = BLOG_STATUS_META[row.effectiveStatus];
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <StatusPill label={meta.label} tone={meta.tone} />
        {row.effectiveStatus !== row.status ? <StatusPill label={`Live: ${live.label}`} tone={live.tone} dot={false} /> : null}
      </span>
    );
  };

  const actions = (row: BlogPostListRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${row.title}`} disabled={pending}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/admin/blog/${row.id}` as Route}>
            <Pencil /> {canManage ? "Edit" : "View"}
          </Link>
        </DropdownMenuItem>
        {canPublish ? (
          <>
            <DropdownMenuSeparator />
            {row.status !== "PUBLISHED" ? (
              <DropdownMenuItem onSelect={() => void setStatus(row, "PUBLISHED")}>
                <Send /> Publish now
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => void setStatus(row, "DRAFT")}>
                <Undo2 /> Unpublish
              </DropdownMenuItem>
            )}
            {row.status !== "ARCHIVED" ? (
              <DropdownMenuItem onSelect={() => void setStatus(row, "ARCHIVED")}>
                <Archive /> Archive
              </DropdownMenuItem>
            ) : null}
          </>
        ) : null}
        {canManage ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void toggleFeatured(row)}>
              {row.isFeatured ? <StarOff /> : <Star />} {row.isFeatured ? "Unfeature" : "Feature"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void duplicate(row)}>
              <Copy /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => void remove(row)}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <>
      <ResponsiveTable
        table={
          <DataTable>
            <DataTableHead>
              <SortableTh column="title" label="Post" currentSort={params.sort} currentOrder={params.order} defaultOrder="asc" />
              <SortableTh column="status" label="Status" currentSort={params.sort} currentOrder={params.order} defaultOrder="asc" />
              <Th>Category</Th>
              <Th>Tags</Th>
              <Th>Author</Th>
              <SortableTh column="viewCount" label="Views" currentSort={params.sort} currentOrder={params.order} align="right" />
              <SortableTh column="publishedAt" label="Published" currentSort={params.sort} currentOrder={params.order} />
              <SortableTh column="updatedAt" label="Updated" currentSort={params.sort} currentOrder={params.order} />
              <Th align="right" width="3rem">
                <span className="sr-only">Actions</span>
              </Th>
            </DataTableHead>
            <DataTableBody>
              {rows.map((row) => (
                <Tr key={row.id}>
                  <Td>
                    <div className="flex min-w-0 items-center gap-2">
                      <ProductThumb src={row.featuredImage?.thumbnailUrl ?? row.featuredImage?.url ?? null} alt={row.featuredImage?.alt ?? ""} size={36} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Link href={`/admin/blog/${row.id}` as Route} className="truncate font-medium hover:underline">
                            {row.title}
                          </Link>
                          {row.isFeatured ? <Star className="text-warning size-3 shrink-0 fill-current" aria-label="Featured" /> : null}
                        </div>
                        <p className="text-muted-foreground truncate font-mono text-[11px]">
                          /blog/{row.slug} · {formatReadingTime(row.readingMinutes)}
                        </p>
                      </div>
                    </div>
                  </Td>
                  <Td>{statusPills(row)}</Td>
                  <Td className="text-muted-foreground">{row.category?.name ?? "—"}</Td>
                  <Td className="text-muted-foreground max-w-48 truncate">{row.tags.length > 0 ? row.tags.join(", ") : "—"}</Td>
                  <Td className="text-muted-foreground max-w-40 truncate">{row.authorName ?? "—"}</Td>
                  <Td align="right" numeric>
                    {row.viewCount.toLocaleString("en-IN")}
                  </Td>
                  <Td className="text-muted-foreground whitespace-nowrap">{row.publishedAt ? formatIstDateTime(row.publishedAt) : "—"}</Td>
                  <Td className="text-muted-foreground whitespace-nowrap">{formatIstDateTime(row.updatedAt)}</Td>
                  <Td align="right">{actions(row)}</Td>
                </Tr>
              ))}
            </DataTableBody>
          </DataTable>
        }
        cards={rows.map((row) => (
          <MobileCard key={row.id} title={row.title} subtitle={`/blog/${row.slug}`} meta={statusPills(row)} href={`/admin/blog/${row.id}`}>
            <MobileCardField label="Category">{row.category?.name ?? "—"}</MobileCardField>
            <MobileCardField label="Author">{row.authorName ?? "—"}</MobileCardField>
            <MobileCardField label="Published">{row.publishedAt ? formatIstDateTime(row.publishedAt) : "—"}</MobileCardField>
            <MobileCardField label="Views" numeric>
              {row.viewCount.toLocaleString("en-IN")}
            </MobileCardField>
          </MobileCard>
        ))}
      />
      <PaginationBar meta={meta} itemLabel="posts" />
      {confirmDialog}
    </>
  );
}
