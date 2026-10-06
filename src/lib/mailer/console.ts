import { randomUUID } from "node:crypto";

import type { Mailer, MailMessage, MailResult } from "./types";

/**
 * Development transport: prints the email to stdout and "succeeds".
 *
 * The HTML body is deliberately NOT printed - it is hundreds of lines of
 * inline-styled table markup that drowns everything else in the terminal. The
 * text body carries the same information in a form a human can read. Anyone
 * who needs the HTML can open the row on the admin outbox page.
 */
export function createConsoleMailer(): Mailer {
  return {
    transport: "console",
    async send(message: MailMessage): Promise<MailResult> {
      const messageId = `console-${randomUUID()}`;
      const recipient = message.toName ? `${message.toName} <${message.to}>` : message.to;
      const lines = [
        "",
        "================ EMAIL (console transport) ================",
        `To:       ${recipient}`,
        `Subject:  ${message.subject}`,
        message.replyTo ? `Reply-To: ${message.replyTo}` : null,
        `Id:       ${messageId}`,
        "-----------------------------------------------------------",
        message.text?.trim() || "(no text body - HTML only)",
        "===========================================================",
        "",
      ].filter((line): line is string => line !== null);
      console.log(lines.join("\n"));
      return { messageId };
    },
  };
}
