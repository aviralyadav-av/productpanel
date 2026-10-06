"use client";

import * as React from "react";
import { Info, Lock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import type { PermissionGroupView } from "@/features/roles/queries";

/**
 * The permission matrix editor (blueprint §3, §14.D3/D14).
 *
 * Grouped by module with a group-level select-all, because a role is almost
 * always described as "everything in Orders plus read-only Customers" rather
 * than as 31 individual codes.
 *
 * Codes the ACTOR does not hold are rendered disabled with the reason: D3 says
 * you cannot grant what you lack, and showing the code greyed out explains the
 * rule far better than hiding it would.
 */
export function PermissionMatrix({
  groups,
  selected,
  onChange,
  grantable,
  disabled,
}: {
  groups: PermissionGroupView[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  /** Codes this actor may grant. Anything else is locked. */
  grantable: ReadonlySet<string>;
  disabled?: boolean;
}) {
  function toggle(code: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(code);
    else next.delete(code);
    onChange(next);
  }

  function toggleGroup(codes: readonly string[], on: boolean) {
    const next = new Set(selected);
    for (const code of codes) {
      if (!grantable.has(code)) continue;
      if (on) next.add(code);
      else next.delete(code);
    }
    onChange(next);
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {groups.map((group) => {
        const codes = group.codes.map((item) => item.code);
        const allowed = codes.filter((code) => grantable.has(code));
        const checkedCount = codes.filter((code) => selected.has(code)).length;
        const allChecked = allowed.length > 0 && allowed.every((code) => selected.has(code));

        return (
          <fieldset key={group.group} className="rounded-lg border p-3">
            <legend className="sr-only">{group.label}</legend>
            <div className="flex items-center justify-between gap-2 pb-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold">
                <Checkbox
                  checked={allChecked}
                  onCheckedChange={(value) => toggleGroup(codes, value === true)}
                  disabled={disabled || allowed.length === 0}
                  aria-label={`Select all ${group.label} permissions`}
                />
                {group.label}
              </label>
              <span data-numeric className="text-muted-foreground text-[10px]">
                {checkedCount}/{codes.length}
              </span>
            </div>

            <ul className="space-y-1">
              {group.codes.map((permission) => {
                const locked = !grantable.has(permission.code);
                return (
                  <li key={permission.code} className="flex items-start gap-2">
                    <Checkbox
                      id={`perm-${permission.code}`}
                      checked={selected.has(permission.code)}
                      onCheckedChange={(value) => toggle(permission.code, value === true)}
                      disabled={disabled || locked}
                      className="mt-0.5"
                    />
                    <label
                      htmlFor={`perm-${permission.code}`}
                      className="min-w-0 flex-1 cursor-pointer text-[11px] leading-tight"
                    >
                      <span className="flex flex-wrap items-center gap-1">
                        {permission.label}
                        <code className="text-muted-foreground/70 text-[10px]">
                          {permission.code}
                        </code>
                        {permission.superAdminOnly ? (
                          <Badge variant="outline" className="h-4 gap-1 px-1 text-[10px] font-normal">
                            <Lock className="size-2.5" />
                            super-admin only
                          </Badge>
                        ) : null}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-muted-foreground/60 cursor-help">
                              <Info className="size-3" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            {permission.description}
                            {locked ? " — you do not hold this permission, so you cannot grant it." : ""}
                          </TooltipContent>
                        </Tooltip>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}
    </div>
  );
}
