"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { CheckCircle2, RotateCcw, ShieldAlert } from "lucide-react";

import { INQUIRY_PRIORITIES, INQUIRY_PRIORITY_META, INQUIRY_TYPES, INQUIRY_TYPE_META, type InquiryPriority, type InquiryType } from "@/lib/enums";
import { formatIstDateTime } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/shared/copy-button";
import { KeyValueList } from "@/components/shared/key-value-list";
import { Panel } from "@/components/shared/panel";
import { PermissionGate, usePermission } from "@/components/shared/permission-gate";
import { StatusTimeline } from "@/components/shared/status-timeline";
import { useActionToast } from "@/components/shared/use-action-toast";

import { assignInquiryAction, setInquiryStatusAction, updateInquiryAction } from "@/features/inquiries/actions";
import { InquiryPriorityBadge, InquiryStatusBadge, InquiryTypeBadge } from "@/features/inquiries/components/inquiry-table";
import type { AssigneeRef, InquiryDetail } from "@/features/inquiries/types";

const selectClass = "border-input bg-background h-8 w-full rounded-md border px-2 text-xs disabled:opacity-60";

/** Contact details, order link, triage controls and the audit trail. */
export function InquirySidebar({ inquiry, users }: { inquiry: InquiryDetail; users: AssigneeRef[] }) {
  const router = useRouter();
  const { run, pending } = useActionToast();
  const canManage = usePermission("inquiries.manage");

  const refresh = () => router.refresh();

  return (
    <div className="space-y-4">
      <Panel title="Status" bodyClassName="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <InquiryStatusBadge status={inquiry.status} />
          <InquiryPriorityBadge priority={inquiry.priority} />
          <InquiryTypeBadge type={inquiry.type} />
        </div>
        <PermissionGate require="inquiries.manage">
          <div className="flex flex-wrap gap-2">
            {inquiry.status !== "RESOLVED" ? (
              <Button size="sm" disabled={pending} onClick={() => void run(() => setInquiryStatusAction({ id: inquiry.id, status: "RESOLVED" }), { onSuccess: refresh })}>
                <CheckCircle2 /> Resolve
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => void run(() => setInquiryStatusAction({ id: inquiry.id, status: "OPEN" }), { onSuccess: refresh })}>
                <RotateCcw /> Reopen
              </Button>
            )}
            {inquiry.status !== "SPAM" ? (
              <Button size="sm" variant="ghost" className="text-destructive" disabled={pending} onClick={() => void run(() => setInquiryStatusAction({ id: inquiry.id, status: "SPAM" }), { onSuccess: refresh })}>
                <ShieldAlert /> Mark as spam
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => void run(() => setInquiryStatusAction({ id: inquiry.id, status: "OPEN" }), { onSuccess: refresh })}>
                <RotateCcw /> Not spam
              </Button>
            )}
          </div>
        </PermissionGate>
        <div className="grid gap-2">
          <label className="text-muted-foreground text-[11px] font-medium">
            Type
            <select
              className={selectClass}
              value={inquiry.type}
              disabled={!canManage || pending}
              onChange={(event) => void run(() => updateInquiryAction({ id: inquiry.id, patch: { type: event.target.value as InquiryType } }), { onSuccess: refresh })}
            >
              {INQUIRY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {INQUIRY_TYPE_META[type].label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-muted-foreground text-[11px] font-medium">
            Priority
            <select
              className={selectClass}
              value={inquiry.priority}
              disabled={!canManage || pending}
              onChange={(event) => void run(() => updateInquiryAction({ id: inquiry.id, patch: { priority: event.target.value as InquiryPriority } }), { onSuccess: refresh })}
            >
              {INQUIRY_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {INQUIRY_PRIORITY_META[priority].label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-muted-foreground text-[11px] font-medium">
            Assigned to
            <select
              className={selectClass}
              value={inquiry.assignedTo?.id ?? ""}
              disabled={!canManage || pending}
              onChange={(event) => void run(() => assignInquiryAction({ id: inquiry.id, assignedToId: event.target.value || null }), { onSuccess: refresh })}
            >
              <option value="">Unassigned</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name ?? user.email}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Panel>

      <Panel title="Contact">
        <KeyValueList
          dense
          items={[
            { label: "Name", value: inquiry.name },
            {
              label: "Email",
              value: (
                <span className="inline-flex items-center gap-1">
                  <a href={`mailto:${inquiry.email}`} className="truncate hover:underline">
                    {inquiry.email}
                  </a>
                  <CopyButton value={inquiry.email} size="icon-xs" variant="ghost" label="Copy email" />
                </span>
              ),
            },
            { label: "Phone", value: inquiry.phone ?? "—" },
            {
              label: "Customer",
              value: inquiry.customer ? (
                <Link href={`/admin/customers/${inquiry.customer.id}` as Route} className="hover:underline">
                  {inquiry.customer.name ?? "Open profile"}
                </Link>
              ) : (
                "No account with this email"
              ),
            },
            {
              label: "Order",
              value: inquiry.order ? (
                <Link href={`/admin/orders/${inquiry.order.id}` as Route} className="hover:underline">
                  <span className="font-mono">{inquiry.order.orderNumber}</span> · {inquiry.order.status.toLowerCase()} · {formatPaise(inquiry.order.totalPaise)}
                </Link>
              ) : (
                "—"
              ),
            },
            { label: "Received", value: formatIstDateTime(new Date(inquiry.createdAt)) },
            { label: "Resolved", value: inquiry.resolvedAt ? formatIstDateTime(new Date(inquiry.resolvedAt)) : "—" },
            { label: "Ticket id", value: <span className="font-mono text-[11px]">{inquiry.id}</span> },
          ]}
        />
      </Panel>

      <Panel title="Activity">
        <StatusTimeline
          emptyText="No activity yet."
          events={inquiry.activity.map((row) => ({
            id: row.id,
            title: row.summary,
            description: row.action,
            actor: row.actor,
            at: new Date(row.at),
            tone: row.action.includes("spam") ? "danger" : row.action.includes("reply") ? "success" : "neutral",
          }))}
        />
      </Panel>
    </div>
  );
}
