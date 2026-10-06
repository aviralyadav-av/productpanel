import { redirect } from "next/navigation";

/** /admin has no content of its own; the dashboard is the front door. */
export default function AdminIndexPage() {
  redirect("/admin/dashboard");
}
