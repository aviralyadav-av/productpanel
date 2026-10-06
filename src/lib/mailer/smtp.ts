import nodemailer from "nodemailer";

import type { Mailer, MailMessage, MailResult, SmtpConfig, SmtpTestResult } from "./types";

/**
 * SMTP transport over nodemailer.
 *
 * No connection pooling: the worker sends one email at a time and a pooled
 * connection that sits idle between jobs is exactly what shared SMTP hosts
 * (Zoho, Gmail, SES) drop server-side, producing confusing "connection closed"
 * failures on the next send. Opening a fresh connection per message costs a
 * few hundred milliseconds and never goes stale.
 */

function formatAddress(address: string, name?: string | null): string {
  const trimmedName = name?.trim();
  if (!trimmedName) return address;
  // Quote the display name so a comma or angle bracket in a customer's name
  // cannot turn into a second recipient.
  return `"${trimmedName.replace(/["\\]/g, "")}" <${address}>`;
}

function buildTransport(config: SmtpConfig) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.password } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}

export function assertSmtpConfig(config: SmtpConfig): void {
  if (!config.host) throw new Error("SMTP host is not configured (email.smtp_host).");
  if (!Number.isInteger(config.port) || config.port <= 0 || config.port > 65535) {
    throw new Error("SMTP port is invalid (email.smtp_port).");
  }
  if (!config.fromAddress) throw new Error("From address is not configured (email.from_address).");
}

export function createSmtpMailer(config: SmtpConfig): Mailer {
  assertSmtpConfig(config);
  const transporter = buildTransport(config);

  return {
    transport: "smtp",
    async send(message: MailMessage): Promise<MailResult> {
      const info = await transporter.sendMail({
        from: formatAddress(config.fromAddress, config.fromName),
        to: formatAddress(message.to, message.toName),
        subject: message.subject,
        html: message.html,
        text: message.text ?? undefined,
        replyTo: message.replyTo ?? config.replyTo ?? undefined,
      });
      return { messageId: info.messageId ?? `smtp-${Date.now()}` };
    },
  };
}

/**
 * Behind the settings page "Test connection" button: connects, greets and
 * authenticates without sending anything. The error text is nodemailer's,
 * which names the real problem (auth failed, ECONNREFUSED, certificate) far
 * better than anything we could paraphrase.
 */
export async function testSmtpConnection(config: SmtpConfig): Promise<SmtpTestResult> {
  try {
    assertSmtpConfig(config);
    const transporter = buildTransport(config);
    await transporter.verify();
    transporter.close();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
