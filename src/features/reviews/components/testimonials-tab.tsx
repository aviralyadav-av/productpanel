"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, MoreHorizontal, Plus, Star, StarOff, Trash2, XCircle } from "lucide-react";

import { REVIEW_STATUS_META, type ReviewStatus } from "@/lib/enums";
import { formatIstDate } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { FormRow, FormRowGroup } from "@/components/shared/form-layout";
import { usePermission } from "@/components/shared/permission-gate";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { useActionToast } from "@/components/shared/use-action-toast";

import { createTestimonialAction, deleteReviewAction, setReviewFeaturedAction, setReviewStatusAction, updateReviewAction } from "@/features/reviews/actions";
import { RatingStars } from "@/features/reviews/components/rating-stars";
import { ReviewStatusBadge, excerpt } from "@/features/reviews/components/review-table";
import type { TestimonialInput } from "@/features/reviews/schemas";
import type { ReviewListRow } from "@/features/reviews/types";

/**
 * Testimonials are Review rows with `isTestimonial` and no product: quotes
 * the homepage `testimonials` section shows in `position` order (E1). They
 * are entered by hand here rather than arriving from the storefront.
 */

const EMPTY: TestimonialInput = { authorName: "", authorLocation: "", body: "", rating: 5, position: 0, isFeatured: false, status: "APPROVED" };

