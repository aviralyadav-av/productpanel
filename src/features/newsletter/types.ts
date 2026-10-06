import type { NewsletterStatus } from "@/lib/enums";
import type { PageMeta } from "@/lib/list-params";

/**
 * Client-safe read models for the newsletter module. Dates are ISO strings so
 * the rows can cross the server/client boundary without a serialisation step.
 */

export type SubscriberRow = {
  id: string;
  email: string;
  name: string | null;
  status: NewsletterStatus;
  source: string | null;
  subscribedAt: string;
  unsubscribedAt: string | null;
  createdAt: string;
};

export type SubscriberListResult = { rows: SubscriberRow[]; meta: PageMeta };

export type NewsletterStatusCounts = Record<NewsletterStatus, number> & { all: number };

export type NewsletterKpis = {
  subscribed: number;
  unsubscribedThisMonth: number;
  bounced: number;
  addedThisMonth: number;
  /** Net new subscribers per month for the last 12 months (oldest first). */
  growth: number[];
  growthLabels: string[];
};

/** One row of a CSV import, after validation but before it is written. */
export type ImportRowReport = {
  line: number;
  email: string | null;
  name: string | null;
  action: "create" | "resubscribe" | "update" | "skip" | "error";
  message?: string;
};

export type ImportReport = {
  dryRun: boolean;
  totalRows: number;
  valid: number;
  invalid: number;
  duplicates: number;
  toCreate: number;
  toUpdate: number;
  created: number;
  updated: number;
  fileErrors: string[];
  /** At most the first 200 rows, so a 10k-row file cannot blow up the dialog. */
  rows: ImportRowReport[];
};
