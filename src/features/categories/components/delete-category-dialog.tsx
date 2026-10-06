"use client";

import * as React from "react";
import { Loader2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { useActionToast } from "@/components/shared/use-action-toast";

import { deleteCategoryAction } from "../actions";
import type { DeleteCategoryResult } from "../service";
import { CategoryTreeSelect, type CategoryTreeSelectItem } from "./category-tree-select";

export type DeleteCategoryTarget = {
  id: string;
  name: string;
  childrenCount: number;
  productCount: number;
};

/**
 * Deleting a category is the one irreversible action on this screen, so it
 * carries two frictions (§11.1, D-style typed confirmation): the operator
 * must type the category's name, and when anything lives under it they must
 * pick where it goes - the service refuses to orphan children or products
 * and moves them in the same transaction as the delete.
 */
export function DeleteCategoryDialog({
  target,
  categories,
  onOpenChange,
  onDeleted,
}: {
  target: DeleteCategoryTarget | null;
  categories?: readonly CategoryTreeSelectItem[];
  onOpenChange: (open: boolean) => void;
  onDeleted?: (result: DeleteCategoryResult) => void;
}) {
  const { pending, run } = useActionToast();
  const [typed, setTyped] = React.useState("");
  const [reassignTo, setReassignTo] = React.useState<string | null>(null);

  // Reset the frictions every time a different category is targeted.
  //
  // Both sides of the comparison must be normalised to null. `target?.id` is
  // `undefined` while the dialog is closed but `lastId` starts as `null`, and
  // `undefined !== null`, so comparing them directly re-ran this branch on
  // every render, set state during render, and rendered again - React aborts
  // that with "Too many re-renders" on every render of the categories screen.
  const targetId = target?.id ?? null;
  const [lastId, setLastId] = React.useState<string | null>(null);
  if (targetId !== lastId) {
    setLastId(targetId);
    setTyped("");
    setReassignTo(null);
  }

  const needsReassign = Boolean(target && (target.childrenCount > 0 || target.productCount > 0));
  const canDelete = Boolean(target) && typed.trim() === target?.name && (!needsReassign || reassignTo);

  async function confirm() {
    if (!target || !canDelete) return;
    await run(() => deleteCategoryAction({ id: target.id, reassignTo: needsReassign ? reassignTo : null }), {
      onSuccess: (result) => {
        onOpenChange(false);
        onDeleted?.(result);
      },
    });
  }

  const parts: string[] = [];
  if (target && target.childrenCount > 0) parts.push(`${target.childrenCount} sub-categor${target.childrenCount === 1 ? "y" : "ies"}`);
  if (target && target.productCount > 0) parts.push(`${target.productCount} product${target.productCount === 1 ? "" : "s"}`);

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !pending && onOpenChange(open)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete “{target?.name}”?</DialogTitle>
          <DialogDescription>
            {needsReassign
              ? `This category still holds ${parts.join(" and ")}. Choose where they should go; they are moved in the same step as the delete, so nothing is left orphaned.`
              : "The category is empty. Its attribute assignments and commission override are removed with it; banners and menu links pointing at it will be flagged."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {needsReassign ? (
            <div className="space-y-1.5">
              <Label htmlFor="reassign-to" className="text-xs">
                Move sub-categories and products to
              </Label>
              <CategoryTreeSelect
                id="reassign-to"
                value={reassignTo}
                onChange={setReassignTo}
                excludeId={target?.id}
                categories={categories}
                placeholder="Choose a destination category"
              />
              <p className="text-muted-foreground text-[11px]">
                Moved products take on the destination&apos;s attribute set; their facets are rebuilt in the background.
              </p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="delete-typed" className="text-xs">
              Type <span className="font-mono">{target?.name}</span> to confirm
            </Label>
            <Input
              id="delete-typed"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              className="h-8"
            />
          </div>

          <p className="text-destructive flex items-start gap-2 text-xs">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            This cannot be undone. The storefront URL /c/… for this category stops resolving immediately.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" size="sm" disabled={!canDelete || pending} onClick={confirm}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            Delete category
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
