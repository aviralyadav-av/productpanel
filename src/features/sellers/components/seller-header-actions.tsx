"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Ban, CheckCircle2, ChevronDown, KeyRound, Pencil, RotateCcw, Search, ShieldCheck, Trash2, XCircle } from "lucide-react";

import { SELLER_STATUS_META, type SellerStatus } from "@/lib/enums";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { PermissionGate, usePermission } from "@/components/shared/permission-gate";
import { useActionToast } from "@/components/shared/use-action-toast";

import { deleteSellerAction, resetSellerAccessAction, transitionSellerAction } from "@/features/sellers/actions";
import {
  nextSellerStatuses,
  permissionForTransition,
  transitionLabel,
  transitionNeedsReason,
} from "@/features/sellers/schemas";
import type { SellerDetail } from "@/features/sellers/types";

/**
 * The contextual action strip on the seller header (C5). Buttons are derived
 * from the transition map, so a new edge in enums.ts shows up here without a
 * code change, and each is gated by the permission that edge needs.
 *
 * "Approve & activate" is APPROVED with `activate: true`: the service continues
 * to ACTIVE only when the activation conditions hold, and says so otherwise.
 */
export function SellerHeaderActions({ seller }: { seller: SellerDetail }) {
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const { pending, run } = useActionToast();
  const canApprove = usePermission("sellers.approve");
  const canSuspend = usePermission("sellers.suspend");

  const targets = nextSellerStatuses(seller.status).filter((to) => {
    const permission = permissionForTransition(seller.status, to);
    return permission === "sellers.suspend" ? canSuspend : canApprove;
  });

  async function transition(toStatus: SellerStatus, activate = false) {
    const label = activate ? "Approve & activate" : transitionLabel(seller.status, toStatus);
    const result = await confirm({
      title: `${label} "${seller.displayName}"?`,
      description: activate
        ? "Approves the seller and, because a verified document and a primary bank account are on file, activates them immediately."
        : SELLER_STATUS_META[toStatus].description,
      confirmLabel: label,
      destructive: toStatus === "SUSPENDED" || toStatus === "REJECTED",
      requireReason: transitionNeedsReason(toStatus)
        ? { label: toStatus === "REJECTED" ? "Reason (emailed to the seller)" : "Reason (recorded in the audit log)" }
        : undefined,
    });
    if (!result.ok) return;
    await run(() => transitionSellerAction({ id: seller.id, toStatus, reason: result.reason, activate }), {
      onSuccess: () => router.refresh(),
    });
  }

  async function resetAccess() {
    const result = await confirm({
      title: "Send a password reset link?",
      description: `An email with a single-use link (valid 24 hours) goes to ${seller.email}. Existing links stop working.`,
      confirmLabel: "Send link",
    });
    if (!result.ok) return;
    await run(() => resetSellerAccessAction(seller.id), { onSuccess: () => router.refresh() });
  }

  async function remove() {
    const result = await confirm({
      title: `Delete "${seller.displayName}"?`,
      description: "Only possible while the seller has no products and no order history. The record is kept for audit and the slug and email are freed.",
      confirmLabel: "Delete seller",
      destructive: true,
      requireTypedText: seller.slug,
      requireReason: { label: "Reason" },
    });
    if (!result.ok) return;
    await run(() => deleteSellerAction(seller.id, result.reason), {
      onSuccess: () => router.push("/admin/sellers" as Route),
    });
  }

  const icon = (to: SellerStatus) => {
    switch (to) {
      case "UNDER_REVIEW":
        return <Search />;
      case "APPROVED":
        return <CheckCircle2 />;
      case "ACTIVE":
        return seller.status === "SUSPENDED" ? <RotateCcw /> : <ShieldCheck />;
      case "SUSPENDED":
        return <Ban />;
      case "REJECTED":
        return <XCircle />;
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {targets.map((to) => {
        const destructive = to === "SUSPENDED" || to === "REJECTED";
        return (
          <React.Fragment key={to}>
            <Button
              type="button"
              size="sm"
              variant={destructive ? "destructive" : to === "APPROVED" || to === "ACTIVE" ? "default" : "outline"}
              disabled={pending}
              onClick={() => void transition(to)}
            >
              {icon(to)}
              {transitionLabel(seller.status, to)}
            </Button>
            {to === "APPROVED" && seller.activation.ready ? (
              <Button type="button" size="sm" variant="default" disabled={pending} onClick={() => void transition("APPROVED", true)}>
                <ShieldCheck />
                Approve & activate
              </Button>
            ) : null}
          </React.Fragment>
        );
      })}

      <PermissionGate require="sellers.edit">
        <Button asChild size="sm" variant="outline">
          <Link href={`/admin/sellers/${seller.id}?tab=profile` as Route}>
            <Pencil />
            Edit
          </Link>
        </Button>
      </PermissionGate>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="sm" variant="outline" aria-label="More actions">
            More
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem asChild>
            <a href={seller.publicUrl} target="_blank" rel="noopener noreferrer">
              Open storefront profile
            </a>
          </DropdownMenuItem>
          <PermissionGate require="sellers.edit">
            <DropdownMenuItem onSelect={() => void resetAccess()}>
              <KeyRound />
              Reset access (email link)
            </DropdownMenuItem>
          </PermissionGate>
          <PermissionGate require="sellers.delete">
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => void remove()}>
              <Trash2 />
              Delete seller
            </DropdownMenuItem>
          </PermissionGate>
        </DropdownMenuContent>
      </DropdownMenu>
      {confirmDialog}
    </div>
  );
}
