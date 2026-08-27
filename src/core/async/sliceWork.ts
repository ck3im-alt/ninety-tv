// Runs a long per-item pass without ever holding the main thread for more
// than a slice at a time.
//
// The pattern this generalizes already existed in warmChannelIndexAsync
// (chunk, yield, repeat). What it adds is a TIME budget instead of a fixed
// chunk size, which matters in both directions:
//
//   - A long pass yields as often as it actually needs to on THIS device
//     against THIS data, rather than as often as one machine's numbers
//     suggested. Slow silicon yields more; fast silicon yields less.
//   - A SHORT pass yields zero times, so it costs nothing. Fixed chunking
//     inserts an idle-callback wait every N items regardless — which is
//     free for background work but is real added latency when something is
//     waiting on the result (Home's first paint, for one).
//
// `now` and `yieldFn` are injectable purely so the slicing rule itself is
// unit-testable without a clock or an event loop; production callers pass
// neither.
import { yieldToMainThread } from './yieldToMainThread'

export interface SliceWorkOptions {
  // How long one uninterrupted stretch may run before handing the main
  // thread back. One item is always allowed to overrun it — the budget
  // bounds how often we CHECK, not how long a single item may take.
  sliceMs?: number
  // Checked after every item and again after every yield. Returning true
  // abandons the pass immediately, which is what a superseded/cancelled
  // caller needs: yielding introduces real interleaving, so a stale pass
  // must be able to stop rather than finish and overwrite fresher state.
  shouldStop?: () => boolean
  now?: () => number
  yieldFn?: () => Promise<void>
}

const DEFAULT_SLICE_MS = 8

function defaultNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export async function sliceWork<T>(
  items: Iterable<T>,
  work: (item: T) => Promise<void> | void,
  options: SliceWorkOptions = {},
): Promise<'completed' | 'stopped'> {
  const { sliceMs = DEFAULT_SLICE_MS, shouldStop, now = defaultNow, yieldFn = yieldToMainThread } = options
  let sliceStartedAt = now()
  for (const item of items) {
    await work(item)
    if (shouldStop?.()) return 'stopped'
    if (now() - sliceStartedAt < sliceMs) continue
    await yieldFn()
    if (shouldStop?.()) return 'stopped'
    sliceStartedAt = now()
  }
  return 'completed'
}
