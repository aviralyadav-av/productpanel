"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Archive, Boxes, Copy, ExternalLink, Eye, EyeOff, Loader2, MoreHorizontal, Save, Trash2 } from "lucide-react";

import type { PublishProblem } from "@/features/catalog/publish-validation";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { useActionToast } from "@/components/shared/use-action-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

import { deleteProductAction, duplicateProductAction, previewLinkAction, publishChecklistAction, setProductStatusAction } from "@/features/products/actions";
import type { EditorProduct } from "@/features/products/queries";

/**
 * Header buttons of the editor. Publish re-runs the checklist first and shows
 * the problems in a dialog instead of a toast, because a product usually
 * fails for three reasons at once and the operator needs all of them.
 */
export function HeaderActions({
  product,
  dirty,
  pending,
  canEdit,
  permissions,
  onSave,
  previewEnabled,
}: {
  product: EditorProduct | null;
  dirty: boolean;
  pending: boolean;
  canEdit: boolean;
  permissions: string[];
  onSave: () => void;
  previewEnabled: boolean;
}) {
  const router = useRouter();
  const { pending: acting, run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();
  const [problems, setProblems] = React.useState<PublishProblem[] | null>(null);
  const can = (code: string) => permissions.includes("*") || permissions.includes(code);

  if (!product) {
    return (
      <Button type="button" size="sm" onClick={onSave} disabled={!canEdit || pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Save />} Create draft
      </Button>
    );
  }

  const publish = async () => {
    const check = await publishChecklistAction(product.id);
    if (!check.ok) return;
    if (!check.data.ok) {
      setProblems(check.data.problems);
      return;
    }
    await run(() => setProductStatusAction(product.id, "PUBLISHED"), { onSuccess: () => router.refresh() });
  };

  const setStatus = async (status: "DRAFT" | "ARCHIVED") => {
    if (status === "ARCHIVED") {
      const answer = await confirm({ title: "Archive product", description: "It leaves the storefront but keeps orders, reviews and stock history.", confirmLabel: "Archive" });
      if (!answer.ok) return;
    }
    await run(() => setProductStatusAction(product.id, status), { onSuccess: () => router.refresh() });
  };

  const remove = async () => {
    const answer = await confirm({
      title: "Delete product",
      description: `Delete "${product.title}"? Order history is preserved and the slug is freed (blueprint 11.34).`,
      destructive: true,
      confirmLabel: "Delete",
      requireTypedText: product.slug,
      requireReason: { label: "Reason" },
    });
    if (!answer.ok) return;
    await run(() => deleteProductAction(product.id, answer.reason), { onSuccess: () => router.push("/admin/products" as Route) });
  };

  const preview = () => run(() => previewLinkAction(product.id), { silent: true, onSuccess: (data) => window.open(data.url, "_blank", "noopener") });

  return (
    <>
      {previewEnabled ? (
        <Button type="button" variant="outline" size="sm" onClick={() => void preview()} disabled={acting}>
          <ExternalLink /> Preview
        </Button>
      ) : null}
      {can("products.publish") ? (
        product.status === "PUBLISHED" ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void setStatus("DRAFT")} disabled={acting}>
            <EyeOff /> Unpublish
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={() => void publish()} disabled={acting || dirty} title={dirty ? "Save your changes first" : undefined}>
            <Eye /> Publish
          </Button>
        )
      ) : null}
      <Button type="button" size="sm" onClick={onSave} disabled={!canEdit || pending || !dirty}>
        {pending ? <Loader2 className="animate-spin" /> : <Save />} Save
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="icon-sm" aria-label="More actions">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/admin/inventory?product=${product.id}` as Route}>
              <Boxes /> View in inventory
            </Link>
          </DropdownMenuItem>
          {can("products.create") ? (
            <DropdownMenuItem onSelect={() => void run(() => duplicateProductAction(product.id), { onSuccess: (copy) => router.push(`/admin/products/${copy.id}` as Route) })}>
              <Copy /> Duplicate
            </DropdownMenuItem>
          ) : null}
          {can("products.publish") && product.status !== "ARCHIVED" ? (
            <DropdownMenuItem onSelect={() => void setStatus("ARCHIVED")}>
              <Archive /> Archive
            </DropdownMenuItem>
          ) : null}
          {can("products.delete") ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => void remove()}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={problems !== null} onOpenChange={(open) => !open && setProblems(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Not ready to publish</DialogTitle>
            <DialogDescription>Fix these and publish again (blueprint 11.5).</DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {(problems ?? []).map((problem) => (
              <li key={`${problem.code}-${problem.attributeId ?? ""}`}>{problem.message}</li>
            ))}
          </ul>
          <DialogFooter>
            <Button type="button" size="sm" onClick={() => setProblems(null)}>
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </>
  );
}
