// The slicing rule itself — clock and event loop both injected, so this
// tests the DECISION ("when does this hand the main thread back?") rather
// than the timing of a particular machine.
import { describe, expect, it, vi } from 'vitest'
import { sliceWork } from './sliceWork'

// A controllable clock: each read advances by `perRead`, which lets a test
// say "each item costs 3 ms" without any real time passing.
function clock(perRead: number) {
  let t = 0
  return () => {
    const value = t
    t += perRead
    return value
  }
}

describe('sliceWork', () => {
  it('runs every item, in order', async () => {
    const seen: number[] = []
    const outcome = await sliceWork([1, 2, 3, 4, 5], (n) => void seen.push(n), { yieldFn: async () => {} })
    expect(outcome).toBe('completed')
    expect(seen).toEqual([1, 2, 3, 4, 5])
  })

  it('does not yield at all when the whole pass fits inside one slice', async () => {
    const yieldFn = vi.fn(async () => {})
    // Clock never advances -> elapsed is always 0 -> never over budget.
    await sliceWork([1, 2, 3, 4, 5, 6, 7, 8], () => {}, { sliceMs: 8, now: () => 0, yieldFn })
    expect(yieldFn).not.toHaveBeenCalled()
  })

  it('yields once the budget is exceeded, and restarts the budget after each yield', async () => {
    const yieldFn = vi.fn(async () => {})
    // Two reads per item (the post-item check plus, on a yield, the reset),
    // 5 ms per read, 8 ms budget -> over budget on roughly every other item.
    await sliceWork([1, 2, 3, 4, 5, 6], () => {}, { sliceMs: 8, now: clock(5), yieldFn })
    expect(yieldFn.mock.calls.length).toBeGreaterThan(0)
    expect(yieldFn.mock.calls.length).toBeLessThan(6)
  })

  it('yields between every item when a single item blows the budget on its own', async () => {
    const yieldFn = vi.fn(async () => {})
    await sliceWork([1, 2, 3, 4], () => {}, { sliceMs: 1, now: clock(100), yieldFn })
    expect(yieldFn).toHaveBeenCalledTimes(4)
  })

  it('stops immediately when the caller has been superseded, and reports it', async () => {
    const seen: number[] = []
    let cancelled = false
    const outcome = await sliceWork(
      [1, 2, 3, 4, 5],
      (n) => {
        seen.push(n)
        if (n === 2) cancelled = true
      },
      { shouldStop: () => cancelled, yieldFn: async () => {} },
    )
    expect(outcome).toBe('stopped')
    expect(seen).toEqual([1, 2])
  })

  it('stops on a cancellation that lands DURING a yield, not just between items', async () => {
    const seen: number[] = []
    let cancelled = false
    const outcome = await sliceWork([1, 2, 3], (n) => void seen.push(n), {
      sliceMs: 0,
      now: clock(1),
      shouldStop: () => cancelled,
      yieldFn: async () => {
        cancelled = true
      },
    })
    expect(outcome).toBe('stopped')
    expect(seen).toEqual([1])
  })

  it('awaits async work rather than firing every item off at once', async () => {
    let running = 0
    let maxConcurrent = 0
    await sliceWork(
      [1, 2, 3, 4],
      async () => {
        running++
        maxConcurrent = Math.max(maxConcurrent, running)
        await Promise.resolve()
        running--
      },
      { yieldFn: async () => {} },
    )
    expect(maxConcurrent).toBe(1)
  })
})
