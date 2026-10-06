"use server";

import { revalidatePath } from "next/cache";

import { ok, runAction, zodFail, type ActionResult } from "@/lib/action-result";
import { forbiddenError } from "@/lib/api/errors";
import { can, requirePermissionOrThrow } from "@/lib/auth/guards";
import type { CustomerStatus } from "@/lib/enums";

import {
  addressSchema,
  BULK_OP_PERMISSION,
  bulkRequestSchema,
  customerFormSchema,
  customerPatchSchema,
  deleteCustomerSchema,
  setStatusSchema,
  type AddressInput,
  type BulkRequest,
  type CustomerFormInput,
} from "./schemas";
import {
  bulkCustomers,
  createAddress,
  createCustomer,
  deleteAddress,
  requestCustomerPasswordReset,
  setCustomerStatus,
  softDeleteCustomer,
  updateAddress,
  updateCustomer,
  type AddressRecord,
  type BulkResult,
} from "./service";

/**
 * Server Actions for the customer list and profile. Each one is permission ->
 * zod -> service -> revalidate -> ActionResult; the service owns the
 * transaction and the audit row (blueprint section 7).
 */

const LIST_PATH = "/admin/customers";

function revalidate(id?: string): void {
  revalidatePath(LIST_PATH);
  if (id) revalidatePath(`${LIST_PATH}/${id}`);
}

export async function createCustomerAction(input: CustomerFormInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("customers.create");
    const parsed = customerFormSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const customer = await createCustomer(parsed.data, actor);
    revalidate(customer.id);
    return ok({ id: customer.id }, `Created ${customer.fullName ?? customer.email}.`);
  });
}

export async function updateCustomerAction(id: string, input: Partial<CustomerFormInput>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("customers.edit");
    const parsed = customerPatchSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    await updateCustomer(id, parsed.data, actor);
    revalidate(id);
    return ok({ id }, "Profile saved.");
  });
}

export async function setCustomerStatusAction(id: string, status: CustomerStatus, reason?: string): Promise<ActionResult<{ status: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("customers.block");
    const parsed = setStatusSchema.safeParse({ status, reason });
    if (!parsed.success) return zodFail(parsed.error);
    const customer = await setCustomerStatus(id, parsed.data.status, actor, { reason: parsed.data.reason });
    revalidate(id);
    return ok({ status: customer.status }, status === "BLOCKED" ? "Customer blocked and signed out everywhere." : "Customer unblocked.");
  });
}

export async function sendPasswordResetAction(id: string): Promise<ActionResult<{ expiresAt: string; emailQueued: boolean }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("customers.reset_password");
    const result = await requestCustomerPasswordReset(id, actor);
    revalidate(id);
    return ok(
      { expiresAt: result.expiresAt.toISOString(), emailQueued: result.emailQueued },
      result.emailQueued ? "Password reset link emailed." : "Reset link created, but no email was queued - check the customer_password_reset template.",
    );
  });
}

export async function deleteCustomerAction(id: string, reason?: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("customers.delete");
    const parsed = deleteCustomerSchema.safeParse({ reason });
    if (!parsed.success) return zodFail(parsed.error);
    await softDeleteCustomer(id, actor, { reason: parsed.data.reason });
    revalidate(id);
    return ok({ id }, "Customer deleted. Orders keep their history.");
  });
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

export async function saveAddressAction(customerId: string, addressId: string | null, input: AddressInput): Promise<ActionResult<AddressRecord>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("customers.edit");
    const parsed = addressSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    const address = addressId ? await updateAddress(customerId, addressId, parsed.data, actor) : await createAddress(customerId, parsed.data, actor);
    revalidate(customerId);
    return ok(address, addressId ? "Address updated." : "Address added.");
  });
}

export async function setDefaultAddressAction(customerId: string, addressId: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("customers.edit");
    await updateAddress(customerId, addressId, { isDefault: true }, actor);
    revalidate(customerId);
    return ok({ id: addressId }, "Default address updated.");
  });
}

export async function deleteAddressAction(customerId: string, addressId: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("customers.edit");
    await deleteAddress(customerId, addressId, actor);
    revalidate(customerId);
    return ok({ id: addressId }, "Address removed.");
  });
}

// ---------------------------------------------------------------------------
// Bulk
// ---------------------------------------------------------------------------

export async function bulkCustomersAction(input: BulkRequest): Promise<ActionResult<BulkResult>> {
  return runAction(async () => {
    const actor = await requirePermissionOrThrow("customers.view");
    const parsed = bulkRequestSchema.safeParse(input);
    if (!parsed.success) return zodFail(parsed.error);
    if (!can(actor, BULK_OP_PERMISSION[parsed.data.op])) throw forbiddenError(`Requires ${BULK_OP_PERMISSION[parsed.data.op]}.`);
    const result = await bulkCustomers(parsed.data, actor);
    revalidate();
    return ok(result, result.summary);
  });
}
