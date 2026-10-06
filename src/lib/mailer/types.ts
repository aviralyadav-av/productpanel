/**
 * Outbound email transport contract (blueprint §10, E2).
 *
 * The queue handler (`email.send`) talks to a `Mailer`, never to nodemailer,
 * so the transport can be swapped per environment from a Setting: `smtp` in
 * production, `console` on a developer machine where the only thing anyone
 * wants is to see the rendered mail in the terminal.
 */

export type MailMessage = {
  to: string;
  toName?: string | null;
  subject: string;
  html: string;
  text?: string | null;
  replyTo?: string | null;
};

export type MailResult = {
  /** Provider message id (SMTP Message-ID, or a synthetic id for console). */
  messageId: string;
};

export interface Mailer {
  readonly transport: "smtp" | "console";
  send(message: MailMessage): Promise<MailResult>;
}

/** Everything the SMTP transport needs, already decrypted. */
export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  /** Plaintext. Decrypted by the settings reader, never stored here. */
  password: string;
  fromName: string;
  fromAddress: string;
  replyTo?: string | null;
};

export type SmtpTestResult = { ok: true } | { ok: false; error: string };
