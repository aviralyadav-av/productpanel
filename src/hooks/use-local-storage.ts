"use client";

import * as React from "react";

/**
 * localStorage as a React value, hydration-safe.
 *
 * The server has no storage, so the first render on both sides uses
 * `fallback`; the stored value is read in an effect after mount. Every access
 * is wrapped in try/catch because Safari in private mode and locked-down
 * browsers throw on `localStorage` itself, and a table's column preferences
 * are never worth a crash.
 */
export function useLocalStorage<T>(
  key: string,
  fallback: T,
): [T, (next: T | ((current: T) => T)) => void, boolean] {
  const [value, setValue] = React.useState<T>(fallback);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading browser storage after mount is the hydration-safe pattern
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      // Unreadable storage or corrupt JSON: keep the fallback.
    }
    setHydrated(true);
  }, [key]);

  const update = React.useCallback(
    (next: T | ((current: T) => T)) => {
      setValue((current) => {
        const resolved =
          typeof next === "function" ? (next as (c: T) => T)(current) : next;
        try {
          window.localStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          // Quota exceeded or storage disabled: the value still applies in memory.
        }
        return resolved;
      });
    },
    [key],
  );

  return [value, update, hydrated];
}
