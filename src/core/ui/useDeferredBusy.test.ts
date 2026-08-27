// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { MIN_VISIBLE_MS, SHOW_DELAY_MS, useDeferredBusy } from './useDeferredBusy'

// Renders the hook and reports every value it has returned, so the
// assertions below can say "it was never visible" rather than only "it is
// not visible now" — the whole point of the show delay is a panel that
// never appears at all.
function harness(options?: { showDelayMs?: number }) {
  const seen: boolean[] = []
  function Probe({ busy }: { busy: boolean }) {
    seen.push(useDeferredBusy(busy, options))
    return null
  }
  const view = render(createElement(Probe, { busy: true }))
  return {
    seen,
    setBusy: (busy: boolean) => act(() => view.rerender(createElement(Probe, { busy }))),
  }
}

const advance = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useDeferredBusy', () => {
  it('never shows anything for an operation that finishes instantly', async () => {
    const { seen, setBusy } = harness()
    await advance(SHOW_DELAY_MS - 20)
    setBusy(false)
    await advance(5000)
    expect(seen).not.toContain(true)
  })

  it('shows once the operation outlasts the delay', async () => {
    const { seen } = harness()
    expect(seen.at(-1)).toBe(false)
    await advance(SHOW_DELAY_MS + 1)
    expect(seen.at(-1)).toBe(true)
  })

  it('stays up for its minimum window even when the operation ends the moment it appears', async () => {
    const { seen, setBusy } = harness()
    await advance(SHOW_DELAY_MS + 1)
    setBusy(false)
    // Still up: taking it away here is the same flicker in reverse.
    expect(seen.at(-1)).toBe(true)
    await advance(MIN_VISIBLE_MS - 10)
    expect(seen.at(-1)).toBe(true)
    await advance(20)
    expect(seen.at(-1)).toBe(false)
  })

  it('hides immediately when the operation ran well past the minimum window', async () => {
    const { seen, setBusy } = harness()
    await advance(SHOW_DELAY_MS + MIN_VISIBLE_MS + 1000)
    expect(seen.at(-1)).toBe(true)
    setBusy(false)
    expect(seen.at(-1)).toBe(false)
  })

  it('can be shown again by a second operation', async () => {
    const { seen, setBusy } = harness()
    await advance(SHOW_DELAY_MS + MIN_VISIBLE_MS + 100)
    setBusy(false)
    expect(seen.at(-1)).toBe(false)
    setBusy(true)
    await advance(SHOW_DELAY_MS + 1)
    expect(seen.at(-1)).toBe(true)
  })
})

// showDelayMs: 0 is a DIFFERENT MECHANISM, not a smaller number — see the
// hook. The work it covers (parsing a 30,000-channel M3U) holds the main
// thread for seconds, so a timer-scheduled show is never reached: the panel
// has to be decided during render, in the very commit that sets `busy`.
describe('useDeferredBusy with showDelayMs: 0', () => {
  it('is visible on the FIRST render, before any timer could fire', () => {
    const { seen } = harness({ showDelayMs: 0 })
    expect(seen[0]).toBe(true)
  })

  it('stays visible with no timers running at all', async () => {
    const { seen } = harness({ showDelayMs: 0 })
    // Simulates the blocked main thread: no timer callbacks are delivered.
    await act(async () => {})
    expect(seen.at(-1)).toBe(true)
  })

  it('still honours the minimum-visible window on the way out', async () => {
    const { seen, setBusy } = harness({ showDelayMs: 0 })
    setBusy(false)
    expect(seen.at(-1)).toBe(true)
    await advance(MIN_VISIBLE_MS + 20)
    expect(seen.at(-1)).toBe(false)
  })
})
