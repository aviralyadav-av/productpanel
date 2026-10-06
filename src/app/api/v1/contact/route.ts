import { validationError, zodDetails } from "@/lib/api/errors";
import { handleOptions, privateJson, withPublicApi } from "@/lib/api/public";

import { contactSchema } from "@/features/inquiries/schemas";
import { createInquiryFromContact } from "@/features/inquiries/service";

/**
 * POST /api/v1/contact   (blueprint §5.3, §14.D9 5/h/IP, E3)
 * body { name, email, phone?, subject, message, type?, orderNumber?, website? }
 *
 * `website` is a honeypot: real forms leave it empty; a filled one gets the
 * same 200 and stores nothing. A known orderNumber links the inquiry to the
 * order. Creates a NEW inquiry, notifies inquiries.view users and queues the
 * `contact_ack` email to the sender.
 * -> 200 { ok: true, message }
 */
export const POST = withPublicApi(
  async ({ req, ip }) => {
    let json: unknown;
    try {
      json = await req.json();
    } catch {
      throw validationError({ body: "Send a JSON body." }, "Invalid request body.");
    }
    const parsed = contactSchema.safeParse(json);
    if (!parsed.success) throw validationError(zodDetails(parsed.error));

    const result = await createInquiryFromContact({ values: parsed.data, ip: ip === "unknown" ? null : ip });
    return privateJson({ ok: true, message: result.message }, { req });
  },
  { rateLimit: { limit: 5, windowMs: 60 * 60 * 1000 } },
);

export const OPTIONS = handleOptions;
