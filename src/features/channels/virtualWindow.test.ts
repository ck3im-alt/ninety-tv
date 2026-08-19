import { describe, expect, it } from 'vitest'
import { planWindowShift } from './virtualWindow'

// Regression coverage for the physical-Samsung "can't scroll down through
// Favorites/Recently Watched" bug: VirtualChannelList's shiftWindow used to
// call setWindowStart unconditionally, assuming the resulting state change
// would drive a setFocus() via effect. Whenever the computed window start
// was actually unchanged (any list that fits inside one window, or the
// leading/trailing overscan band of a bigger one), that setState was a
// same-value no-op — the effect never fired, and the keypress was silently
// swallowed. planWindowShift reports `shifted: false` in exactly that case,
// and the component focuses centerIndex directly instead of waiting on a
// window change that was never going to happen. windowSize=30/overscan=10
// (the real defaults) give a mounted window of 50 unless a list is smaller
// — this same function backs BrowseCascadeScreen's channel/search columns
// too, with no caller-specific special-casing.
describe('planWindowShift', () => {
  it('never needs a shift for a list that fits in one window (Favorites: 4 channels)', () => {
    // list length 4 <= windowSize+2*overscan, so mountedCount=4, maxStart=0
    // — the whole list is always mounted, exactly the reported case.
    const mountedCount = 4
    const maxStart = 0
    let windowStart = 0
    for (let row = 0; row < mountedCount - 1; row++) {
      const result = planWindowShift(row + 1, windowStart, mountedCount, maxStart)
      expect(result.shifted).toBe(false)
      windowStart = result.start
    }
    expect(windowStart).toBe(0)
  })

  it('full Up/Down traversal never needs a shift for Recently Watched (10 channels)', () => {
    const mountedCount = 10
    const maxStart = 0
    const windowStart = 0
    for (let row = 0; row < mountedCount - 1; row++) {
      expect(planWindowShift(row + 1, windowStart, mountedCount, maxStart).shifted).toBe(false)
    }
    for (let row = mountedCount - 1; row > 0; row--) {
      expect(planWindowShift(row - 1, windowStart, mountedCount, maxStart).shifted).toBe(false)
    }
  })

  it('shifts the window when moving down across the lower boundary of a large list', () => {
    // 200 channels, defaults: mountedCount=50, maxStart=150.
    const mountedCount = 50
    const maxStart = 150
    const result = planWindowShift(41, 0, mountedCount, maxStart)
    expect(result.shifted).toBe(true)
    expect(result.start).toBe(16) // 41 - floor(50/2)
  })

  it('does not need a shift once already scrolled to the true end (last ~overscan rows)', () => {
    // Window already maxed out at [150, 200) — reaching for row 196 (still
    // inside that range) must resolve without moving the window at all,
    // exactly like the small-list case above.
    const mountedCount = 50
    const maxStart = 150
    const result = planWindowShift(196, maxStart, mountedCount, maxStart)
    expect(result.shifted).toBe(false)
    // Proof obligation from virtualWindow.ts's comment: centerIndex must be
    // inside the (unchanged) mounted range whenever shifted is false.
    expect(196).toBeGreaterThanOrEqual(maxStart)
    expect(196).toBeLessThan(maxStart + mountedCount)
  })

  it('shifts the window when moving up across the upper boundary of a large list', () => {
    const mountedCount = 50
    const maxStart = 150
    const result = planWindowShift(155, 150, mountedCount, maxStart)
    expect(result.shifted).toBe(true)
    expect(result.start).toBe(130)
  })

  it('does not need a shift once already scrolled to the true start', () => {
    const mountedCount = 50
    const maxStart = 150
    const result = planWindowShift(3, 0, mountedCount, maxStart)
    expect(result.shifted).toBe(false)
    expect(3).toBeGreaterThanOrEqual(0)
    expect(3).toBeLessThan(mountedCount)
  })
})
