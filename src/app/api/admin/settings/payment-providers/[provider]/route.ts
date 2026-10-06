import { apiOk, parseJsonBody, withAdminApi } from "@/lib/api/admin";
import { notFound } from "@/lib/api/errors";
import { paymentProviderSchema } from "@/lib/enums";

import { listProviderViews } from "@/features/settings/queries";
import { saveProviderSchema } from "@/features/settings/schemas";
import { saveProvider } from "@/features/settings/service";

/**
 * GET /api/admin/settings/payment-providers/:provider   (settings.manage_payments)
 *     -> { data: PaymentProviderView } - credentials as { isSet, last4 } only (D4).
 * PUT /api/admin/settings/payment-providers/:provider   (settings.manage_payments)
 *     Body = SaveProviderInput. An omitted or empty credential keeps the stored
 *     value; an explicit null clears it.
 */
async function loadView(provider: string) {
  const parsed = paymentProviderSchema.safeParse(provider.toUpperCase());
  if (!parsed.success) throw notFound("Payment provider");
  const views = await listProviderViews();
  const view = views.find((item) => item.provider === parsed.data);
  if (!view) throw notFound("Payment provider");
  return view;
}

export const GET = withAdminApi<{ provider: string }>(
  async ({ params }) => apiOk(await loadView(String(params.provider))),
  { permission: "settings.manage_payments" },
);

export const PUT = withAdminApi<{ provider: string }>(
  async ({ req, params, actor, ip }) => {
    const view = await loadView(String(params.provider));
    const body = await parseJsonBody(req, saveProviderSchema);
    // The path wins over the body so a mismatched payload cannot edit a
    // different provider than the URL names.
    const config = await saveProvider({ ...body, provider: view.provider as never }, actor, { ip });
    return apiOk({
      provider: config.provider,
      displayName: config.displayName,
      isEnabled: config.isEnabled,
      mode: config.mode,
      position: config.position,
      supportedMethods: config.supportedMethods,
      settings: config.settings,
      credentials: config.credentialKeys.map((key) => ({
        key,
        isSet: config.credentials[key]?.isSet ?? false,
        last4: config.credentials[key]?.last4 ?? null,
      })),
    });
  },
  { permission: "settings.manage_payments" },
);
