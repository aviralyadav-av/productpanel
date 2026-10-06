import type { Metadata } from "next";

import { requireAdmin } from "@/lib/auth/guards";
import { getOwnSessions } from "@/features/account/queries";
import { SessionsList } from "@/features/account/components/sessions-list";
import { PageHeader } from "@/components/shared/page-header";

export const metadata: Metadata = { title: "Signed-in devices" };

export default async function SessionsPage() {
  const actor = await requireAdmin();
  const sessions = await getOwnSessions(actor.id, actor.sessionId);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Signed-in devices"
        description="Sessions end after 12 hours, or 60 minutes without activity, unless revoked here first. If you see a device you do not recognise, revoke it and change your password."
      />
      <SessionsList sessions={sessions} />
    </div>
  );
}
