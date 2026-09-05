"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import { requireAdminOrThrow } from "@/lib/auth/guards";
import { diffOf, writeAudit } from "@/lib/audit";
import { fail, ok, runAction, zodFail, type ActionResult } from "@/lib/action-result";
import { CUSTOMER_STATUS_META, type CustomerStatus } from "@/lib/enums";
import {
  setCustomerStatusSchema,
  updateCustomerNotesSchema,
  updateCustomerProfileSchema,
  type SetCustomerStatusInput,
  type UpdateCustomerNotesInput,
  type UpdateCustomerProfileInput,
} from "./schemas";

/**
 * Inputs are typed for the caller AND re-validated here. The type is a
 * convenience for the sheet; the safeParse is the actual boundary, because a
 * Server Action is a public HTTP endpoint that anyone can post anything to.
 */

/** Empty text from a form means "cleared", which the column stores as NULL. */
function orNull(value: string): string | null {
  return value.length > 0 ? value : null;
}

function describe(customer: { fullName: string | null; email: string }): string {
  return customer.fullName ?? customer.email;
}

// ---------------------------------------------------------------------------

export async function setCustomerStatus(
  input: SetCustomerStatusInput,
): Promise<ActionResult<{ id: string; status: CustomerStatus }>> {
  const actor = await requireAdminOrThrow();

  const parsed = setCustomerStatusSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  return runAction(async () => {
    const { id, status } = parsed.data;

    const existing = await db.customer.findUnique({
      where: { id },
      select: { id: true, email: true, fullName: true, status: true },
    });
    if (!existing) return fail("That customer record no longer exists.");

    if (existing.status === status) {
      return ok(
        { id, status },
        `Already ${CUSTOMER_STATUS_META[status].label.toLowerCase()}.`,
      );
    }

    await db.customer.update({ where: { id }, data: { status } });

    await writeAudit({
      actor,
      action: status === "BLOCKED" ? "customer.block" : "customer.unblock",
      entityType: "Customer",
      entityId: id,
      summary: `${status === "BLOCKED" ? "Blocked" : "Unblocked"} ${describe(existing)}`,
      diff: diffOf({ status: existing.status }, { status }),
    });

    revalidatePath("/customers");

    return ok(
      { id, status },
      status === "BLOCKED"
        ? "Customer blocked. This is an admin-side flag only."
        : "Customer unblocked.",
    );
  });
}

// ---------------------------------------------------------------------------

export async function updateCustomerNotes(
  input: UpdateCustomerNotesInput,
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireAdminOrThrow();

  const parsed = updateCustomerNotesSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  return runAction(async () => {
    const { id, notes } = parsed.data;

    const existing = await db.customer.findUnique({
      where: { id },
      select: { id: true, email: true, fullName: true, notes: true },
    });
    if (!existing) return fail("That customer record no longer exists.");

    const next = orNull(notes);
    if ((existing.notes ?? null) === next) {
      return ok({ id }, "No change to save.");
    }

    await db.customer.update({ where: { id }, data: { notes: next } });

    await writeAudit({
      actor,
      action: "customer.notes_update",
      entityType: "Customer",
      entityId: id,
      summary: `Updated internal notes for ${describe(existing)}`,
      // The note bodies themselves go into the diff so the audit trail shows
      // what an operator actually wrote, not just that they wrote something.
      diff: diffOf({ notes: existing.notes }, { notes: next }),
    });

    revalidatePath("/customers");

    return ok({ id }, "Notes saved.");
  });
}

// ---------------------------------------------------------------------------

export async function updateCustomerProfile(
  input: UpdateCustomerProfileInput,
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireAdminOrThrow();

  const parsed = updateCustomerProfileSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);

  return runAction(async () => {
    const { id, fullName, phone, email } = parsed.data;

    const existing = await db.customer.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
      },
    });
    if (!existing) return fail("That customer record no longer exists.");

    // Checked up front so the operator gets the error on the email field
    // rather than the generic unique-constraint sentence. runAction still
    // catches P2002 if two admins save the same address at the same moment.
    if (email !== existing.email) {
      const clash = await db.customer.findFirst({
        where: { email, NOT: { id } },
        select: { id: true },
      });
      if (clash) {
        return fail("Another customer already uses that email address.", {
          email: "This email belongs to a different customer record.",
        });
      }
    }

    const before = {
      fullName: existing.fullName,
      phone: existing.phone,
      email: existing.email,
    };
    const after = {
      fullName: orNull(fullName),
      phone: orNull(phone),
      email,
    };

    const diff = diffOf(before, after);
    if (!diff) return ok({ id }, "No change to save.");

    await db.customer.update({ where: { id }, data: after });

    await writeAudit({
      actor,
      action: "customer.profile_update",
      entityType: "Customer",
      entityId: id,
      summary: `Updated contact details for ${describe(existing)}`,
      diff,
    });

    revalidatePath("/customers");

    return ok({ id }, "Contact details saved.");
  });
}
