"use client";

import Link from "next/link";
import type { Route } from "next";
import { MoreHorizontal, Pencil, Power, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { useActionToast } from "@/components/shared/use-action-toast";

import { deleteAttributeAction, setAttributeActiveAction } from "../actions";

/**
 * Row menu for the attributes list. Delete is refused by the service while
 * anything uses the attribute; the toast carries the usage summary so the
 * operator knows what to detach.
 */
export function AttributeRowActions({
  attribute,
  usageTotal,
  canManage,
}: {
  attribute: { id: string; name: string; isActive: boolean };
  usageTotal: number;
  canManage: boolean;
}) {
  const { pending, run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();
  const editHref = `/admin/attributes/${attribute.id}` as Route;

  async function remove() {
    if (usageTotal > 0) {
      await run(() => deleteAttributeAction(attribute.id)); // surfaces the usage list as the error toast
      return;
    }
    const ok = await confirm({
      title: `Delete "${attribute.name}"?`,
      description: "The attribute and its values are removed permanently. Nothing uses it, so no product is affected.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok.ok) return;
    await run(() => deleteAttributeAction(attribute.id));
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${attribute.name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={editHref}>
              <Pencil /> Edit
            </Link>
          </DropdownMenuItem>
          {canManage ? (
            <>
              <DropdownMenuItem disabled={pending} onSelect={() => run(() => setAttributeActiveAction({ id: attribute.id, value: !attribute.isActive }))}>
                <Power /> {attribute.isActive ? "Deactivate" : "Activate"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" disabled={pending} onSelect={remove} title={usageTotal > 0 ? "Blocked while in use" : undefined}>
                <Trash2 /> Delete{usageTotal > 0 ? " (in use)" : ""}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {confirmDialog}
    </>
  );
}
