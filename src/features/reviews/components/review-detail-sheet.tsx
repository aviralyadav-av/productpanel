"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { CheckCircle2, MessageSquareReply, Star, StarOff, Trash2, XCircle } from "lucide-react";

import { formatIstDateTime } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { HtmlPreview } from "@/components/shared/html-preview";
import { KeyValueList } from "@/components/shared/key-value-list";
import { PermissionGate } from "@/components/shared/permission-gate";
import { ProductThumb } from "@/components/shared/product-thumb";
import { StatusPill } from "@/components/shared/status-badge";
import { StatusTimeline } from "@/components/shared/status-timeline";
import { useActionToast } from "@/components/shared/use-action-toast";
import { useQueryNav } from "@/hooks/use-query-nav";

import { deleteReviewAction, setReviewFeaturedAction, setReviewStatusAction } from "@/features/reviews/actions";
import { RatingStars } from "@/features/reviews/components/rating-stars";
import { ImageLightbox, ReplyDialog, ReviewImageStrip } from "@/features/reviews/components/review-dialogs";
import { ReviewStatusBadge } from "@/features/reviews/components/review-table";
import type { ReviewDetail } from "@/features/reviews/types";

/**
 * `?review=<id>` opens this sheet over the list. The id lives in the URL so a
 * moderator can paste a link to a specific review; closing removes the param.
 */
