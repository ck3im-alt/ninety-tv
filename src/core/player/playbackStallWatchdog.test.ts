import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createStallWatchdog } from './playbackStallWatchdog'
import type { StallSample } from './playbackStallWatchdog'

const EMPTY_RANGES: Array<{ start: number; end: number }> = []

function baseSample(overrides: Partial<StallSample> = {}): StallSample {
  return {
    currentTime: 0,
    paused: false,
    seeking: false,
    readyState: 4,
    networkState: 1,
    bufferedRanges: EMPTY_RANGES,
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('createStallWatchdog', () => {
  it('never fires while currentTime keeps advancing', () => {
    let t = 0
    const onStall = vi.fn()
    const watchdog = createStallWatchdog({
      isActive: () => true,
      sample: () => baseSample({ currentTime: t }),
      onStall,
      stallThresholdMs: 7000,
      sampleIntervalMs: 1000,
    })
    for (let i = 0; i < 20; i++) {
      t += 1 // advances 1s of currentTime per 1s of wall time — real-time playback
      vi.advanceTimersByTime(1000)
    }
    expect(onStall).not.toHaveBeenCalled()
    watchdog.dispose()
  })

  it('does not fire during initial buffering (isActive false while loading)', () => {
    const onStall = vi.fn()
    let active = false
    const watchdog = createStallWatchdog({
      isActive: () => active,
      sample: () => baseSample({ currentTime: 0 }),
      onStall,
      stallThresholdMs: 7000,
      sampleIntervalMs: 1000,
    })
    vi.advanceTimersByTime(15000) // well past the threshold, but never "active"
    expect(onStall).not.toHaveBeenCalled()
    watchdog.dispose()
  })

  it('does not fire while paused, even if currentTime is frozen and isActive is true', () => {
    const onStall = vi.fn()
    const watchdog = createStallWatchdog({
      isActive: () => true,
      sample: () => baseSample({ currentTime: 5, paused: true }),
      onStall,
      stallThresholdMs: 7000,
      sampleIntervalMs: 1000,
    })
    vi.advanceTimersByTime(15000)
    expect(onStall).not.toHaveBeenCalled()
    watchdog.dispose()
  })

  it('does not fire while seeking, even if currentTime is momentarily frozen', () => {
    const onStall = vi.fn()
    const watchdog = createStallWatchdog({
      isActive: () => true,
      sample: () => baseSample({ currentTime: 5, seeking: true }),
      onStall,
      stallThresholdMs: 7000,
      sampleIntervalMs: 1000,
    })
    vi.advanceTimersByTime(15000)
    expect(onStall).not.toHaveBeenCalled()
    watchdog.dispose()
  })

  it('fires exactly once when currentTime freezes for the full threshold while active', () => {
    const onStall = vi.fn()
    const watchdog = createStallWatchdog({
      isActive: () => true,
      sample: () => baseSample({ currentTime: 5 }), // frozen the whole time
      onStall,
      stallThresholdMs: 7000,
      sampleIntervalMs: 1000,
    })
    vi.advanceTimersByTime(6000)
    expect(onStall).not.toHaveBeenCalled() // not yet at threshold
    vi.advanceTimersByTime(1000) // now at 7000ms frozen
    expect(onStall).toHaveBeenCalledTimes(1)
    watchdog.dispose()
  })

  it('reports accurate diagnostics on the frozen sample', () => {
    const onStall = vi.fn()
    const watchdog = createStallWatchdog({
      isActive: () => true,
      sample: () =>
        baseSample({
          currentTime: 14.5,
          readyState: 4,
          networkState: 2,
          bufferedRanges: [{ start: 0, end: 20 }],
        }),
      onStall,
      stallThresholdMs: 7000,
      sampleIntervalMs: 1000,
    })
    vi.advanceTimersByTime(7000)
    expect(onStall).toHaveBeenCalledWith(
      expect.objectContaining({
        currentTime: 14.5,
        previousProgressingCurrentTime: 14.5,
        readyState: 4,
        networkState: 2,
        bufferedRanges: [{ start: 0, end: 20 }],
        stalledDurationMs: expect.any(Number),
      }),
    )
    watchdog.dispose()
  })

  it('re-arms and fires again roughly every threshold window if still frozen afterward', () => {
    const onStall = vi.fn()
    const watchdog = createStallWatchdog({
      isActive: () => true,
      sample: () => baseSample({ currentTime: 5 }),
      onStall,
      stallThresholdMs: 7000,
      sampleIntervalMs: 1000,
    })
    vi.advanceTimersByTime(7000)
    expect(onStall).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(7000)
    expect(onStall).toHaveBeenCalledTimes(2)
    watchdog.dispose()
  })

  it('does not treat tiny floating-point currentTime jitter as progress', () => {
    const onStall = vi.fn()
    let t = 5
    const watchdog = createStallWatchdog({
      isActive: () => true,
      sample: () => baseSample({ currentTime: t }),
      onStall,
      stallThresholdMs: 7000,
      sampleIntervalMs: 1000,
      minProgressSeconds: 0.25,
    })
    for (let i = 0; i < 7; i++) {
      t += 0.001 // negligible jitter, well under minProgressSeconds
      vi.advanceTimersByTime(1000)
    }
    expect(onStall).toHaveBeenCalledTimes(1)
    watchdog.dispose()
  })

  it('cleans up its timer on dispose — no further onStall calls after disposal', () => {
    const onStall = vi.fn()
    const watchdog = createStallWatchdog({
      isActive: () => true,
      sample: () => baseSample({ currentTime: 5 }),
      onStall,
      stallThresholdMs: 7000,
      sampleIntervalMs: 1000,
    })
    vi.advanceTimersByTime(6000)
    watchdog.dispose()
    vi.advanceTimersByTime(60000)
    expect(onStall).not.toHaveBeenCalled()
  })

  it('resets its baseline when playback pauses and resumes, giving a fresh window', () => {
    const onStall = vi.fn()
    let paused = false
    const watchdog = createStallWatchdog({
      isActive: () => true,
      sample: () => baseSample({ currentTime: 5, paused }),
      onStall,
      stallThresholdMs: 7000,
      sampleIntervalMs: 1000,
    })
    vi.advanceTimersByTime(6000) // 6s frozen but not yet stalled
    paused = true
    vi.advanceTimersByTime(10000) // paused for a while — must not count toward the threshold
    paused = false
    vi.advanceTimersByTime(6000) // only 6s of real frozen-while-active time again
    expect(onStall).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000) // now 7s since resuming
    expect(onStall).toHaveBeenCalledTimes(1)
    watchdog.dispose()
  })
})
