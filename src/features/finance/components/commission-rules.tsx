"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Pencil, Plus, Power, Trash2 } from "lucide-react";

import { COMMISSION_SCOPE_META } from "@/lib/enums";
import { formatIstDate } from "@/lib/dates";
import { formatNumber, formatPaise } from "@/lib/money";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { DataTable, DataTableBody, DataTableHead, Td, Th, Tr } from "@/components/shared/data-table";
import { MobileCard, MobileCardField, ResponsiveTable } from "@/components/shared/responsive-table";
import { SortableTh } from "@/components/shared/sortable-th";
import { StatusPill } from "@/components/shared/status-badge";
import { useActionToast } from "@/components/shared/use-action-toast";

import { deleteCommissionRuleAction, setCommissionRuleActiveAction } from "../actions";
import type { CommissionRuleRow } from "../queries";
import { formatBps, formatWindow } from "../ui-identity";
import { CommissionRuleDialog } from "./commission-rule-dialog";

/**
 * The commission rules table (blueprint §14.B3).
 *
 * A Client Component because the row menu opens a dialog and a confirm; the
 * list state itself (search, scope tab, sort, page) stays in the URL.
 *
 * The GLOBAL row is shown but cannot be toggled or deleted from here - it is
 * the fallback every other rule resolves down to, and the card above the table
 * is where its rate is edited.
 */

export function CommissionRulesTable({
  rows,
  sort,
  order,
  canManage,
}: {
  rows: CommissionRuleRow[];
  sort: string;
  order: "asc" | "desc";
  canManage: boolean;
}) {
  const router = useRouter();
  const { run } = useActionToast();
  const [confirm, confirmDialog] = useConfirm();
  const [editing, setEditing] = React.useState<CommissionRuleRow | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  function edit(rule: CommissionRuleRow) {
    setEditing(rule);
    setDialogOpen(true);
  }

  async function toggle(rule: CommissionRuleRow) {
    await run(() => setCommissionRuleActiveAction(rule.id, !rule.isActive), {
      onSuccess: () => router.refresh(),
    });
  }

  async function remove(rule: CommissionRuleRow) {
    const result = await confirm({
      title: `Delete this ${COMMISSION_SCOPE_META[rule.scope].label.toLowerCase()} rule?`,
      description:
        rule.usageCount > 0
          ? `${formatNumber(rule.usageCount)} past order line${rule.usageCount === 1 ? " was" : "s were"} priced with it. Those keep their snapshotted rate - only future sales change.`
          : "Future sales for this target will fall back to the next rule in the chain.",
      confirmLabel: "Delete rule",
      destructive: true,
    });
    if (!result.ok) return;
    await run(() => deleteCommissionRuleAction(rule.id), { onSuccess: () => router.refresh() });
  }

  const table = (
    <DataTable>
      <DataTableHead>
        <SortableTh column="scope" label="Scope" currentSort={sort} currentOrder={order} defaultOrder="asc" />
        <Th>Applies to</Th>
        <SortableTh column="rateBps" label="Rate" currentSort={sort} currentOrder={order} align="right" />
        <SortableTh column="fixedPaise" label="Fixed / unit" currentSort={sort} currentOrder={order} align="right" />
        <Th>Window</Th>
        <Th>Status</Th>
        <Th>Note</Th>
        <SortableTh column="updatedAt" label="Updated" currentSort={sort} currentOrder={order} align="right" />
        <Th width="3rem">
          <span className="sr-only">Actions</span>
        </Th>
      </DataTableHead>
      <DataTableBody>
        {rows.map((rule) => (
          <Tr key={rule.id}>
            <Td>
              <StatusPill
                label={COMMISSION_SCOPE_META[rule.scope].label}
                tone={COMMISSION_SCOPE_META[rule.scope].tone}
              />
            </Td>
            <Td>
              <TargetCell rule={rule} />
            </Td>
            <Td align="right" numeric className="text-xs">
              {formatBps(rule.rateBps)}
            </Td>
            <Td align="right" numeric className="text-xs">
              {rule.fixedPaise > 0 ? formatPaise(rule.fixedPaise) : <span className="text-muted-foreground/70">—</span>}
            </Td>
            <Td className="text-xs">{formatWindow(rule.startsAt, rule.endsAt, formatIstDate)}</Td>
            <Td>
              <StatusPill
                label={rule.isActive ? "Active" : "Inactive"}
                tone={rule.isActive ? "success" : "neutral"}
              />
            </Td>
            <Td>
              <span className="text-muted-foreground block max-w-[16rem] truncate text-xs">
                {rule.note ?? "—"}
              </span>
            </Td>
            <Td align="right" numeric className="text-xs">
              {formatIstDate(new Date(rule.updatedAt))}
            </Td>
            <Td align="right">
              <RowActions rule={rule} canManage={canManage} onEdit={edit} onToggle={toggle} onDelete={remove} />
            </Td>
          </Tr>
        ))}
      </DataTableBody>
    </DataTable>
  );

  const cards = rows.map((rule) => (
    <MobileCard
      key={rule.id}
      title={rule.targetLabel ?? rule.targetKey}
      subtitle={COMMISSION_SCOPE_META[rule.scope].label}
      meta={<StatusPill label={rule.isActive ? "Active" : "Inactive"} tone={rule.isActive ? "success" : "neutral"} />}
    >
      <MobileCardField label="Rate" numeric>
        {formatBps(rule.rateBps)}
      </MobileCardField>
      <MobileCardField label="Fixed / unit" numeric>
        {rule.fixedPaise > 0 ? formatPaise(rule.fixedPaise) : "—"}
      </MobileCardField>
      <MobileCardField label="Window">{formatWindow(rule.startsAt, rule.endsAt, formatIstDate)}</MobileCardField>
      <MobileCardField label="Actions">
        <RowActions rule={rule} canManage={canManage} onEdit={edit} onToggle={toggle} onDelete={remove} />
      </MobileCardField>
    </MobileCard>
  ));

  return (
    <>
      <ResponsiveTable table={table} cards={cards} />
      <CommissionRuleDialog open={dialogOpen} onOpenChange={setDialogOpen} rule={editing} />
      {confirmDialog}
    </>
  );
}

