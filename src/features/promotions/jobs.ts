import { registerJobHandler } from "@/lib/queue";

import { expirePromotions } from "./service";

/**
 * Background work for promotions. Registered by the orchestrator in
 * src/lib/queue/register-all.ts; `promotions.expire` is already listed in
 * RECURRING_JOBS (hourly) and goes live the moment a handler exists.
 *
 * Exact window boundaries are handled by the `pricing.refresh` chain the
 * catalog owns; this hourly pass is the safety net for a broken chain.
 */
export function registerPromotionJobHandlers(): void {
  registerJobHandler("promotions.expire", async ({ log }) => {
    const result = await expirePromotions();
    log(`checked ${result.checked} promotions, re-priced ${result.repriced} products`);
    return result;
  });
}
