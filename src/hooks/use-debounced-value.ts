"use client";

import * as React from "react";

/**
 * Trails `value` by `delayMs`. Used by every async picker so a search request
 * is sent once per pause in typing rather than once per keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = React.useState(value);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
