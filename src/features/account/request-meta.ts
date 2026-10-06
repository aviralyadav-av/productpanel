import { headers } from "next/headers";

import { clientIp } from "@/lib/client-ip";

/**
 * Client details for audit rows written by account actions. Next-specific
 * (reads request headers), so it lives beside the actions rather than in the
 * pure services, which receive the values as plain arguments.
 */
export async function requestMeta(): Promise<{ ip: string; userAgent: string | null }> {
  const headerList = await headers();
  return { ip: clientIp(headerList), userAgent: headerList.get("user-agent") };
}
