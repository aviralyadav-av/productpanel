import { isSafeUrl } from "@/lib/validation";

/**
 * Tracking URLs for shipments (blueprint §4.6 ShippingPartner). Pure: the
 * ORDERS module calls `buildTrackingUrl` when it records a tracking number,
 * the partner dialog validates templates with `trackingTemplateProblem`, and
 * the storefront's order-tracking payload carries the result.
 *
 * The placeholder is substituted with the URL-encoded tracking number so a
 * courier reference containing `&` or `#` cannot break out of the query
 * string, and the finished URL is re-checked with `isSafeUrl` because a
 * template is operator input: `javascript:` never reaches a shopper's link.
 */

export const TRACKING_PLACEHOLDER = "{tracking}";

/** A sample number for validating a template before any real shipment exists. */
const SAMPLE_TRACKING_NUMBER = "TEST123456789";

export type TrackingPartnerLike = {
  trackingUrlTemplate: string | null;
};

/**
 * The shopper-facing tracking link, or null when the partner has no
 * template, the number is blank, or the substituted URL is not a plain
 * absolute http(s) URL.
 */
export function buildTrackingUrl(
  partner: TrackingPartnerLike | null | undefined,
  trackingNumber: string | null | undefined,
): string | null {
  const template = partner?.trackingUrlTemplate?.trim();
  const number = trackingNumber?.trim();
  if (!template || !number) return null;
  if (!template.includes(TRACKING_PLACEHOLDER)) return null;

  const url = template.split(TRACKING_PLACEHOLDER).join(encodeURIComponent(number));
  return isAbsoluteHttpUrl(url) ? url : null;
}

/** Why a template is unusable, as a sentence for the form; null when it is fine. */
export function trackingTemplateProblem(template: string | null | undefined): string | null {
  const text = template?.trim() ?? "";
  if (text === "") return null;
  if (!text.includes(TRACKING_PLACEHOLDER)) {
    return `The template must contain ${TRACKING_PLACEHOLDER} where the tracking number goes.`;
  }
  const sample = text.split(TRACKING_PLACEHOLDER).join(SAMPLE_TRACKING_NUMBER);
  if (!isAbsoluteHttpUrl(sample)) {
    return "The template must be a full http(s) URL once the tracking number is filled in.";
  }
  return null;
}

function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) && isSafeUrl(value);
}
