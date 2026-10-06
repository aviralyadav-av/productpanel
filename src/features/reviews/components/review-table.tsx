"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { CheckCircle2, MessageSquareReply, MoreHorizontal, ShieldCheck, Star, StarOff, Trash2, XCircle } from "lucide-react";

import { REVIEW_STATUSES, REVIEW_STATUS_META, type ReviewStatus } from "@/lib/enums";
import { formatIstDate } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BulkActionBar, type BulkAction } from "@/components/shared/bulk-action-bar";
import { ColumnVisibilityMenu, useColumnVisibility } from "@/components/shared/column-visibility";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { usePermission } from "@/components/shared/permission-gate";
import { ProductThumb } from "@/components/shared/product-thumb";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { RowCheckbox, useRowSelection } from "@/components/shared/row-selection";
import { SortableTh } from "@/components/shared/sortable-th";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";
import { useQueryNav } from "@/hooks/use-query-nav";

import { bulkReviewsAction, deleteReviewAction, setReviewFeaturedAction, setReviewStatusAction } from "@/features/reviews/actions";
import { RatingStars } from "@/features/reviews/components/rating-stars";
import { ImageLightbox, ReplyDialog, ReviewImageStrip } from "@/features/reviews/components/review-dialogs";
import { REVIEW_COLUMNS, type ReviewBulkOp } from "@/features/reviews/schemas";
import type { ReviewListRow } from "@/features/reviews/types";

/**
 * The moderation table (blueprint §1 Reviews). Client Component because
 * column visibility, row selection, the lightbox and the reply dialog live in
 * the browser; sorting, filtering, paging and the open detail sheet
 * (`?review=<id>`) stay in the URL.
 */

export function excerpt(text: string, max = 110): string {
  const plain = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

export function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  const meta = REVIEW_STATUS_META[status];
  return <StatusPill label={meta?.label ?? status} tone={meta?.tone ?? "neutral"} />;
}