function TargetCell({ rule }: { rule: CommissionRuleRow }) {
  if (rule.scope === "GLOBAL") {
    return <span className="text-sm">Every sale (fallback)</span>;
  }
  if (!rule.targetLabel) {
    // The FK is SetNull-free (Cascade), so this only happens for a rule whose
    // target was removed in the same breath - flagging it beats a blank cell.
    return (
      <span className="text-destructive font-mono text-xs" title={rule.targetKey}>
        Missing target
      </span>
    );
  }
  return rule.targetHref ? (
    <Link href={rule.targetHref} className="block min-w-0 hover:underline">
      <span className="block truncate text-sm">{rule.targetLabel}</span>
      {rule.targetSubtitle ? (
        <span className="text-muted-foreground block truncate font-mono text-[11px]">{rule.targetSubtitle}</span>
      ) : null}
    </Link>
  ) : (
    <span className="text-sm">{rule.targetLabel}</span>
  );
}

function RowActions({
  rule,
  canManage,
  onEdit,
  onToggle,
  onDelete,
}: {
  rule: CommissionRuleRow;
  canManage: boolean;
  onEdit: (rule: CommissionRuleRow) => void;
  onToggle: (rule: CommissionRuleRow) => void;
  onDelete: (rule: CommissionRuleRow) => void;
}) {
  if (!canManage) return null;
  const isGlobal = rule.scope === "GLOBAL";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${rule.targetLabel ?? rule.targetKey}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>{COMMISSION_SCOPE_META[rule.scope].label} rule</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onEdit(rule)}>
          <Pencil />
          Edit
        </DropdownMenuItem>
        {isGlobal ? null : (
          <>
            <DropdownMenuItem onSelect={() => onToggle(rule)}>
              <Power />
              {rule.isActive ? "Deactivate" : "Activate"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(rule)}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Toolbar button that opens the create dialog. */
export function NewCommissionRuleButton() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus />
        New rule
      </Button>
      <CommissionRuleDialog open={open} onOpenChange={setOpen} rule={null} />
    </>
  );
}
