import { redirect } from "next/navigation";

/**
 * There is no marketing surface here - the root of an admin domain should land
 * on work. proxy.ts has already decided whether there is a session, so an
 * unauthenticated visitor never reaches this redirect.
 */
export default function RootPage() {
  redirect("/dashboard");
}
