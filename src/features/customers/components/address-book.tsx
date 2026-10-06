"use client";

import * as React from "react";
import { MapPin, MoreHorizontal, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { useConfirm } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { AddressType } from "@/lib/enums";

import { deleteAddressAction, saveAddressAction, setDefaultAddressAction } from "@/features/customers/actions";
import { ADDRESS_TYPE_LABELS, AddressFields, addressFromRecord, emptyAddress, toAddressInput, type AddressFormState } from "@/features/customers/components/address-fields";
import type { AddressRecord } from "@/features/customers/service";

/**
 * The Addresses tab: a card per address with edit / set default / delete, and
 * one dialog for create and edit. "Default per type" is enforced by the
 * service; the UI only shows the result.
 */
export function AddressBook({ customerId, addresses, canEdit }: { customerId: string; addresses: AddressRecord[]; canEdit: boolean }) {
  const router = useRouter();
  const { run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();
  const [editing, setEditing] = React.useState<{ id: string | null; state: AddressFormState } | null>(null);

  const remove = async (address: AddressRecord) => {
    const answer = await confirm({ title: "Remove address", description: `Remove the ${address.type.toLowerCase()} address in ${address.city}? Orders already placed keep their own copy.`, destructive: true, confirmLabel: "Remove" });
    if (!answer.ok) return;
    await run(() => deleteAddressAction(customerId, address.id), { onSuccess: () => router.refresh() });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          {addresses.length === 0 ? "No saved addresses." : `${addresses.length} saved address${addresses.length === 1 ? "" : "es"}.`}
        </p>
        {canEdit ? (
          <Button size="sm" onClick={() => setEditing({ id: null, state: emptyAddress({ isDefault: addresses.length === 0 }) })}>
            <Plus /> Add address
          </Button>
        ) : null}
      </div>

      {addresses.length === 0 ? (
        <div className="surface">
          <EmptyState icon={MapPin} title="No addresses yet" description="Addresses the customer saves on the website appear here; you can also add one for phone orders." compact />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {addresses.map((address) => (
            <article key={address.id} className="surface flex flex-col gap-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{address.label || address.fullName}</p>
                  {address.label ? <p className="text-muted-foreground truncate text-xs">{address.fullName}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {address.isDefault ? <StatusPill label="Default" tone="brand" dot={false} /> : null}
                  <StatusPill label={ADDRESS_TYPE_LABELS[address.type as AddressType] ?? address.type} tone="neutral" dot={false} />
                  {canEdit ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-xs" aria-label="Address actions">
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditing({ id: address.id, state: addressFromRecord(address) })}>
                          <Pencil /> Edit
                        </DropdownMenuItem>
                        {!address.isDefault ? (
                          <DropdownMenuItem onSelect={() => void run(() => setDefaultAddressAction(customerId, address.id), { onSuccess: () => router.refresh() })}>
                            <Star /> Make default
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => void remove(address)}>
                          <Trash2 /> Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
              </div>
              <address className="text-muted-foreground text-xs not-italic leading-relaxed">
                {address.line1}
                {address.line2 ? <>, {address.line2}</> : null}
                {address.landmark ? <>, near {address.landmark}</> : null}
                <br />
                {address.city}, {address.state} {address.pinCode}
                <br />
                {address.country}
                {address.phone ? (
                  <>
                    {" · "}
                    <span data-numeric>{address.phone}</span>
                  </>
                ) : null}
              </address>
            </article>
          ))}
        </div>
      )}

      <AddressDialog
        key={editing ? editing.id ?? "new" : "closed"}
        customerId={customerId}
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />
      {confirmDialog}
    </div>
  );
}

function AddressDialog({
  customerId,
  editing,
  onClose,
  onSaved,
}: {
  customerId: string;
  editing: { id: string | null; state: AddressFormState } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { pending, run } = useActionToast();
  const [state, setState] = React.useState<AddressFormState>(editing?.state ?? emptyAddress());
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const submit = async () => {
    setErrors({});
    const result = await run(() => saveAddressAction(customerId, editing?.id ?? null, toAddressInput(state)), { onSuccess: onSaved });
    if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
  };

  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing?.id ? "Edit address" : "Add address"}</DialogTitle>
          <DialogDescription>A default shipping address displaces other shipping defaults; a default for both displaces everything.</DialogDescription>
        </DialogHeader>
        <AddressFields value={state} onChange={setState} errors={errors} prefix="book-address" disabled={pending} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={pending}>
            {editing?.id ? "Save address" : "Add address"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
