import { redirect } from "next/navigation";

/**
 * There is no marketing surface here - the root of an admin domain should land
 * on work (blueprint §6). proxy.ts already sends signed-out visitors to
 * /admin/login, so this redirect only ever runs for a live session.
 */
export default function RootPage() {
  redirect("/admin/dashboard");
}