export function TestimonialDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { run, pending } = useActionToast();
  const [values, setValues] = React.useState<TestimonialInput>(EMPTY);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  function set<K extends keyof TestimonialInput>(key: K, value: TestimonialInput[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await run(() => createTestimonialAction(values), {
      onSuccess: () => {
        setValues(EMPTY);
        setErrors({});
        onOpenChange(false);
        router.refresh();
      },
      onError: (failure) => setErrors(failure.ok ? {} : failure.fieldErrors ?? {}),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New testimonial</DialogTitle>
            <DialogDescription>A customer quote for the homepage. Approved testimonials appear in position order.</DialogDescription>
          </DialogHeader>
          <FormRowGroup columns={2}>
            <FormRow label="Author name" htmlFor="t-author" required error={errors.authorName}>
              <Input id="t-author" value={values.authorName} onChange={(event) => set("authorName", event.target.value)} maxLength={80} required />
            </FormRow>
            <FormRow label="Location" htmlFor="t-location" hint="e.g. Jaipur" error={errors.authorLocation}>
              <Input
                id="t-location"
                value={typeof values.authorLocation === "string" ? values.authorLocation : ""}
                onChange={(event) => set("authorLocation", event.target.value)}
                maxLength={80}
              />
            </FormRow>
          </FormRowGroup>
          <FormRow label="Quote" htmlFor="t-body" required error={errors.body}>
            <Textarea id="t-body" value={values.body} onChange={(event) => set("body", event.target.value)} rows={4} maxLength={2000} required />
          </FormRow>
          <FormRowGroup columns={3}>
            <FormRow label="Rating" htmlFor="t-rating" error={errors.rating}>
              <select
                id="t-rating"
                className="border-input bg-background h-8 w-full rounded-md border px-2 text-xs"
                value={values.rating === null || values.rating === undefined ? "" : String(values.rating)}
                onChange={(event) => set("rating", event.target.value ? Number(event.target.value) : null)}
              >
                <option value="">No stars</option>
                {[5, 4, 3, 2, 1].map((value) => (
                  <option key={value} value={value}>
                    {value} star{value === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
            </FormRow>
            <FormRow label="Position" htmlFor="t-position" hint="Lower first" error={errors.position}>
              <Input id="t-position" type="number" min={0} value={String(values.position ?? 0)} onChange={(event) => set("position", Number(event.target.value) || 0)} />
            </FormRow>
            <FormRow label="Status" htmlFor="t-status" error={errors.status}>
              <select
                id="t-status"
                className="border-input bg-background h-8 w-full rounded-md border px-2 text-xs"
                value={values.status ?? "APPROVED"}
                onChange={(event) => set("status", event.target.value as ReviewStatus)}
              >
                {(["APPROVED", "PENDING", "REJECTED"] as const).map((status) => (
                  <option key={status} value={status}>
                    {REVIEW_STATUS_META[status].label}
                  </option>
                ))}
              </select>
            </FormRow>
          </FormRowGroup>
          <label className="flex items-center gap-2 text-xs">
            <Checkbox checked={Boolean(values.isFeatured)} onCheckedChange={(checked) => set("isFeatured", checked === true)} />
            Featured on the homepage
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Add testimonial"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NewTestimonialButton() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus />
        New testimonial
      </Button>
      <TestimonialDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

export function TestimonialTable({ rows }: { rows: ReviewListRow[] }) {
  const router = useRouter();
  const { run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();
  const canModerate = usePermission("reviews.moderate");
  const canDelete = usePermission("reviews.delete");

  async function setStatus(row: ReviewListRow, status: ReviewStatus) {
    await run(() => setReviewStatusAction({ id: row.id, status }), { onSuccess: () => router.refresh() });
  }
  async function toggleFeatured(row: ReviewListRow) {
    await run(() => setReviewFeaturedAction({ id: row.id, isFeatured: !row.isFeatured }), { onSuccess: () => router.refresh() });
  }
  async function move(row: ReviewListRow, delta: number) {
    await run(() => updateReviewAction({ id: row.id, patch: { position: Math.max(0, row.position + delta) } }), { onSuccess: () => router.refresh() });
  }
  async function remove(row: ReviewListRow) {
    const result = await confirm({
      title: `Delete the testimonial by ${row.authorName}?`,
      description: "It disappears from the homepage immediately.",
      confirmLabel: "Delete",
      destructive: true,
      requireReason: { label: "Reason (kept in the audit log)" },
    });
    if (!result.ok) return;
    await run(() => deleteReviewAction(row.id, result.reason), { onSuccess: () => router.refresh() });
  }

  const table = (
    <DataTable>
      <DataTableHead>
        <Th width="4rem" align="right">
          Order
        </Th>
        <Th>Author</Th>
        <Th>Quote</Th>
        <Th>Rating</Th>
        <Th>Status</Th>
        <Th>Featured</Th>
        <Th>Added</Th>
        <Th width="3rem">
          <span className="sr-only">Actions</span>
        </Th>
      </DataTableHead>
      <DataTableBody>
        {rows.map((row) => (
          <Tr key={row.id}>
            <Td align="right" numeric className="text-xs">
              {row.position}
            </Td>
            <Td>
              <span className="block text-sm font-medium">{row.authorName}</span>
              {row.authorLocation ? <span className="text-muted-foreground block text-[11px]">{row.authorLocation}</span> : null}
            </Td>
            <Td>
              <span className="text-muted-foreground block max-w-[26rem] truncate text-xs">{excerpt(row.body, 140)}</span>
            </Td>
            <Td>
              <RatingStars rating={row.rating} />
            </Td>
            <Td>
              <ReviewStatusBadge status={row.status} />
            </Td>
            <Td>{row.isFeatured ? <Star className="fill-warning text-warning size-3.5" aria-label="Featured" /> : <span className="text-muted-foreground/70">—</span>}</Td>
            <Td numeric className="text-xs">
              {formatIstDate(new Date(row.createdAt))}
            </Td>
            <Td align="right">
              {canModerate || canDelete ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-xs" aria-label={`Actions for testimonial by ${row.authorName}`}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    {canModerate ? (
                      <>
                        <DropdownMenuItem onSelect={() => void move(row, -1)}>Move up</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void move(row, 1)}>Move down</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {row.status !== "APPROVED" ? (
                          <DropdownMenuItem onSelect={() => void setStatus(row, "APPROVED")}>
                            <CheckCircle2 /> Approve
                          </DropdownMenuItem>
                        ) : null}
                        {row.status !== "REJECTED" ? (
                          <DropdownMenuItem onSelect={() => void setStatus(row, "REJECTED")}>
                            <XCircle /> Reject
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem onSelect={() => void toggleFeatured(row)}>
                          {row.isFeatured ? <StarOff /> : <Star />}
                          {row.isFeatured ? "Unfeature" : "Feature"}
                        </DropdownMenuItem>
                      </>
                    ) : null}
                    {canDelete ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => void remove(row)}>
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </Td>
          </Tr>
        ))}
      </DataTableBody>
    </DataTable>
  );

  const cards = rows.map((row) => (
    <MobileCard key={row.id} title={row.authorName} subtitle={row.authorLocation ?? undefined} meta={<ReviewStatusBadge status={row.status} />}>
      <MobileCardField label="Quote">{excerpt(row.body, 100)}</MobileCardField>
      <MobileCardField label="Rating">
        <RatingStars rating={row.rating} />
      </MobileCardField>
      <MobileCardField label="Position" numeric>
        {row.position}
      </MobileCardField>
    </MobileCard>
  ));

  return (
    <>
      <ResponsiveTable table={table} cards={cards} />
      {confirmDialog}
    </>
  );
}
