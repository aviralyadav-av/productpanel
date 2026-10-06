/**
 * Money helpers for the demo seed. All amounts in the database are integer
 * PAISE (D5); the specs in this folder are written in rupees for readability
 * and converted exactly once, here.
 */
export function rupees(amount: number): number {
  return Math.round(amount * 100);
}

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

export function formatInr(paise: number): string {
  return INR.format(paise / 100);
}

/** Round to the nearest rupee so demo prices look like price tags (₹1,299). */
export function priceTag(paise: number): number {
  return Math.round(paise / 100) * 100;
}
