"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Ban,
  Info,
  Loader2,
  MapPin,
  ShieldCheck,
  ShoppingCart,
} from "lucide-react";
import { toast } from "sonner";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
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
  CustomerStatusBadge,
  OrderStatusBadge,
  PaymentStatusBadge,
  StatusPill,
} from "@/components/shared/status-badge";
import type { ActionResult } from "@/lib/action-result";
import { formatIstDate, formatIstDateTime } from "@/lib/dates";
import { formatNumber, formatPaise } from "@/lib/money";
import type { CustomerStatus } from "@/lib/enums";
import {
  setCustomerStatus,
  updateCustomerNotes,
  updateCustomerProfile,
} from "../actions";
import type { CustomerDetail } from "../schemas";

/**
 * The customer record lives in a side panel rather than at /customers/[id].
 * A customer is a dozen fields and a short order list - opening a whole route
 * for that loses the list you were reading, and reading a customer is almost
 * always something you do *while* working the list.
 *
 * The panel is still URL state: ?customer=<id> opens it, closing removes the
 * param, and the open record survives a refresh or a pasted link.
 */
export function CustomerSheet({ customer }: { customer: CustomerDetail }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [open, setOpen] = React.useState(true);

  function handleOpenChange(next: boolean) {
    if (next) return;

    // Close locally first so the panel animates out instead of vanishing the
    // instant the server re-renders without the param.
    setOpen(false);

    const params = new URLSearchParams(searchParams.toString());
    params.delete("customer");
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}` as never, {
      scroll: false,
    });
  }

  const displayName = customer.fullName ?? customer.email;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl"
      >
        <SheetHeader className="gap-1 border-b px-4 py-3 pr-12">
          <SheetTitle className="truncate text-sm font-semibold">
            {displayName}
          </SheetTitle>
          <SheetDescription className="truncate text-xs">
            {customer.email} · joined {formatIstDate(customer.createdAt)} ·
            edited {formatIstDateTime(customer.updatedAt)}
          </SheetDescription>
        </SheetHeader>

        <div className="scrollbar-thin min-h-0 flex-1 divide-y overflow-y-auto">
          <StatusSection customer={customer} />
          <ProfileSection customer={customer} />
          <StatsSection customer={customer} />
          <AddressSection customer={customer} />
          <OrderHistorySection customer={customer} />
          <NotesSection customer={customer} />
          <PrivacySection />
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="px-4 py-3">
      <header className="mb-2">
        <h3 className="text-xs font-semibold tracking-tight">{title}</h3>
        {description ? (
          <p className="text-muted-foreground text-[11px] leading-relaxed">
            {description}
          </p>
        ) : null}
      </header>
      {children}
    </section>
  );
}

/** Every action reports through the human sentence it already returned. */
function report(result: ActionResult<unknown>): void {
  if (result.ok) toast.success(result.message ?? "Saved.");
  else toast.error(result.error);
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-destructive text-[11px]">{message}</p>;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

function StatusSection({ customer }: { customer: CustomerDetail }) {
  const [pending, startTransition] = React.useTransition();
  const isBlocked = customer.status === "BLOCKED";
  const next: CustomerStatus = isBlocked ? "ACTIVE" : "BLOCKED";
  const displayName = customer.fullName ?? customer.email;

  function apply() {
    startTransition(async () => {
      report(await setCustomerStatus({ id: customer.id, status: next }));
    });
  }

  return (
    <section className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <CustomerStatusBadge status={customer.status} />
      {customer.hasAccount ? (
        <StatusPill label="Storefront login linked" tone="neutral" dot={false} />
      ) : null}

      <p className="text-muted-foreground order-last w-full text-[11px] leading-relaxed">
        Blocking is a flag inside this admin. The storefront has no login and no
        server-side checkout yet, so it cannot stop anyone from ordering until
        the site is pointed at this API.
      </p>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant={isBlocked ? "outline" : "destructive"}
            size="xs"
            className="ml-auto"
            disabled={pending}
          >
            {pending ? (
              <Loader2 className="animate-spin" />
            ) : isBlocked ? (
              <ShieldCheck />
            ) : (
              <Ban />
            )}
            {isBlocked ? "Unblock" : "Block customer"}
          </Button>
        </AlertDialogTrigger>

        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isBlocked ? `Unblock ${displayName}?` : `Block ${displayName}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isBlocked
                ? "The record goes back to Active. Nothing else changes; their order history is untouched either way."
                : "This marks the record as blocked for everyone working in this admin, and nothing more. It does not cancel their open orders and it cannot prevent another order being placed: the live storefront never talks to this server."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={isBlocked ? "default" : "destructive"}
              onClick={apply}
            >
              {isBlocked ? "Unblock" : "Block"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Contact details
// ---------------------------------------------------------------------------

function ProfileSection({ customer }: { customer: CustomerDetail }) {
  const [pending, startTransition] = React.useTransition();
  const [fullName, setFullName] = React.useState(customer.fullName ?? "");
  const [email, setEmail] = React.useState(customer.email);
  const [phone, setPhone] = React.useState(customer.phone ?? "");
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const dirty =
    fullName !== (customer.fullName ?? "") ||
    email !== customer.email ||
    phone !== (customer.phone ?? "");

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await updateCustomerProfile({
        id: customer.id,
        fullName,
        email,
        phone,
      });

      if (result.ok) {
        // Mirror the normalisation the schema applied, or the form stays
        // permanently "dirty" against the value that was actually stored.
        setErrors({});
        setFullName(fullName.trim());
        setEmail(email.trim().toLowerCase());
        setPhone(phone.trim());
      } else {
        setErrors(result.fieldErrors ?? {});
      }

      report(result);
    });
  }

  return (
    <Section
      title="Contact details"
      description="Email is the key an anonymous checkout is matched on, so changing it means a future order placed with the old address starts a new record."
    >
      <form onSubmit={submit} className="space-y-2.5">
        <div className="grid gap-2.5 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="customer-name" className="text-xs">
              Full name
            </Label>
            <Input
              id="customer-name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Not recorded"
              autoComplete="off"
              aria-invalid={Boolean(errors.fullName)}
            />
            <FieldError message={errors.fullName} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="customer-phone" className="text-xs">
              Phone
            </Label>
            <Input
              id="customer-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="Not recorded"
              autoComplete="off"
              className="tabular"
              aria-invalid={Boolean(errors.phone)}
            />
            <FieldError message={errors.phone} />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="customer-email" className="text-xs">
            Email
          </Label>
          <Input
            id="customer-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="off"
            aria-invalid={Boolean(errors.email)}
          />
          <FieldError message={errors.email} />
        </div>

        <div className="flex justify-end">
          <Button type="submit" size="xs" disabled={!dirty || pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            Save details
          </Button>
        </div>
      </form>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Computed stats
// ---------------------------------------------------------------------------

function StatsSection({ customer }: { customer: CustomerDetail }) {
  const { stats } = customer;

  return (
    <Section
      title="Lifetime"
      description="Net of refunds, excluding cancelled orders."
    >
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-3">
        <Stat label="Orders" value={formatNumber(stats.orderCount)} />
        <Stat
          label="Lifetime value"
          value={formatPaise(stats.lifetimeValuePaise)}
        />
        <Stat
          label="Average order"
          value={stats.orderCount > 0 ? formatPaise(stats.averageOrderPaise) : "—"}
        />
        <Stat
          label="First order"
          value={stats.firstOrderAt ? formatIstDate(stats.firstOrderAt) : "—"}
        />
        <Stat
          label="Last order"
          value={stats.lastOrderAt ? formatIstDate(stats.lastOrderAt) : "—"}
        />
        <Stat
          label="Cancelled"
          value={formatNumber(stats.cancelledCount)}
          hint={
            stats.refundedPaise > 0
              ? `${formatPaise(stats.refundedPaise)} refunded`
              : undefined
          }
        />
      </dl>
    </Section>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <dt className="text-muted-foreground text-[11px]">{label}</dt>
      <dd data-numeric className="text-sm font-medium">
        {value}
      </dd>
      {hint ? (
        <p data-numeric className="text-muted-foreground text-[11px]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

function AddressSection({ customer }: { customer: CustomerDetail }) {
  return (
    <Section
      title={`Addresses (${customer.addresses.length})`}
      description="Read-only here. Every order stores its own copy of the address it shipped to, so an order never changes when this list does."
    >
      {customer.addresses.length === 0 ? (
        <EmptyState
          compact
          icon={MapPin}
          title="No saved address"
          description="An address is stored the first time an order is entered against this customer."
        />
      ) : (
        <ul className="space-y-2">
          {customer.addresses.map((address) => (
            <li key={address.id} className="rounded-lg border p-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate font-medium">{address.fullName}</p>
                {address.isDefault ? (
                  <StatusPill label="Default" tone="brand" dot={false} />
                ) : null}
              </div>
              <p className="text-muted-foreground mt-0.5 leading-relaxed">
                {address.line1}, {address.city}, {address.state}{" "}
                <span data-numeric>{address.pinCode}</span>, {address.country}
              </p>
              {address.phone ? (
                <p data-numeric className="text-muted-foreground">
                  {address.phone}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Order history
// ---------------------------------------------------------------------------

function OrderHistorySection({ customer }: { customer: CustomerDetail }) {
  return (
    <Section
      title={`Orders (${customer.orders.length})`}
      description="Newest first. Cancelled orders are listed but excluded from every figure above."
    >
      {customer.orders.length === 0 ? (
        <EmptyState
          compact
          icon={ShoppingCart}
          title="No orders yet"
          description="This record exists without a purchase behind it."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <DataTable>
            <DataTableHead>
              <Th>Order</Th>
              <Th>Status</Th>
              <Th>Payment</Th>
              <Th align="right">Total</Th>
              <Th align="right">Placed</Th>
            </DataTableHead>
            <DataTableBody>
              {customer.orders.map((order) => (
                <Tr key={order.id}>
                  <Td>
                    <Link
                      href={`/orders/${order.id}` as never}
                      className="font-medium hover:underline"
                    >
                      {order.orderNumber}
                    </Link>
                    <p className="text-muted-foreground text-[10px]">
                      {order.itemCount} item{order.itemCount === 1 ? "" : "s"}
                    </p>
                  </Td>
                  <Td>
                    <OrderStatusBadge status={order.status} />
                  </Td>
                  <Td>
                    <PaymentStatusBadge
                      status={order.paymentStatus}
                      method={order.paymentMethod}
                    />
                  </Td>
                  <Td align="right" numeric className="font-medium">
                    {formatPaise(order.totalPaise)}
                    {order.refundedPaise > 0 ? (
                      <p className="text-muted-foreground text-[10px] font-normal">
                        −{formatPaise(order.refundedPaise)} refunded
                      </p>
                    ) : null}
                  </Td>
                  <Td align="right" numeric className="text-muted-foreground">
                    {formatIstDate(order.placedAt)}
                  </Td>
                </Tr>
              ))}
            </DataTableBody>
          </DataTable>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Internal notes
// ---------------------------------------------------------------------------

function NotesSection({ customer }: { customer: CustomerDetail }) {
  const [pending, startTransition] = React.useTransition();
  const [notes, setNotes] = React.useState(customer.notes ?? "");
  const [error, setError] = React.useState<string | undefined>();

  const dirty = notes !== (customer.notes ?? "");

  function save() {
    startTransition(async () => {
      const result = await updateCustomerNotes({ id: customer.id, notes });

      if (result.ok) {
        setError(undefined);
        setNotes(notes.trim());
      } else {
        setError(result.fieldErrors?.notes);
      }

      report(result);
    });
  }

  return (
    <Section
      title="Internal notes"
      description="Admin-only. Nothing here is ever sent to the customer or served to the storefront."
    >
      <Textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="Delivery preferences, a returns conversation, why this record was blocked…"
        rows={3}
        className="min-h-20 text-xs"
        aria-invalid={Boolean(error)}
      />
      <FieldError message={error} />
      <div className="mt-2 flex justify-end">
        <Button size="xs" onClick={save} disabled={!dirty || pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Save notes
        </Button>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Honesty
// ---------------------------------------------------------------------------

function PrivacySection() {
  return (
    <section className="px-4 py-3">
      <div className="text-muted-foreground flex items-start gap-2 rounded-lg border border-dashed px-3 py-2 text-[11px] leading-relaxed">
        <Info className="mt-px size-3.5 shrink-0" />
        <p>
          Cart and wishlist are not shown here because the storefront keeps both
          in the shopper&rsquo;s own browser localStorage and never sends them to
          a server, so there is genuinely nothing to display.
        </p>
      </div>
    </section>
  );
}
