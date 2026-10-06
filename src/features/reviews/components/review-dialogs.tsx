"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { FieldHint } from "@/components/shared/form-layout";
import { useActionToast } from "@/components/shared/use-action-toast";
import { resolveAssetUrl } from "@/lib/media";

import { replyToReviewAction } from "@/features/reviews/actions";
import type { ReviewImageRef } from "@/features/reviews/types";

/**
 * Small dialogs shared by the review table and the detail sheet.
 */

/**
 * Client-side tag strip so the reply editor shows the stored (already
 * sanitised) HTML as the plain text a moderator typed, instead of markup.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

export function ReplyDialog({
  review,
  onOpenChange,
  onSaved,
}: {
  review: { id: string; authorName: string; reply: string | null } | null;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const { run, pending } = useActionToast();
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const reviewId = review?.id;

  // Reset the draft whenever a different review opens.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync form draft with the review being edited
    setValue(review?.reply ? stripHtml(review.reply) : "");
    setError(null);
  }, [reviewId, review?.reply]);

  async function submit(clear: boolean) {
    if (!review) return;
    const result = await run(() => replyToReviewAction({ id: review.id, reply: clear ? null : value }), {
      onSuccess: () => {
        onOpenChange(false);
        onSaved?.();
      },
      onError: (failure) => setError(failure.ok ? null : failure.fieldErrors?.reply ?? failure.error),
    });
    return result;
  }

  return (
    <Dialog open={Boolean(review)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{review?.reply ? "Edit reply" : "Reply publicly"}</DialogTitle>
          <DialogDescription>
            Shown under {review?.authorName ?? "the"}&apos;s review on the storefront. Plain text; links and simple formatting are kept, anything else is stripped.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            rows={6}
            maxLength={4000}
            placeholder="Thank you for your feedback…"
            aria-invalid={Boolean(error)}
            aria-label="Reply"
          />
          {error ? <p className="text-destructive text-xs">{error}</p> : <FieldHint>{value.length}/4000</FieldHint>}
        </div>
        <DialogFooter>
          {review?.reply ? (
            <Button type="button" variant="ghost" disabled={pending} onClick={() => void submit(true)}>
              Remove reply
            </Button>
          ) : null}
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={pending || value.trim().length === 0} onClick={() => void submit(false)}>
            {pending ? "Saving…" : "Post reply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ImageLightbox({
  images,
  index,
  onClose,
  onIndexChange,
}: {
  images: ReviewImageRef[];
  index: number | null;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}) {
  const open = index !== null && images.length > 0;
  const current = open ? images[Math.min(index, images.length - 1)] : null;

  function step(delta: number) {
    if (index === null) return;
    onIndexChange((index + delta + images.length) % images.length);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-3xl" onKeyDown={(event) => (event.key === "ArrowRight" ? step(1) : event.key === "ArrowLeft" ? step(-1) : undefined)}>
        <DialogHeader>
          <DialogTitle>
            Photo {index !== null ? index + 1 : 0} of {images.length}
          </DialogTitle>
          <DialogDescription>Uploaded by the reviewer. Use the arrows or the arrow keys to browse.</DialogDescription>
        </DialogHeader>
        <div className="relative flex items-center justify-center">
          {images.length > 1 ? (
            <Button type="button" variant="outline" size="icon-sm" className="absolute left-0 z-10" aria-label="Previous photo" onClick={() => step(-1)}>
              <ChevronLeft />
            </Button>
          ) : null}
          {current ? (
            // A plain <img>: review photos are served from storage/public, not an optimiser host.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={resolveAssetUrl(current.url) ?? current.url} alt="Review photo" className="max-h-[70vh] w-auto max-w-full rounded object-contain" />
          ) : null}
          {images.length > 1 ? (
            <Button type="button" variant="outline" size="icon-sm" className="absolute right-0 z-10" aria-label="Next photo" onClick={() => step(1)}>
              <ChevronRight />
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Thumbnails strip; clicking opens the lightbox. */
export function ReviewImageStrip({ images, onOpen, size = 32 }: { images: ReviewImageRef[]; onOpen: (index: number) => void; size?: number }) {
  if (images.length === 0) return <span className="text-muted-foreground/70">—</span>;
  const shown = images.slice(0, 3);
  return (
    <div className="flex items-center gap-1">
      {shown.map((image, position) => (
        <button
          key={image.id}
          type="button"
          onClick={() => onOpen(position)}
          className="bg-muted focus-visible:ring-ring/50 overflow-hidden rounded border outline-none focus-visible:ring-[3px]"
          style={{ width: size, height: size }}
          aria-label={`Open photo ${position + 1}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={resolveAssetUrl(image.url) ?? image.url} alt="" className="size-full object-cover" loading="lazy" />
        </button>
      ))}
      {images.length > shown.length ? (
        <button type="button" onClick={() => onOpen(shown.length)} className="text-muted-foreground text-[11px] hover:underline">
          +{images.length - shown.length}
        </button>
      ) : null}
    </div>
  );
}
