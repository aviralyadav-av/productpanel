import { HOME_PATH, LOGIN_PATH, TWO_FACTOR_PATH } from "@/lib/auth/guards";

/**
 * Only relative admin paths are accepted as a post-login destination. Taking
 * the raw callbackUrl would let anyone craft a link that logs an admin in and
 * bounces them to an attacker-controlled site; bouncing back to the login or
 * two-factor page itself would loop.
 *
 * Pure: shared by the login page (to echo the value into the form) and the
 * login action (to decide where signIn redirects).
 */
export function safeCallbackPath(
  raw: FormDataEntryValue | string | string[] | null | undefined,
): string {
  const value = Array.isArray(raw) ? raw[0] : typeof raw === "string" ? raw : "";
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return HOME_PATH;
  }
  if (value.startsWith(LOGIN_PATH) || value.startsWith(TWO_FACTOR_PATH)) return HOME_PATH;
  if (value.startsWith("/admin/forgot-password") || value.startsWith("/admin/reset-password")) {
    return HOME_PATH;
  }
  return value;
}
