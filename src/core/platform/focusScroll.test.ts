// The arithmetic behind every focused-element scroll in the app.
//
// Tested here rather than through a rendered screen on purpose: jsdom has no
// layout engine, so a component test can only ever assert that SOMETHING was
// called, never that the resulting offset is right. These are the three real
// reported symptoms — a row parked on the bottom line, a page that could not
// reach its own top again, a nested list dragging the document — expressed
// as numbers.
import { describe, expect, it } from 'vitest'
import { nextScrollOffset, TV_FOCUS_SCROLL_INSET } from './focusScroll'

// A container whose padding box is 1000px tall at viewport y=0, holding
// 4000px of content. Every case below varies only where the focused row is.
const container = {
  current: 0,
  max: 3000,
  viewportStart: 0,
  viewportEnd: 1000,
  inset: TV_FOCUS_SCROLL_INSET,
}

describe('nextScrollOffset — a focused row must not sit on the viewport edge', () => {
  it('leaves a row that already has clearance exactly where it is', () => {
    expect(nextScrollOffset({ ...container, current: 500, targetStart: 400, targetEnd: 476 })).toBe(500)
  })

  // THE SCHEDULE SYMPTOM. Moving Down onto the next fixture used to settle
  // it flush with the bottom of the panel; it now keeps a full inset under
  // it.
  it('scrolls a row flush with the bottom edge down by the full inset', () => {
    const next = nextScrollOffset({ ...container, current: 500, targetStart: 924, targetEnd: 1000 })
    expect(next).toBe(500 + TV_FOCUS_SCROLL_INSET)
  })

  it('scrolls a row hanging past the bottom edge far enough to clear it too', () => {
    // 40px of the row is already below the fold, plus the inset on top.
    const next = nextScrollOffset({ ...container, current: 500, targetStart: 964, targetEnd: 1040 })
    expect(next).toBe(500 + 40 + TV_FOCUS_SCROLL_INSET)
  })

  it('scrolls a row flush with the top edge back by the full inset', () => {
    const next = nextScrollOffset({ ...container, current: 500, targetStart: 0, targetEnd: 76 })
    expect(next).toBe(500 - TV_FOCUS_SCROLL_INSET)
  })

  it('moves the minimum needed, never centring the row', () => {
    // 10px short of the inset: it needs 10px, not a re-centre.
    const next = nextScrollOffset({ ...container, current: 500, targetStart: 22, targetEnd: 98 })
    expect(next).toBe(490)
  })
})

describe('nextScrollOffset — reaching the true top and bottom', () => {
  // THE MATCH VIEW SYMPTOM. Back is absolutely positioned at top: 28px on
  // the hero, so `block: 'nearest'` scrolled the document to exactly 28 and
  // called it done — the page stopped a visible sliver short of its top,
  // every single time the viewer navigated back up.
  it('snaps to 0 when an upward scroll lands within an inset of the top', () => {
    const next = nextScrollOffset({ ...container, current: 28, targetStart: 0, targetEnd: 40 })
    expect(next).toBe(0)
  })

  it('snaps to the very bottom when a downward scroll lands within an inset of it', () => {
    const next = nextScrollOffset({ ...container, current: 2960, targetStart: 950, targetEnd: 1000 })
    expect(next).toBe(3000)
  })

  // The snap is DIRECTIONAL. Snapping a small downward scroll back to 0
  // because the number happened to be under the inset would undo the very
  // correction that brought the row into view.
  it('never snaps a downward scroll backwards to the top', () => {
    const next = nextScrollOffset({ ...container, current: 0, targetStart: 990, targetEnd: 1000 })
    expect(next).toBeGreaterThan(0)
    expect(next).toBe(TV_FOCUS_SCROLL_INSET)
  })

  it('never snaps an upward scroll forwards to the bottom', () => {
    const next = nextScrollOffset({ ...container, current: 3000, targetStart: 0, targetEnd: 76 })
    expect(next).toBe(3000 - TV_FOCUS_SCROLL_INSET)
  })

  it('clamps rather than scrolling past either end', () => {
    expect(nextScrollOffset({ ...container, current: 0, targetStart: -500, targetEnd: -424 })).toBe(0)
    expect(nextScrollOffset({ ...container, current: 3000, targetStart: 1500, targetEnd: 1576 })).toBe(3000)
  })
})

describe('nextScrollOffset — degenerate geometry', () => {
  // A container with nothing to scroll must never be written to: assigning
  // scrollTop on it is harmless but pointless, and returning `current`
  // is what lets the caller skip the write entirely.
  it('does nothing at all when there is nothing to scroll', () => {
    expect(nextScrollOffset({ ...container, max: 0, current: 0, targetStart: 5000, targetEnd: 5076 })).toBe(0)
  })

  // A row taller than the viewport minus two insets cannot have both, so the
  // clearance shrinks to what fits. Without this it would ask to move down
  // and up in the same frame and never settle.
  it('shrinks the clearance for a target too tall to have it on both sides', () => {
    const tall = { ...container, current: 500, targetStart: 1010, targetEnd: 1990 }
    const next = nextScrollOffset(tall)
    // 980px target in a 1000px viewport: 10px of clearance is all that fits,
    // so it aligns to the bottom minus 10 rather than minus 32.
    expect(next).toBe(500 + 1990 - 1000 + 10)
  })

  // A target taller than the whole viewport can have no clearance on either
  // side, so this degrades to exactly what `block: 'nearest'` did: bring in
  // the edge that is currently outside, and stop. No focusable in the app is
  // this tall; the case is pinned so the function stays total rather than
  // producing an oscillation if one ever becomes so.
  it('falls back to plain nearest-edge alignment for a target taller than the viewport', () => {
    const huge = { ...container, current: 500, targetStart: 1200, targetEnd: 3200 }
    // Entirely below the fold: its trailing edge is brought to the viewport's.
    expect(nextScrollOffset(huge)).toBe(500 + 3200 - 1000)
  })
})
