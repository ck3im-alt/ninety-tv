import { useEffect, useState } from 'react'

// Generic debounce for a value that changes immediately (e.g. spatial-nav
// focus moving to a new channel every row) but whose downstream consumer is
// expensive to re-run on every intermediate change (starting a stream load,
// fetching EPG). The immediate value itself is never delayed — only what
// this hook returns lags behind it by `delayMs`, so callers can keep
// display state (name, selection, layout) instant while gating the
// expensive work on the debounced return value. See BrowseCascadeScreen's
// PreviewCard / CategoryChannelsScreen's InfoPanel for the actual split.
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
