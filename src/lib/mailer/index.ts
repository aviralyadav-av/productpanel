import { decrypt, isEncrypted } from "@/lib/crypto";
import { readSettingStrings } from "@/features/finance/settings-reader";
import { createConsoleMailer } from "./console";
import { createSmtpMailer, testSmtpConnection } from "./smtp";
import type { Mailer, SmtpConfig } from "./types";

export type { Mailer, MailMessage, MailResult, SmtpConfig, SmtpTestResult } from "./types";
export { createConsoleMailer } from "./console";
export { createSmtpMailer, testSmtpConnection } from "./smtp";

/**
 * Mailer selection (blueprint E2: `email.transport` = smtp | console).
 *
 * Settings are read through the transaction-free service reader rather than
 * `src/lib/settings.ts`, because that module is `server-only` and this one
 * runs inside the plain-tsx job worker. Reading the eight email keys once per
 * send is one indexed query - cheaper than the SMTP handshake that follows.
 *
 * The SMTP mailer is cached by a fingerprint of its config so an admin who
 * changes the host or password sees the change on the very next send, while
 * the common case (nothing changed) reuses the transport object.
 */

const SMTP_KEYS = [
  "email.transport",
  "email.smtp_host",
  "email.smtp_port",
  "email.smtp_user",
  "email.smtp_password",
  "email.smtp_secure",
  "email.from_name",
  "email.from_address",
  "email.reply_to",
] as const;

/**
 * Secrets are stored encrypted (`v1:` prefix) once the settings service has
 * saved them; a value typed straight into the seed or an early database is
 * plain. Accept both so an upgrade never silently breaks email.
 */
export function resolveSecretSetting(value: string): string {
  if (!value) return "";
  if (isEncrypted(value)) {
    try {
      return decrypt(value, "smtp");
    } catch {
      throw new Error(
        "email.smtp_password could not be decrypted - was ENCRYPTION_KEY rotated? Re-enter the password in Settings.",
      );
    }
  }
  return value;
}

export function smtpConfigFromSettings(values: Record<string, string>): SmtpConfig {
  return {
    host: values["email.smtp_host"]?.trim() ?? "",
    port: Number.parseInt(values["email.smtp_port"] ?? "587", 10) || 587,
    secure: values["email.smtp_secure"] === "true" || values["email.smtp_secure"] === "1",
    user: values["email.smtp_user"]?.trim() ?? "",
    password: resolveSecretSetting(values["email.smtp_password"] ?? ""),
    fromName: values["email.from_name"]?.trim() || "DIY Baazar",
    fromAddress: values["email.from_address"]?.trim() ?? "",
    replyTo: values["email.reply_to"]?.trim() || null,
  };
}

let cached: { fingerprint: string; mailer: Mailer } | null = null;
const consoleMailer = createConsoleMailer();

function fingerprintOf(config: SmtpConfig): string {
  // The password participates so a rotated password rebuilds the transport,
  // but only through its length + a cheap checksum so it is never held twice.
  let checksum = 0;
  for (let i = 0; i < config.password.length; i += 1) {
    checksum = (checksum * 31 + config.password.charCodeAt(i)) >>> 0;
  }
  return [config.host, config.port, config.secure, config.user, config.fromAddress, config.fromName, config.replyTo, config.password.length, checksum].join("|");
}

/** The transport the current settings ask for. */
export async function getMailer(): Promise<Mailer> {
  const values = await readSettingStrings(undefined, SMTP_KEYS);
  const transport = values["email.transport"]?.trim().toLowerCase();

  if (transport !== "smtp") return consoleMailer;

  const config = smtpConfigFromSettings(values);
  const fingerprint = fingerprintOf(config);
  if (cached && cached.fingerprint === fingerprint) return cached.mailer;

  const mailer = createSmtpMailer(config);
  cached = { fingerprint, mailer };
  return mailer;
}

/**
 * Test the SMTP settings as currently saved (the settings tab calls this after
 * a save, so the button exercises exactly what the worker will use).
 */
export async function testSavedSmtpSettings() {
  const values = await readSettingStrings(undefined, SMTP_KEYS);
  return testSmtpConnection(smtpConfigFromSettings(values));
}

/** Drop the cached SMTP transport (tests, or after ENCRYPTION_KEY rotation). */
export function resetMailerCache(): void {
  cached = null;
}