export function ReviewTable({ rows, sort, order }: { rows: ReviewListRow[]; sort: string; order: "asc" | "desc" }) {
  const router = useRouter();
  const { hrefFor } = useQueryNav();
  const columns = useColumnVisibility("reviews", [...REVIEW_COLUMNS]);
  const selection = useRowSelection(rows.map((row) => row.id));
  const [confirm, confirmDialog] = useConfirm();
  const { run } = useActionToast();
  const canModerate = usePermission("reviews.moderate");
  const canReply = usePermission("reviews.reply");
  const canDelete = usePermission("reviews.delete");
  const show = columns.isVisible;

  const [lightbox, setLightbox] = React.useState<{ row: ReviewListRow; index: number } | null>(null);
  const [replying, setReplying] = React.useState<ReviewListRow | null>(null);

  async function setStatus(row: ReviewListRow, status: ReviewStatus) {
    await run(() => setReviewStatusAction({ id: row.id, status }), { onSuccess: () => router.refresh() });
  }

  async function toggleFeatured(row: ReviewListRow) {
    await run(() => setReviewFeaturedAction({ id: row.id, isFeatured: !row.isFeatured }), { onSuccess: () => router.refresh() });
  }

  async function remove(row: ReviewListRow) {
    const result = await confirm({
      title: `Delete the review by ${row.authorName}?`,
      description: "The review and its photos are removed and the product rating is recomputed. This cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
      requireReason: { label: "Reason (kept in the audit log)", placeholder: "Spam, abusive, duplicate…" },
    });
    if (!result.ok) return;
    await run(() => deleteReviewAction(row.id, result.reason), { onSuccess: () => router.refresh() });
  }

  async function bulk(op: ReviewBulkOp) {
    const ids = [...selection.selectedIds];
    const label = op === "approve" ? "Approve" : op === "reject" ? "Reject" : "Delete";
    const result = await confirm({
      title: `${label} ${ids.length} review${ids.length === 1 ? "" : "s"}?`,
      description: op === "delete" ? "Deleted reviews cannot be recovered; product ratings are recomputed." : "Product and seller ratings are recomputed from approved reviews.",
      confirmLabel: label,
      destructive: op !== "approve",
      requireReason: op === "delete" ? { label: "Reason (kept in the audit log)" } : undefined,
    });
    if (!result.ok) return;
    await run(() => bulkReviewsAction({ ids, op, reason: result.reason }), {
      onSuccess: () => {
        selection.clear();
        router.refresh();
      },
    });
  }

  const bulkActions: BulkAction[] = [
    { label: "Approve", icon: CheckCircle2, onSelect: () => bulk("approve"), permission: "reviews.moderate" },
    { label: "Reject", icon: XCircle, onSelect: () => bulk("reject"), destructive: true, permission: "reviews.moderate" },
    { label: "Delete", icon: Trash2, onSelect: () => bulk("delete"), destructive: true, permission: "reviews.delete" },
  ];
  const granted = new Set<string>([...(canModerate ? ["reviews.moderate"] : []), ...(canDelete ? ["reviews.delete"] : [])]);

  const detailHref = (row: ReviewListRow) => hrefFor({ review: row.id }) as Route;

  const table = (
    <DataTable>
      <DataTableHead>
        <Th width="2rem">
          <RowCheckbox {...selection.headerProps} label="Select all reviews on this page" />
        </Th>
        <SortableTh column="product" label="Product" currentSort={sort} currentOrder={order} defaultOrder="asc" />
        {show("author") ? <SortableTh column="author" label="Author" currentSort={sort} currentOrder={order} defaultOrder="asc" /> : null}
        {show("rating") ? <SortableTh column="rating" label="Rating" currentSort={sort} currentOrder={order} /> : null}
        <Th>Review</Th>
        {show("images") ? <Th>Photos</Th> : null}
        {show("flags") ? <Th>Flags</Th> : null}
        <SortableTh column="status" label="Status" currentSort={sort} currentOrder={order} defaultOrder="asc" />
        {show("replied") ? <Th>Replied</Th> : null}
        {show("date") ? <SortableTh column="createdAt" label="Submitted" currentSort={sort} currentOrder={order} /> : null}
        <Th width="3rem">
          <span className="sr-only">Actions</span>
        </Th>
      </DataTableHead>
      <DataTableBody>
        {rows.map((row) => (
          <Tr key={row.id} selected={selection.isSelected(row.id)}>
            <Td>
              <RowCheckbox {...selection.rowProps(row.id)} label={`Select review by ${row.authorName}`} />
            </Td>
            <Td>
              {row.productId ? (
                <Link href={`/admin/products/${row.productId}` as Route} className="flex items-center gap-2.5 hover:underline">
                  <ProductThumb src={row.productImageUrl} alt={row.productTitle ?? "Product"} size={32} />
                  <span className="block max-w-[14rem] truncate text-sm font-medium">{row.productTitle}</span>
                </Link>
              ) : (
                <span className="text-muted-foreground text-xs">Deleted product</span>
              )}
            </Td>
            {show("author") ? (
              <Td>
                {row.customerId ? (
                  <Link href={`/admin/customers/${row.customerId}` as Route} className="block max-w-[10rem] truncate text-xs font-medium hover:underline">
                    {row.authorName}
                  </Link>
                ) : (
                  <span className="block max-w-[10rem] truncate text-xs">{row.authorName}</span>
                )}
                {row.authorLocation ? <span className="text-muted-foreground block truncate text-[11px]">{row.authorLocation}</span> : null}
              </Td>
            ) : null}
            {show("rating") ? (
              <Td>
                <RatingStars rating={row.rating} />
              </Td>
            ) : null}
            <Td>
              <Link href={detailHref(row)} scroll={false} className="block max-w-[22rem] hover:underline">
                {row.title ? <span className="block truncate text-xs font-medium">{row.title}</span> : null}
                <span className="text-muted-foreground block truncate text-xs">{excerpt(row.body)}</span>
              </Link>
            </Td>
            {show("images") ? (
              <Td>
                <ReviewImageStrip images={row.images} onOpen={(index) => setLightbox({ row, index })} />
              </Td>
            ) : null}
            {show("flags") ? (
              <Td>
                <div className="flex items-center gap-1.5">
                  {row.isVerifiedPurchase ? <StatusPill label="Verified" tone="success" dot={false} /> : null}
                  {row.isFeatured ? <Star className="fill-warning text-warning size-3.5" aria-label="Featured" /> : null}
                  {!row.isVerifiedPurchase && !row.isFeatured ? <span className="text-muted-foreground/70">—</span> : null}
                </div>
              </Td>
            ) : null}
            <Td>
              <ReviewStatusBadge status={row.status} />
            </Td>
            {show("replied") ? (
              <Td className="text-xs">
                {row.hasReply ? (
                  <span className="text-success inline-flex items-center gap-1">
                    <MessageSquareReply className="size-3.5" /> Replied
                  </span>
                ) : (
                  <span className="text-muted-foreground/70">—</span>
                )}
              </Td>
            ) : null}
            {show("date") ? <Td numeric className="text-xs">{formatIstDate(new Date(row.createdAt))}</Td> : null}
            <Td align="right">
              <RowActions
                row={row}
                canModerate={canModerate}
                canReply={canReply}
                canDelete={canDelete}
                detailHref={detailHref(row)}
                onStatus={setStatus}
                onFeature={toggleFeatured}
                onReply={setReplying}
                onDelete={remove}
              />
            </Td>
          </Tr>
        ))}
      </DataTableBody>
    </DataTable>
  );

  const cards = rows.map((row) => (
    <MobileCard
      key={row.id}
      href={detailHref(row)}
      title={row.productTitle ?? "Deleted product"}
      subtitle={`${row.authorName}${row.authorLocation ? ` · ${row.authorLocation}` : ""}`}
      meta={<ReviewStatusBadge status={row.status} />}
    >
      <MobileCardField label="Rating">
        <RatingStars rating={row.rating} />
      </MobileCardField>
      <MobileCardField label="Review">{excerpt(row.body, 80)}</MobileCardField>
      <MobileCardField label="Submitted">{formatIstDate(new Date(row.createdAt))}</MobileCardField>
      <MobileCardField label="Flags">
        {[row.isVerifiedPurchase ? "Verified" : null, row.isFeatured ? "Featured" : null, row.hasReply ? "Replied" : null].filter(Boolean).join(" · ") || "—"}
      </MobileCardField>
    </MobileCard>
  ));

  return (
    <>
      <div className="flex items-center justify-end border-b px-4 py-1.5">
        <ColumnVisibilityMenu {...columns.menuProps} />
      </div>
      <ResponsiveTable table={table} cards={cards} />
      <BulkActionBar count={selection.count} actions={bulkActions} onClear={selection.clear} permissions={granted} itemLabel="reviews selected" />
      {confirmDialog}
      <ImageLightbox
        images={lightbox?.row.images ?? []}
        index={lightbox?.index ?? null}
        onClose={() => setLightbox(null)}
        onIndexChange={(index) => setLightbox((current) => (current ? { ...current, index } : null))}
      />
      <ReplyDialog
        review={replying ? { id: replying.id, authorName: replying.authorName, reply: replying.reply } : null}
        onOpenChange={(open) => (!open ? setReplying(null) : undefined)}
        onSaved={() => router.refresh()}
      />
    </>
  );
}

