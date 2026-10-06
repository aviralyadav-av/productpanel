"use client";

import Link from "next/link";
import type { Route } from "next";
import { AlertTriangle, History, Mail, Send } from "lucide-react";

import { formatIstDateTime } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/shared/status-badge";

import { describeVariable } from "@/features/email/templates-samples";
import type { TemplateEditorData } from "@/features/email/templates-schemas";

/**
 * The three side panels of the template editor, split out to keep the editor
 * itself readable: what variables exist and what they mean, the delivery
 * counters with the test-send and restore buttons, and the audit trail.
 *
 * All presentational - every mutation is handled by the editor above them.
 */

export function VariablesPanel({
  documented,
  unknown,
  unused,
  canManage,
  eventKey,
  eventDescription,
  onInsert,
}: {
  documented: string[];
  unknown: string[];
  unused: string[];
  canManage: boolean;
  eventKey: string | null;
  eventDescription: string | null;
  onInsert: (variable: string) => void;
}) {
  return (
    <section className="surface overflow-hidden">
      <header className="border-b px-4 py-2">
        <h2 className="text-xs font-semibold tracking-tight">Variables</h2>
        <p className="text-muted-foreground text-[11px]">
          {eventDescription}
          {eventKey ? (
            <>
              {" "}
              <code className="bg-muted rounded px-1 py-0.5">{eventKey}</code>
            </>
          ) : null}
        </p>
      </header>

      <div className="space-y-3 p-3">
        {unknown.length > 0 ? (
          <div className="border-warning/40 bg-warning-muted/40 rounded-md border p-2.5">
            <p className="text-warning flex items-center gap-1.5 text-xs font-medium">
              <AlertTriangle className="size-3.5" /> Unknown variables
            </p>
            <p className="text-muted-foreground mt-1 text-[11px]">
              Nothing supplies these, so they are mailed out literally as{" "}
              <code className="bg-muted rounded px-1">{`{{name}}`}</code>. Fix the spelling or remove them.
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {unknown.map((name) => (
                <code key={name} className="bg-destructive/10 text-destructive rounded px-1.5 py-0.5 text-[11px]">
                  {name}
                </code>
              ))}
            </div>
          </div>
        ) : null}

        <ul className="space-y-1.5">
          {documented.map((name) => (
            <li key={name} className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <code className="bg-muted rounded px-1.5 py-0.5 text-[11px]">{`{{${name}}}`}</code>
                <p className="text-muted-foreground mt-0.5 text-[11px] leading-snug">{describeVariable(name)}</p>
              </div>
              {canManage ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => onInsert(name)}
                  aria-label={`Insert ${name}`}
                >
                  Insert
                </Button>
              ) : null}
            </li>
          ))}
        </ul>

        {unused.length > 0 ? (
          <p className="text-muted-foreground border-t pt-2 text-[11px]">
            Not used in this template: {unused.join(", ")}.
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function SendPanel({
  template,
  pending,
  canManage,
  onSendTest,
  onRestore,
}: {
  template: TemplateEditorData;
  pending: boolean;
  canManage: boolean;
  onSendTest: () => void;
  onRestore: () => void;
}) {
  return (
    <section className="surface overflow-hidden">
      <header className="border-b px-4 py-2">
        <h2 className="text-xs font-semibold tracking-tight">Delivery</h2>
      </header>
      <div className="space-y-3 p-3 text-xs">
        <dl className="grid grid-cols-2 gap-y-1.5">
          <dt className="text-muted-foreground">Sent</dt>
          <dd data-numeric className="text-right">
            {template.stats.sent}
          </dd>
          <dt className="text-muted-foreground">Queued</dt>
          <dd data-numeric className="text-right">
            {template.stats.queued}
          </dd>
          <dt className="text-muted-foreground">Failed</dt>
          <dd data-numeric className="text-right">
            {template.stats.failed > 0 ? (
              <Link
                className="text-destructive hover:underline"
                href={`/admin/email-templates?tab=outbox&status=FAILED&templateKey=${template.key}` as Route}
              >
                {template.stats.failed}
              </Link>
            ) : (
              0
            )}
          </dd>
          <dt className="text-muted-foreground">Last sent</dt>
          <dd className="text-right">
            {template.stats.lastSentAt ? formatIstDateTime(new Date(template.stats.lastSentAt)) : "Never"}
          </dd>
        </dl>

        {canManage ? (
          <div className="space-y-2 border-t pt-3">
            <Button type="button" variant="outline" size="sm" className="w-full" disabled={pending} onClick={onSendTest}>
              <Send /> Send test email to me
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              disabled={pending || !template.restorePoint}
              onClick={onRestore}
            >
              <History /> Restore previous version
            </Button>
            <p className="text-muted-foreground text-[11px]">
              {template.restorePoint
                ? `Would undo the change made by ${template.restorePoint.actorEmail} on ${formatIstDateTime(new Date(template.restorePoint.at))}.`
                : "No earlier version yet — this template has not been edited since it was seeded."}
            </p>
          </div>
        ) : null}

        <p className="text-muted-foreground border-t pt-3 text-[11px]">
          <Mail className="mr-1 inline size-3" />
          Test emails go to your own admin address through the outbox, so they are retried and visible like any other
          send.
        </p>
      </div>
    </section>
  );
}

export function ActivityPanel({ template }: { template: TemplateEditorData }) {
  if (template.activity.length === 0) {
    return (
      <section className="surface p-4">
        <h2 className="text-xs font-semibold tracking-tight">Activity</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          Nothing recorded yet. Saves, enable/disable, test sends and restores appear here and in the audit log.
        </p>
      </section>
    );
  }

  return (
    <section className="surface overflow-hidden">
      <header className="border-b px-4 py-2">
        <h2 className="text-xs font-semibold tracking-tight">Activity</h2>
      </header>
      <ul className="divide-y">
        {template.activity.map((row) => (
          <li key={row.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2 text-xs">
            <StatusPill label={row.action.replace("email_template.", "")} tone="neutral" dot={false} />
            <span className="min-w-0 flex-1">{row.summary}</span>
            <span className="text-muted-foreground/80 text-[11px]">
              {row.actorEmail} · {formatIstDateTime(new Date(row.createdAt))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
