/**
 * `<input type="datetime-local">` speaks the browser's local wall-clock time
 * with no zone; the server stores instants. Convert at the edge, both ways, so
 * an operator in Kolkata and a server in Frankfurt agree on when a section
 * goes live. Pure helpers, safe on client and server.
 */

/** ISO instant (or Date) -> "YYYY-MM-DDTHH:mm" in the caller's local zone; "" for null. */
export function toDateTimeLocal(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "YYYY-MM-DDTHH:mm" (local) -> ISO instant; null for blank or unparseable input. */
export function fromDateTimeLocal(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Short human window for list rows: "from 12 Oct, 10:00" / "until 31 Oct" / "12 Oct – 31 Oct" / "". */
export function formatWindow(publishAt: Date | string | null, unpublishAt: Date | string | null): string {
  const fmt = (value: Date | string) =>
    new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
  if (publishAt && unpublishAt) return `${fmt(publishAt)} – ${fmt(unpublishAt)}`;
  if (publishAt) return `from ${fmt(publishAt)}`;
  if (unpublishAt) return `until ${fmt(unpublishAt)}`;
  return "";
}
