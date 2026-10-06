/**
 * `<input type="datetime-local">` helpers. The control speaks the browser's
 * local wall-clock time with no zone; the operators sit in IST and the server
 * stores UTC, so the conversion is simply "local ↔ ISO" via the Date object.
 * Client-safe and dependency-free.
 */

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Date → "YYYY-MM-DDTHH:mm" in the browser's zone; "" for null. */
export function toDateTimeLocalValue(date: Date | string | null | undefined): string {
  if (!date) return "";
  const parsed = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

/** "YYYY-MM-DDTHH:mm" → ISO string for the action, or "" when empty/invalid. */
export function fromDateTimeLocalValue(value: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}
