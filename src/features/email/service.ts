import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { enqueue } from "@/lib/queue";
import { readSettingStrings } from "@/features/finance/settings-reader";
import { escapeHtml, renderTemplate, type EmailVars } from "./render";

/**
 * Email QUEUEING (blueprint §10, F6). Sending is the `email.send` job handler
 * owned by the infra engineer; this module only decides what goes into the
 * outbox and guarantees it goes there once.
 *
 * Every email is an EmailOutbox row first, and the send job references the row
 * by id. That is what makes an email survive a crashed worker, appear on the
 * admin outbox page before it is sent, and never be sent for a transaction
 * that rolled back (pass `tx` and the row commits with the order).
 *
 * `dedupeKey` = `${templateKey}:${entity.type}:${entity.id}` means "one
 * order_confirmation per order", however many times the flow re-runs.
 */

export type EmailRecipient = { email: string; name?: string | null };
export type EmailEntity = { type: string; id: string };

export type QueueEmailInput = {
  templateKey: string;
  to: EmailRecipient;
  vars: EmailVars;
  entity?: EmailEntity;
  /** Overrides the derived key; pass null to disable deduplication. */
  dedupeKey?: string | null;
  scheduledAt?: Date;
  tx?: Prisma.TransactionClient;
};

export type QueueRawEmailInput = {
  to: EmailRecipient;
  subject: string;
  html: string;
  text?: string;
  entity?: EmailEntity;
  dedupeKey?: string | null;
  scheduledAt?: Date;
  tx?: Prisma.TransactionClient;
};

export type QueueEmailResult =
  | { queued: true; outboxId: string; jobId: string }
  | {
      queued: false;
      outboxId: string | null;
      reason: "duplicate" | "template_missing" | "template_inactive" | "no_recipient";
    };

/** Variables every template may use without the caller supplying them (seed COMMON). */
export async function commonEmailVars(tx?: Prisma.TransactionClient): Promise<EmailVars> {
  const settings = await readSettingStrings(tx, [
    "store.name",
    "storefront.base_url",
    "store.contact_email",
  ]);
  return {
    store_name: settings["store.name"],
    store_url: settings["storefront.base_url"],
    support_email: settings["store.contact_email"],
  };
}

export function emailDedupeKey(templateKey: string, entity: EmailEntity): string {
  return `${templateKey}:${entity.type}:${entity.id}`;
}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function writeOutbox(input: {
  tx?: Prisma.TransactionClient;
  templateKey: string | null;
  to: EmailRecipient;
  subject: string;
  html: string;
  text: string | null;
  entity?: EmailEntity;
  dedupeKey: string | null;
  scheduledAt?: Date;
}): Promise<QueueEmailResult> {
  const client = input.tx ?? db;
  const email = normaliseEmail(input.to.email);
  if (!email) return { queued: false, outboxId: null, reason: "no_recipient" };

  // Checked before the insert rather than by catching P2002: inside a Postgres
  // transaction a constraint violation aborts the whole transaction, and the
  // caller's order would be lost with it.
  if (input.dedupeKey) {
    const existing = await client.emailOutbox.findUnique({
      where: { dedupeKey: input.dedupeKey },
      select: { id: true },
    });
    if (existing) return { queued: false, outboxId: existing.id, reason: "duplicate" };
  }

  const outbox = await client.emailOutbox.create({
    data: {
      templateKey: input.templateKey,
      toEmail: email,
      toName: input.to.name?.trim() || null,
      subject: input.subject,
      htmlBody: input.html,
      textBody: input.text,
      status: "QUEUED",
      dedupeKey: input.dedupeKey,
      scheduledAt: input.scheduledAt ?? new Date(),
      entityType: input.entity?.type ?? null,
      entityId: input.entity?.id ?? null,
    },
    select: { id: true },
  });

  const job = await enqueue(
    "email.send",
    { outboxId: outbox.id },
    {
      tx: input.tx,
      runAt: input.scheduledAt,
      dedupeKey: `email.send:${outbox.id}`,
    },
  );

  return { queued: true, outboxId: outbox.id, jobId: job.id };
}

/**
 * Render a stored template for one recipient and queue it. A missing or
 * inactive template is reported, not thrown: an operator disabling the
 * "order shipped" email must not stop shipments.
 */
export async function queueEmail(input: QueueEmailInput): Promise<QueueEmailResult> {
  const client = input.tx ?? db;
  const template = await client.emailTemplate.findUnique({
    where: { key: input.templateKey },
    select: { subject: true, htmlBody: true, textBody: true, isActive: true },
  });

  if (!template) {
    console.warn(`queueEmail: template "${input.templateKey}" does not exist`);
    return { queued: false, outboxId: null, reason: "template_missing" };
  }
  if (!template.isActive) {
    return { queued: false, outboxId: null, reason: "template_inactive" };
  }

  const vars: EmailVars = {
    ...(await commonEmailVars(input.tx)),
    ...input.vars,
  };
  const rendered = renderTemplate(template, vars);

  const dedupeKey =
    input.dedupeKey === null
      ? null
      : (input.dedupeKey ??
        (input.entity ? emailDedupeKey(input.templateKey, input.entity) : null));

  return writeOutbox({
    tx: input.tx,
    templateKey: input.templateKey,
    to: input.to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    entity: input.entity,
    dedupeKey,
    scheduledAt: input.scheduledAt,
  });
}

/** Queue an already-rendered email (admin notification digests, ad-hoc mail). */
export async function queueRawEmail(input: QueueRawEmailInput): Promise<QueueEmailResult> {
  return writeOutbox({
    tx: input.tx,
    templateKey: null,
    to: input.to,
    subject: input.subject.replace(/\s+/g, " ").trim(),
    html: input.html,
    text: input.text ?? null,
    entity: input.entity,
    dedupeKey: input.dedupeKey ?? null,
    scheduledAt: input.scheduledAt,
  });
}

/**
 * The fallback body for admin notifications when no `admin_notification`
 * template has been created. Plain and brand-neutral on purpose.
 */
export function adminNotificationHtml(input: {
  storeName: string;
  title: string;
  body?: string | null;
  href?: string | null;
}): string {
  const lines = [
    `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#222">`,
    `<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(input.storeName)}</h1>`,
    `<p style="font-size:16px;margin:0 0 12px"><strong>${escapeHtml(input.title)}</strong></p>`,
  ];
  if (input.body) lines.push(`<p style="margin:0 0 16px">${escapeHtml(input.body)}</p>`);
  if (input.href) {
    lines.push(
      `<p><a href="${escapeHtml(input.href)}" style="color:#0a58ca">Open in the admin panel</a></p>`,
    );
  }
  lines.push(`</div>`);
  return lines.join("\n");
}
