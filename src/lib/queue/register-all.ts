import { registerEmailJobHandlers } from "@/features/email/handlers";
import { registerInventoryJobHandlers } from "@/features/inventory/jobs";
import { registerOrdersJobHandlers } from "@/features/orders/jobs";
import { registerPromotionJobHandlers } from "@/features/promotions/jobs";
import { registerPlatformJobHandlers } from "./handlers/platform";

/**
 * The one place every job handler module is wired in. Both entry points that
 * execute jobs - `scripts/worker.ts` and `POST /api/internal/jobs/run` - call
 * this before `runPendingJobs()`, so a handler missing here is a handler that
 * never runs anywhere.
 *
 * Convention for wave-3 modules: put your handlers in
 * `src/features/<module>/jobs.ts` exporting `register<Module>JobHandlers()`
 * (guard it against double registration like the two below), keep it free of
 * `server-only` / `next/*` imports (the worker is a plain tsx process), and
 * ask the infra owner to add the import + call here. Once registered, any
 * cadence listed for your type in handlers/schedule.ts starts automatically.
 *
 * Registration is a `Map.set`, so calling this twice is harmless; the guard
 * only saves the work.
 */
let registered = false;

export function registerAllJobHandlers(): void {
  if (registered) return;
  registered = true;

  registerPlatformJobHandlers();
  registerEmailJobHandlers();

  // Wave-3 feature handlers. Each module guards itself against double
  // registration, so the order here only matters if two modules ever claimed
  // the same job type (none do today). Without these calls the cadences listed
  // in handlers/schedule.ts stay dormant: paid ONLINE orders would never leave
  // PENDING, reservations would never expire and low-stock digests never send.
  registerOrdersJobHandlers();
  registerInventoryJobHandlers();
  registerPromotionJobHandlers();
}