function RowActions({
  row,
  canModerate,
  canReply,
  canDelete,
  detailHref,
  onStatus,
  onFeature,
  onReply,
  onDelete,
}: {
  row: ReviewListRow;
  canModerate: boolean;
  canReply: boolean;
  canDelete: boolean;
  detailHref: Route;
  onStatus: (row: ReviewListRow, status: ReviewStatus) => Promise<void>;
  onFeature: (row: ReviewListRow) => Promise<void>;
  onReply: (row: ReviewListRow) => void;
  onDelete: (row: ReviewListRow) => Promise<void>;
}) {
  const statusTargets = REVIEW_STATUSES.filter((status) => status !== row.status && status !== "PENDING");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`Actions for review by ${row.authorName}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="truncate text-xs">{row.authorName}</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href={detailHref} scroll={false}>
            Open details
          </Link>
        </DropdownMenuItem>
        {canModerate ? (
          <>
            <DropdownMenuSeparator />
            {statusTargets.map((status) => (
              <DropdownMenuItem key={status} variant={status === "REJECTED" ? "destructive" : "default"} onSelect={() => void onStatus(row, status)}>
                {status === "APPROVED" ? <CheckCircle2 /> : <XCircle />}
                {status === "APPROVED" ? "Approve" : "Reject"}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onSelect={() => void onFeature(row)}>
              {row.isFeatured ? <StarOff /> : <Star />}
              {row.isFeatured ? "Unfeature" : "Feature"}
            </DropdownMenuItem>
          </>
        ) : null}
        {canReply ? (
          <DropdownMenuItem onSelect={() => onReply(row)}>
            <MessageSquareReply />
            {row.hasReply ? "Edit reply" : "Reply"}
          </DropdownMenuItem>
        ) : null}
        {row.isVerifiedPurchase ? (
          <DropdownMenuItem disabled>
            <ShieldCheck />
            Verified purchase
          </DropdownMenuItem>
        ) : null}
        {canDelete ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => void onDelete(row)}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
