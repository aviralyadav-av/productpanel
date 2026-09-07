import * as React from "react"

const MOBILE_BREAKPOINT = 768
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(onStoreChange: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY)
  mql.addEventListener("change", onStoreChange)
  return () => mql.removeEventListener("change", onStoreChange)
}

/**
 * useSyncExternalStore rather than an effect: the viewport width IS external
 * state, and setting it from an effect made every page that renders the
 * sidebar paint twice on mount. The server snapshot is false, so the markup is
 * desktop-first and hydration matches - identical to what the effect produced,
 * without the second render.
 */
export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  )
}
