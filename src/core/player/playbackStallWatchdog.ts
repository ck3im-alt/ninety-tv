// Generic "is currentTime actually advancing" watchdog. Deliberately knows
// nothing about hls.js/mpegts.js/DOM — it only ever sees whatever `sample()`
// returns each tick — so it's fully unit-testable with a fake clock and a
// fake video-like sample source, and so it stays useful as a safety net
// regardless of which underlying engine (or a future one) is playing.
//
// Why this exists: a real failure was found where mpegts.js's own remuxer
// hit an internal "Maximum call stack size exceeded" exception while trying
// to compensate for a large audio timestamp gap, and NEVER surfaced it as
// video.error or mpegts.Events.ERROR — playback just silently stopped
// advancing. This watchdog is deliberately generic (matches on "no
// currentTime progress for N seconds while playback should be active"), not
// on that specific failure's log message, so it also catches any other
// class of silent stall (network stalls a loader swallows, a future engine
// bug, etc.) — see htmlVideoPlayer.ts's own header for why matching the
// specific mpegts.js log string would be brittle across library upgrades.
export interface StallSample {
  currentTime: number
  paused: boolean
  seeking: boolean
  readyState: number
  networkState: number
  bufferedRanges: Array<{ start: number; end: number }>
}

export interface StallDiagnostics {
  currentTime: number
  previousProgressingCurrentTime: number
  stalledDurationMs: number
  readyState: number
  networkState: number
  bufferedRanges: Array<{ start: number; end: number }>
}

export interface StallWatchdogOptions {
  // Whether playback is currently expected to be actively advancing (i.e.
  // the owning Player expects progress. Initial loading is normally false;
  // loading caused by a post-start rebuffer may deliberately stay true.
  // The watchdog continuously resets its
  // progress baseline whenever this is false, so it always gets a fresh
  // window once playback (re)starts rather than comparing against a stale
  // pre-load/pre-pause position.
  isActive: () => boolean
  sample: () => StallSample
  onStall: (diagnostics: StallDiagnostics) => void
  // "roughly 6-8 seconds" per the spec — 7000ms is the chosen midpoint.
  stallThresholdMs?: number
  sampleIntervalMs?: number
  // How much currentTime must advance between two samples to count as
  // "meaningful progress" — small enough to not be fooled by natural
  // playback-rate jitter, large enough to ignore floating-point noise.
  minProgressSeconds?: number
  now?: () => number
  setIntervalFn?: (handler: () => void, ms: number) => ReturnType<typeof setInterval>
  clearIntervalFn?: (handle: ReturnType<typeof setInterval>) => void
}

export interface StallWatchdog {
  dispose(): void
}

export function createStallWatchdog(options: StallWatchdogOptions): StallWatchdog {
  const {
    isActive,
    sample,
    onStall,
    stallThresholdMs = 7000,
    sampleIntervalMs = 1000,
    minProgressSeconds = 0.25,
    now = () => Date.now(),
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
  } = options

  // Seeded from a real initial sample (not a hardcoded 0) — otherwise the
  // very first tick would almost always see currentTime jump from 0 to
  // wherever playback actually started, register that as "progress", and
  // reset the baseline right away — silently eating the first
  // sampleIntervalMs of any real stall.
  let lastProgressingCurrentTime = sample().currentTime
  let lastProgressAt = now()
  let disposed = false

  function resetBaseline(currentTime: number): void {
    lastProgressingCurrentTime = currentTime
    lastProgressAt = now()
  }

  const timer = setIntervalFn(() => {
    if (disposed) return
    const s = sample()

    // Not expected to be advancing right now (idle/loading/paused/ended/
    // error/seeking) — never a stall, and resetting here means the moment
    // real active playback resumes we start counting fresh instead of
    // immediately flagging a stall from time spent legitimately paused.
    if (!isActive() || s.paused || s.seeking) {
      resetBaseline(s.currentTime)
      return
    }

    const delta = s.currentTime - lastProgressingCurrentTime
    if (delta > minProgressSeconds) {
      resetBaseline(s.currentTime)
      return
    }

    const stalledDurationMs = now() - lastProgressAt
    if (stalledDurationMs >= stallThresholdMs) {
      onStall({
        currentTime: s.currentTime,
        previousProgressingCurrentTime: lastProgressingCurrentTime,
        stalledDurationMs,
        readyState: s.readyState,
        networkState: s.networkState,
        bufferedRanges: s.bufferedRanges,
      })
      // Re-baseline so a caller that doesn't immediately recover (or whose
      // recovery doesn't help) gets a fresh onStall roughly once per
      // threshold window rather than on every single subsequent tick.
      resetBaseline(s.currentTime)
    }
  }, sampleIntervalMs)

  return {
    dispose() {
      disposed = true
      clearIntervalFn(timer)
    },
  }
}
