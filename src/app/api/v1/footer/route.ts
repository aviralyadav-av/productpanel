import { db } from "@/lib/db";
import { toPublicFooter } from "@/lib/serializers/public";
import { notFoundJson, publicJson } from "../_lib/response";

/**
 * GET /api/v1/footer
 *
 * Replaces getFooter(). There is no commented-out axios version for this one in
 * the storefront - footerApi.js returns the static object directly - so this is
 * a net-new endpoint the cutover will need.
 */
export async function GET() {
  const config = await db.footerConfig.findUnique({
    where: { id: "default" },
  });

  if (!config) return notFoundJson("Footer configuration");

  return publicJson(toPublicFooter(config));
}