export function ReviewDetailSheet({ review }: { review: ReviewDetail | null }) {
  const router = useRouter();
  const { navigate } = useQueryNav();
  const { run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();
  const [lightboxIndex, setLightboxIndex] = React.useState<number | null>(null);
  const [replyOpen, setReplyOpen] = React.useState(false);

  function close() {
    navigate({ review: null });
  }

  if (!review) return null;

  async function setStatus(status: "APPROVED" | "REJECTED") {
    if (!review) return;
    await run(() => setReviewStatusAction({ id: review.id, status }), { onSuccess: () => router.refresh() });
  }

  async function toggleFeatured() {
    if (!review) return;
    await run(() => setReviewFeaturedAction({ id: review.id, isFeatured: !review.isFeatured }), { onSuccess: () => router.refresh() });
  }

  async function remove() {
    if (!review) return;
    const result = await confirm({
      title: `Delete the review by ${review.authorName}?`,
      description: "The review and its photos are removed and ratings are recomputed. This cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
      requireReason: { label: "Reason (kept in the audit log)" },
    });
    if (!result.ok) return;
    await run(() => deleteReviewAction(review.id, result.reason), {
      onSuccess: () => {
        close();
        router.refresh();
      },
    });
  }

  return (
    <Sheet open onOpenChange={(open) => (!open ? close() : undefined)}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl">
        <SheetHeader className="border-b">
          <div className="flex items-start justify-between gap-3 pr-6">
            <div className="min-w-0">
              <SheetTitle className="truncate">{review.title || `Review by ${review.authorName}`}</SheetTitle>
              <SheetDescription>
                {review.authorName}
                {review.authorLocation ? ` · ${review.authorLocation}` : ""} · {formatIstDateTime(new Date(review.createdAt))}
              </SheetDescription>
            </div>
            <ReviewStatusBadge status={review.status} />
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <RatingStars rating={review.rating} size={14} />
            {review.isVerifiedPurchase ? <StatusPill label="Verified purchase" tone="success" dot={false} /> : null}
            {review.isFeatured ? <StatusPill label="Featured" tone="warning" dot={false} /> : null}
            {review.isTestimonial ? <StatusPill label="Testimonial" tone="brand" dot={false} /> : null}
          </div>
        </SheetHeader>

        <div className="space-y-5 px-4 py-4">
          <PermissionGate require={["reviews.moderate", "reviews.reply", "reviews.delete"]}>
            <div className="flex flex-wrap gap-2">
              <PermissionGate require="reviews.moderate">
                {review.status !== "APPROVED" ? (
                  <Button size="sm" onClick={() => void setStatus("APPROVED")}>
                    <CheckCircle2 /> Approve
                  </Button>
                ) : null}
                {review.status !== "REJECTED" ? (
                  <Button size="sm" variant="outline" onClick={() => void setStatus("REJECTED")}>
                    <XCircle /> Reject
                  </Button>
                ) : null}
                <Button size="sm" variant="outline" onClick={() => void toggleFeatured()}>
                  {review.isFeatured ? <StarOff /> : <Star />}
                  {review.isFeatured ? "Unfeature" : "Feature"}
                </Button>
              </PermissionGate>
              <PermissionGate require="reviews.reply">
                <Button size="sm" variant="outline" onClick={() => setReplyOpen(true)}>
                  <MessageSquareReply /> {review.reply ? "Edit reply" : "Reply"}
                </Button>
              </PermissionGate>
              <PermissionGate require="reviews.delete">
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void remove()}>
                  <Trash2 /> Delete
                </Button>
              </PermissionGate>
            </div>
          </PermissionGate>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold">Review</h3>
            <HtmlPreview html={review.body} title="Review body" minHeight={80} />
            {review.images.length > 0 ? (
              <div className="pt-1">
                <ReviewImageStrip images={review.images} onOpen={setLightboxIndex} size={56} />
              </div>
            ) : null}
          </section>

          {review.reply ? (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold">Public reply</h3>
              <div className="bg-muted/40 rounded-md border p-3">
                <HtmlPreview html={review.reply} title="Reply" minHeight={40} />
                <p className="text-muted-foreground mt-2 text-[11px]">
                  {review.repliedBy ?? "Staff"}
                  {review.repliedAt ? ` · ${formatIstDateTime(new Date(review.repliedAt))}` : ""}
                </p>
              </div>
            </section>
          ) : null}

          <Separator />

          <section className="space-y-2">
            <h3 className="text-xs font-semibold">Context</h3>
            {review.productId ? (
              <Link href={`/admin/products/${review.productId}` as Route} className="flex items-center gap-2.5 hover:underline">
                <ProductThumb src={review.productImageUrl} alt={review.productTitle ?? "Product"} size={40} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{review.productTitle}</span>
                  {review.productSlug ? <span className="text-muted-foreground block truncate font-mono text-[11px]">/{review.productSlug}</span> : null}
                </span>
              </Link>
            ) : null}
            <KeyValueList
              dense
              items={[
                {
                  label: "Seller",
                  value: review.sellerId ? (
                    <Link href={`/admin/sellers/${review.sellerId}` as Route} className="hover:underline">
                      {review.sellerName ?? review.sellerId}
                    </Link>
                  ) : (
                    "Platform"
                  ),
                },
                {
                  label: "Customer",
                  value: review.customer ? (
                    <Link href={`/admin/customers/${review.customer.id}` as Route} className="hover:underline">
                      {review.customer.name ?? review.customer.email}
                    </Link>
                  ) : (
                    "Guest / anonymous"
                  ),
                },
                {
                  label: "Order",
                  value: review.order ? (
                    <Link href={`/admin/orders/${review.order.id}` as Route} className="font-mono hover:underline">
                      {review.order.orderNumber}
                    </Link>
                  ) : (
                    "—"
                  ),
                },
                { label: "Helpful votes", value: String(review.helpfulCount), numeric: true },
                { label: "Review id", value: <span className="font-mono text-[11px]">{review.id}</span> },
              ]}
            />
          </section>

          <Separator />

          <section className="space-y-2">
            <h3 className="text-xs font-semibold">History</h3>
            <StatusTimeline
              emptyText="No moderation activity yet."
              events={review.activity.map((row) => ({
                id: row.id,
                title: row.summary,
                description: row.action,
                actor: row.actor,
                at: new Date(row.at),
                tone: row.action.includes("delete") ? "danger" : row.action.includes("status") ? "info" : "neutral",
              }))}
            />
          </section>
        </div>

        {confirmDialog}
        <ImageLightbox images={review.images} index={lightboxIndex} onClose={() => setLightboxIndex(null)} onIndexChange={setLightboxIndex} />
        <ReplyDialog
          review={replyOpen ? { id: review.id, authorName: review.authorName, reply: review.reply } : null}
          onOpenChange={(open) => setReplyOpen(open)}
          onSaved={() => router.refresh()}
        />
      </SheetContent>
    </Sheet>
  );
}
