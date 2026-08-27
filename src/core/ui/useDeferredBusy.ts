import { useEffect, useRef, useState } from 'react'

// Whether a blocking operation has been running long enough to be WORTH a
// loading screen — and, once it is, long enough that taking the screen away
// again won't read as a flicker.
//
// TWO THRESHOLDS, because the two failure modes are opposite:
//
//   SHOW_DELAY_MS  An operation served entirely from cache finishes in a few
//                  milliseconds. Mounting a full-screen panel for that is
//                  worse than mounting nothing — it reads as a glitch. So
//                  nothing is shown until the operation has genuinely taken
//                  a moment.
//
//   MIN_VISIBLE_MS Once the panel IS up, whipping it away 30ms later is the
//                  same glitch in reverse. Having committed to showing it,
//                  it stays up long enough to be read.
//
// Both are deliberately small: this is about suppressing flicker, not about
// padding out fast operations to feel substantial.
export const SHOW_DELAY_MS = 180
export const MIN_VISIBLE_MS = 520

export interface DeferredBusyOptions {
  // `0` means SHOW IMMEDIATELY, and is not just a smaller number — see the
  // `immediate` branch below. Use it for work that is known to be heavy AND
  // known to block the main thread.
  showDelayMs?: number
  minVisibleMs?: number
}

export function useDeferredBusy(busy: boolean, options: DeferredBusyOptions = {}): boolean {
  const { showDelayMs = SHOW_DELAY_MS, minVisibleMs = MIN_VISIBLE_MS } = options

  // WHY ZERO IS A DIFFERENT MECHANISM, NOT A SMALLER DELAY.
  //
  // The delayed path schedules a timer. A timer cannot fire while the main
  // thread is busy — and the single heaviest thing this app does, parsing a
  // 30,000-channel M3U, is synchronous. Measured on a 6x-throttled CPU
  // (roughly TV-class) that parse holds the thread for ~3 seconds, during
  // which no timer runs, so the panel meant to cover it was never mounted at
  // all: the app simply froze, which is the exact bug this hook exists to
  // prevent. Deriving visibility during render instead means the panel is in
  // the DOM in the very commit that sets `busy` — before the blocking work
  // starts. (The caller still has to let it PAINT: see nextPaint.)
  const immediate = showDelayMs <= 0 && busy

  const [shown, setShown] = useState(false)
  // When the panel actually appeared, so the minimum-visible window is
  // measured from that moment rather than from whenever `busy` cleared.
  const shownAtRef = useRef<number | null>(null)

  useEffect(() => {
    if (busy) {
      if (shown) return
      if (immediate) {
        shownAtRef.current ??= Date.now()
        setShown(true)
        return
      }
      const timer = setTimeout(() => {
        shownAtRef.current = Date.now()
        setShown(true)
      }, showDelayMs)
      return () => clearTimeout(timer)
    }

    // Not busy any more. Either it never became visible (the common, fast
    // path — the show timer above was just cleared) or it did, and owes the
    // rest of its minimum window.
    if (!shown) return
    const remaining = minVisibleMs - (Date.now() - (shownAtRef.current ?? 0))
    if (remaining <= 0) {
      shownAtRef.current = null
      setShown(false)
      return
    }
    const timer = setTimeout(() => {
      shownAtRef.current = null
      setShown(false)
    }, remaining)
    return () => clearTimeout(timer)
  }, [busy, shown, immediate, showDelayMs, minVisibleMs])

  return shown || immediate
}
