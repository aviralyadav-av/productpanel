import type { Prisma } from "@prisma/client";

/**
 * Human-readable document numbers (blueprint §11.10, C8).
 *
 * Every numbered model has `seq Int @default(autoincrement()) @unique`. The
 * number is a pure function of the sequence value, so two concurrent inserts
 * can never collide - Postgres hands out the sequence values - and the number
 * is written in the SAME transaction as the row. `nextNumber` draws the value
 * up front with `nextval()` so the row can be created with both columns set in
 * one statement (a placeholder-then-update dance would leave a window where
 * the unique `payoutNumber` is a temporary string).
 */

export type NumberedModel = "Order" | "Shipment" | "ReturnRequest" | "Refund" | "SellerPayout";

const PREFIX: Record<NumberedModel, string> = {
  Order: "DB",
  Shipment: "SH-",
  ReturnRequest: "RMA-",
  Refund: "RF-",
  SellerPayout: "PO-",
};

/** `DB10001` (no padding - the sequence starts at 10001) or `SH-000042`. */
export function formatNumber(prefix: string, seq: number): string {
  if (prefix === "DB") return `DB${seq}`;
  return `${prefix}${String(seq).padStart(6, "0")}`;
}

export function formatNumberFor(model: NumberedModel, seq: number): string {
  return formatNumber(PREFIX[model], seq);
}

export async function nextNumber(
  tx: Prisma.TransactionClient,
  model: NumberedModel,
): Promise<{ seq: number; number: string }> {
  // pg_get_serial_sequence needs the quoted table name inside the string.
  const table = `"${model}"`;
  const rows = await tx.$queryRaw<Array<{ seq: bigint | number }>>`
    SELECT nextval(pg_get_serial_sequence(${table}, 'seq')) AS seq`;
  const seq = Number(rows[0]?.seq ?? 0);
  if (!seq) throw new Error(`Could not draw a sequence value for ${model}`);
  return { seq, number: formatNumberFor(model, seq) };
}
