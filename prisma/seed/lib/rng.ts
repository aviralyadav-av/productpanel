/**
 * Deterministic pseudo-random numbers for the demo seed (blueprint §12, G3).
 *
 * The seed must produce the same sellers, products, customers and orders on
 * every machine so that smoke tests can name "demo_order_0042" and mean the
 * same thing everywhere. mulberry32 is tiny, fast and good enough for picking
 * quantities and dates; it is not, and must never be used as, a source of
 * secrets (tokens come from src/lib/crypto.ts).
 */
export type Rng = {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
  /** Uniform pick. Throws on an empty list so a data bug surfaces at seed time. */
  pick<T>(items: readonly T[]): T;
  /** True with probability `p`. */
  chance(p: number): boolean;
  /** Fisher-Yates copy. */
  shuffle<T>(items: readonly T[]): T[];
  /** Up to `count` distinct items, in shuffled order. */
  sample<T>(items: readonly T[], count: number): T[];
  /** Weighted pick from [value, weight] pairs. */
  weighted<T>(entries: ReadonlyArray<readonly [T, number]>): T;
  /** Float in [min, max). */
  float(min: number, max: number): number;
};

/** FNV-1a so string seeds ("orders", "reviews") map to stable 32-bit states. */
function hashSeed(seed: number | string): number {
  if (typeof seed === "number") return seed >>> 0;
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createRng(seed: number | string): Rng {
  let state = hashSeed(seed) || 0x9e3779b9;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number): number => {
    if (max < min) [min, max] = [max, min];
    return min + Math.floor(next() * (max - min + 1));
  };

  const pick = <T,>(items: readonly T[]): T => {
    if (items.length === 0) throw new Error("rng.pick called with an empty list");
    return items[Math.floor(next() * items.length)];
  };

  const shuffle = <T,>(items: readonly T[]): T[] => {
    const copy = items.slice();
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(next() * (index + 1));
      [copy[index], copy[swap]] = [copy[swap], copy[index]];
    }
    return copy;
  };

  return {
    next,
    int,
    pick,
    chance: (p) => next() < p,
    shuffle,
    sample: (items, count) => shuffle(items).slice(0, Math.max(0, Math.min(count, items.length))),
    weighted: (entries) => {
      const total = entries.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0);
      if (total <= 0) throw new Error("rng.weighted needs a positive total weight");
      let roll = next() * total;
      for (const [value, weight] of entries) {
        roll -= Math.max(0, weight);
        if (roll < 0) return value;
      }
      return entries[entries.length - 1][0];
    },
    float: (min, max) => min + next() * (max - min),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;
export const MINUTE_MS = 60 * 1000;

export function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

export function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

export function addDays(date: Date, days: number): Date {
  return addMs(date, days * DAY_MS);
}

export function addHours(date: Date, hours: number): Date {
  return addMs(date, hours * HOUR_MS);
}

export function addMinutes(date: Date, minutes: number): Date {
  return addMs(date, minutes * MINUTE_MS);
}

export function minDate(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

export function maxDate(a: Date | null, b: Date): Date {
  return a && a.getTime() >= b.getTime() ? a : b;
}
