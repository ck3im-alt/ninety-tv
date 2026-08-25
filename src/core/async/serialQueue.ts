// Generic FIFO async serializer — runs queued functions strictly one at a
// time, in call order, regardless of how they resolve. Used by Multiview's
// per-pane resolution (useMultiviewPaneResolution.ts) to let every pane
// still reach the Xtream EPG network-fallback match stage, but never more
// than one such probe in flight at once across the whole session — avoiding
// connection-slot contention on IPTV accounts limited to 1-2 concurrent
// connections without disabling the richer match entirely.
export interface SerialQueue {
  run<T>(fn: () => Promise<T>): Promise<T>
}

export function createSerialQueue(): SerialQueue {
  // Always resolves, never rejects — a failed queued call must not block
  // everything queued after it, so its rejection is swallowed here and only
  // ever surfaced through that call's own returned promise (see `started`
  // below).
  let tail: Promise<void> = Promise.resolve()

  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      const started = tail.then(fn)
      tail = started.then(
        () => undefined,
        () => undefined,
      )
      return started
    },
  }
}
