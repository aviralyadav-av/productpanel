"use client";

import * as React from "react";
import Link from "next/link";
import {
  Check,
  Loader2,
  MessageSquareQuote,
  Plus,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "cn";

import {
  DataTable,
  DataTableBody,
  DataTableHead,
  Td,
  Th,
  Tr,
} from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import {
  FilterTabs,
  PaginationBar,
  SearchInput,
} from "@/components/shared/list-controls";
import { ReviewStatusBadge, StatusPill } from "@/components/shared/status-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatIstDate } from "@/lib/dates";
import { REVIEW_STATUSES } from "@/lib/enums";
import type { PageMeta } from "@/lib/list-params";
import { formatNumber } from "@/lib/money";
import {
  createTestimonial,
  deleteReview,
  setReviewStatus,
  toggleReviewFeatured,
} from "../actions";
import type { ReviewRow } from "../queries";
import { useActionToast } from "./section-editor";

/**
 * Moderation queue and homepage testimonials in one table.
 *
 * They share a table on purpose: both are Review rows, the only difference is
 * that a testimonial has no product attached and was typed in here rather than
 * submitted by a shopper. Splitting them into two screens would mean two
 * places to look for "that quote from Simran".
 *
 * Only APPROVED reviews can be featured - the server enforces it too, but the
 * switch is disabled here so the operator does not have to discover the rule
 * from an error toast.
 */
export function ReviewsTab({
  rows,
  meta,
  statusCounts,
  total,
  isFiltered,
}: {
  rows: ReviewRow[];
  meta: PageMeta;
  statusCounts: Record<string, number>;
  total: number;
  isFiltered: boolean;
}) {
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [adding, setAdding] = React.useState(false);
  const { pending, run } = useActionToast();

  // Scoped to what is on screen, derived rather than reset: changing page or
  // filter drops ids the operator can no longer see, so a bulk approve can
  // never touch a row that is not in front of them.
  const visibleIds = new Set(rows.map((row) => row.id));
  const selectedSet = new Set(selectedIds.filter((id) => visibleIds.has(id)));
  const selectedCount = selectedSet.size;
  const allSelected = rows.length > 0 && selectedCount === rows.length;
  const headerState: boolean | "indeterminate" = allSelected
    ? true
    : selectedCount > 0
      ? "indeterminate"
      : false;

  function bulk(status: (typeof REVIEW_STATUSES)[number]) {
    const ids = rows.map((row) => row.id).filter((id) => selectedSet.has(id));
    if (ids.length === 0) return;
    run(() => setReviewStatus({ ids, status }), {
      onSuccess: () => setSelectedIds([]),
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <SearchInput placeholder="Search author or quote…" className="w-56" />
        <FilterTabs
          paramKey="status"
          allLabel="All"
          options={REVIEW_STATUSES.map((status) => ({
            value: status,
            label:
              status.charAt(0) + status.slice(1).toLowerCase(),
            count: statusCounts[status] ?? 0,
          }))}
        />
        <div className="ml-auto flex items-center gap-2">
          <span data-numeric className="text-muted-foreground text-[11px]">
            {formatNumber(total)} review{total === 1 ? "" : "s"}
          </span>
          <Button type="button" size="xs" onClick={() => setAdding(true)}>
            <Plus />
            Add testimonial
          </Button>
        </div>
      </div>

      <p className="text-muted-foreground border-b px-4 py-1.5 text-[11px] leading-relaxed">
        The storefront has no review form, so nothing new arrives here on its
        own — these were imported with the catalogue. Approving a review
        recomputes its product&apos;s rating immediately.
      </p>

      {selectedCount > 0 ? (
        <div className="bg-muted/50 flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs">
          <span data-numeric className="font-medium">
            {selectedCount} selected
          </span>
          <span className="text-muted-foreground">
            The same status is applied to each.
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="xs"
              disabled={pending}
              onClick={() => setSelectedIds([])}
            >
              Clear
            </Button>
            <Button
              variant="outline"
              size="xs"
              disabled={pending}
              onClick={() => bulk("REJECTED")}
            >
              Reject
            </Button>
            <Button size="xs" disabled={pending} onClick={() => bulk("APPROVED")}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Approve
            </Button>
          </div>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon={MessageSquareQuote}
          title={isFiltered ? "No reviews match" : "No reviews yet"}
          description={
            isFiltered
              ? "Clear the search and the status filter to see the rest."
              : "Review is empty. Run npm run db:seed to import the storefront's testimonials, or add one by hand."
          }
        />
      ) : (
        <DataTable>
          <DataTableHead>
            <Th width="2.25rem">
              <Checkbox
                checked={headerState}
                onCheckedChange={(checked) =>
                  setSelectedIds(
                    checked === true ? rows.map((row) => row.id) : [],
                  )
                }
                aria-label="Select every review on this page"
              />
            </Th>
            <Th width="150px">Author</Th>
            <Th>Review</Th>
            <Th width="120px">Product</Th>
            <Th align="center" width="66px">
              Rating
            </Th>
            <Th width="96px">Status</Th>
            <Th align="center" width="76px">
              Homepage
            </Th>
            <Th align="right" width="96px">
              Actions
            </Th>
          </DataTableHead>

          <DataTableBody>
            {rows.map((row) => (
              <ReviewRowCells
                key={row.id}
                row={row}
                selected={selectedSet.has(row.id)}
                onSelect={(checked) =>
                  setSelectedIds((current) =>
                    checked
                      ? [...current, row.id]
                      : current.filter((id) => id !== row.id),
                  )
                }
              />
            ))}
          </DataTableBody>
        </DataTable>
      )}

      {rows.length > 0 ? (
        <PaginationBar meta={meta} itemLabel="reviews" />
      ) : null}

      <AddTestimonialDialog open={adding} onOpenChange={setAdding} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function ReviewRowCells({
  row,
  selected,
  onSelect,
}: {
  row: ReviewRow;
  selected: boolean;
  onSelect: (checked: boolean) => void;
}) {
  const { pending, run } = useActionToast();

  return (
    <Tr className={cn(selected && "bg-accent/40")}>
      <Td>
        <Checkbox
          checked={selected}
          onCheckedChange={(checked) => onSelect(checked === true)}
          aria-label={`Select the review by ${row.authorName}`}
        />
      </Td>

      <Td className="max-w-[10rem]">
        <p className="truncate font-medium">{row.authorName}</p>
        <p className="text-muted-foreground truncate text-[11px]">
          {row.authorLocation
            ? `${row.authorLocation} · ${formatIstDate(row.createdAt)}`
            : formatIstDate(row.createdAt)}
        </p>
      </Td>

      <Td className="max-w-[22rem]">
        {row.title ? (
          <p className="truncate font-medium">{row.title}</p>
        ) : null}
        <p className="text-muted-foreground line-clamp-2 text-[11px] leading-relaxed">
          {row.body}
        </p>
      </Td>

      <Td className="max-w-[8rem]">
        {row.productId ? (
          <Link
            href={`/products/${row.productId}` as never}
            className="block truncate hover:underline"
          >
            {row.productTitle ?? row.productId}
          </Link>
        ) : (
          <StatusPill label="Testimonial" tone="brand" dot={false} />
        )}
      </Td>

      <Td align="center">
        <Rating value={row.rating} />
      </Td>

      <Td>
        <ReviewStatusBadge status={row.status} />
      </Td>

      <Td align="center">
        <Switch
          checked={row.isFeatured}
          disabled={pending || row.status !== "APPROVED"}
          aria-label={`Show the review by ${row.authorName} on the homepage`}
          title={
            row.status === "APPROVED"
              ? undefined
              : "Approve the review before featuring it."
          }
          onCheckedChange={(checked) =>
            run(() => toggleReviewFeatured({ id: row.id, isFeatured: checked }))
          }
        />
      </Td>

      <Td align="right">
        <div className="flex items-center justify-end gap-1">
          {row.status === "APPROVED" ? (
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={pending}
              title="Reject this review"
              aria-label={`Reject the review by ${row.authorName}`}
              onClick={() =>
                run(() =>
                  setReviewStatus({ ids: [row.id], status: "REJECTED" }),
                )
              }
            >
              <X />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={pending}
              title="Approve this review"
              aria-label={`Approve the review by ${row.authorName}`}
              onClick={() =>
                run(() =>
                  setReviewStatus({ ids: [row.id], status: "APPROVED" }),
                )
              }
            >
              <Check />
            </Button>
          )}

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={pending}
                title="Delete this review"
                aria-label={`Delete the review by ${row.authorName}`}
              >
                <Trash2 />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Delete this {row.isTestimonial ? "testimonial" : "review"}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  The review by {row.authorName} is removed for good, and the
                  product&apos;s rating is recomputed without it. This cannot be
                  undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => run(() => deleteReview({ id: row.id }))}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </Td>
    </Tr>
  );
}

// ---------------------------------------------------------------------------

/**
 * A null rating is not zero stars - the seeded testimonials genuinely have no
 * rating, and the storefront renders `rating || 5` for them.
 */
function Rating({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-muted-foreground text-[11px]">—</span>;
  }

  return (
    <span
      className="inline-flex items-center gap-0.5"
      aria-label={`${value} out of 5`}
    >
      {Array.from({ length: 5 }).map((_, index) => (
        <Star
          key={index}
          aria-hidden
          className={cn(
            "size-3",
            index < value
              ? "fill-warning text-warning"
              : "text-muted-foreground/30",
          )}
        />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------

function AddTestimonialDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [authorName, setAuthorName] = React.useState("");
  const [authorLocation, setAuthorLocation] = React.useState("");
  const [body, setBody] = React.useState("");
  const [rating, setRating] = React.useState("none");
  const [isFeatured, setIsFeatured] = React.useState(true);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const { pending, run } = useActionToast();

  function reset() {
    setAuthorName("");
    setAuthorLocation("");
    setBody("");
    setRating("none");
    setIsFeatured(true);
    setErrors({});
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});

    run(
      async () => {
        const result = await createTestimonial({
          authorName,
          authorLocation,
          body,
          rating: rating === "none" ? null : Number(rating),
          isFeatured,
        });
        if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
        return result;
      },
      {
        onSuccess: () => {
          reset();
          onOpenChange(false);
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Add a homepage testimonial</DialogTitle>
            <DialogDescription>
              Typed in here, so it is approved on the spot — there is no
              storefront form that could submit an unmoderated one.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" error={errors.authorName}>
                <Input
                  value={authorName}
                  onChange={(event) => setAuthorName(event.target.value)}
                  placeholder="Simran Kaur"
                  autoFocus
                />
              </Field>
              <Field label="Location" error={errors.authorLocation}>
                <Input
                  value={authorLocation}
                  onChange={(event) => setAuthorLocation(event.target.value)}
                  placeholder="Chandigarh"
                />
              </Field>
            </div>

            <Field label="Quote" error={errors.body}>
              <Textarea
                rows={4}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="What they said about the bag."
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Rating" error={errors.rating}>
                <Select value={rating} onValueChange={setRating}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No rating</SelectItem>
                    {[5, 4, 3, 2, 1].map((value) => (
                      <SelectItem key={value} value={String(value)}>
                        {value} star{value === 1 ? "" : "s"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <div className="flex items-end">
                <label className="flex items-center gap-2 pb-2 text-xs">
                  <Switch
                    checked={isFeatured}
                    onCheckedChange={setIsFeatured}
                  />
                  Show on the homepage
                </label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Add testimonial
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {error ? <p className="text-destructive text-[11px]">{error}</p> : null}
    </div>
  );
}
