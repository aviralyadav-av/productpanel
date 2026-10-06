import type { BadgeTone } from "@/lib/enums";
import type { ScheduleState } from "@/features/content/registry";

/**
 * Labels and tones for the four registry schedule states (§11.26). The state
 * itself is computed by `scheduleState()` in the registry so the badge can
 * never disagree with what `/api/v1/home` excludes.
 */
export const SCHEDULE_STATE_META: Record<ScheduleState, { label: string; tone: BadgeTone; description: string }> = {
  live: { label: "Live", tone: "success", description: "Enabled and inside its publish window; sent to the website." },
  scheduled: { label: "Scheduled", tone: "info", description: "Enabled but its publish time is still in the future." },
  expired: { label: "Expired", tone: "warning", description: "Enabled but past its unpublish time; not sent." },
  disabled: { label: "Disabled", tone: "neutral", description: "Switched off; kept for later." },
};
