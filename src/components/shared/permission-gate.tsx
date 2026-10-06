"use client";

import * as React from "react";

import { hasPermission } from "@/lib/permissions";

/**
 * Hides UI the actor is not allowed to use. This is a courtesy, not security:
 * the Server Action or route behind the button re-checks with
 * requirePermissionOrThrow, and would reject the call if this were bypassed.
 * What the gate buys is a cleaner screen and no "Forbidden" toast surprises.
 *
 * The actor's permission list is passed in (the page has it from
 * requirePermission) or read from the nearest PermissionProvider - the shell
 * layout wraps the app in one so deep components need not thread it.
 *
 * @example
 *   <PermissionGate require="orders.refund" fallback={null}>
 *     <Button>Refund</Button>
 *   </PermissionGate>
 */
export function PermissionGate({
  permissions,
  require,
  children,
  fallback = null,
}: {
  /** The actor's codes; falls back to PermissionProvider when omitted. */
  permissions?: readonly string[] | ReadonlySet<string>;
  /** One code, or any-of a list. */
  require: string | readonly string[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const context = React.useContext(PermissionContext);
  const source = permissions ?? context?.permissions ?? [];
  const isSuperAdmin = permissions === undefined && (context?.isSuperAdmin ?? false);
  const set = source instanceof Set ? (source as ReadonlySet<string>) : new Set(source);

  const allowed = isSuperAdmin || hasPermission(set, require);
  return <>{allowed ? children : fallback}</>;
}

type PermissionContextValue = {
  permissions: readonly string[];
  isSuperAdmin: boolean;
};

const PermissionContext = React.createContext<PermissionContextValue | null>(null);

/** Provide once in the shell layout with the resolved Actor's grants. */
export function PermissionProvider({
  permissions,
  isSuperAdmin = false,
  children,
}: PermissionContextValue & { children: React.ReactNode }) {
  const value = React.useMemo(() => ({ permissions, isSuperAdmin }), [permissions, isSuperAdmin]);
  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

/** Hook form of the gate, for disabling rather than hiding. */
export function usePermission(require: string | readonly string[]): boolean {
  const context = React.useContext(PermissionContext);
  if (!context) return false;
  if (context.isSuperAdmin) return true;
  return hasPermission(new Set(context.permissions), require);
}
