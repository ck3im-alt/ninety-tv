import { describe, expect, it } from 'vitest'
import { chunkIntoRows, findInChain, isRowEdge, lastRowEntry, verticalNeighbour } from './focusChain'

describe('chunkIntoRows', () => {
  it('splits an exact multiple into full rows', () => {
    expect(chunkIntoRows(['a', 'b', 'c', 'd'], 2)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('leaves the final row short when the count does not divide evenly', () => {
    expect(chunkIntoRows(['a', 'b', 'c', 'd', 'e'], 3)).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e'],
    ])
  })

  it('handles empty input and a single item', () => {
    expect(chunkIntoRows([], 8)).toEqual([])
    expect(chunkIntoRows(['a'], 8)).toEqual([['a']])
  })
})

// The shape step 2 actually renders: a 2-card sports row, one recommended
// row, the full-width expander, then three groups of uneven size — the
// "Group A: 5, Group B: 2, Group C: 4" case where geometry bugs live.
const CHAIN = [
  ['sport-football', 'sport-f1'],
  ['rec-1', 'rec-2', 'rec-3', 'rec-4'],
  ['leagues-toggle'],
  ['a1', 'a2', 'a3', 'a4'],
  ['a5'],
  ['b1', 'b2'],
  ['c1', 'c2', 'c3', 'c4'],
]

describe('findInChain', () => {
  it('locates a key by row and column', () => {
    expect(findInChain(CHAIN, 'b2')).toEqual({ row: 5, column: 1 })
  })

  it('returns null for a key that is not on the surface', () => {
    expect(findInChain(CHAIN, 'nope')).toBeNull()
  })
})

describe('verticalNeighbour', () => {
  it('keeps the column when the next row is at least as wide', () => {
    expect(verticalNeighbour(CHAIN, 'b2', 'down')).toBe('c2')
    expect(verticalNeighbour(CHAIN, 'a3', 'up')).toBe('leagues-toggle')
  })

  it('clamps the column into a shorter row instead of finding nothing', () => {
    // Row ['a5'] has one cell: coming down from column 2 lands on it rather
    // than falling through the gap, which is what norigin's geometry does.
    expect(verticalNeighbour(CHAIN, 'a3', 'down')).not.toBeNull()
    expect(verticalNeighbour(CHAIN, 'a4', 'down')).toBe('a5')
    expect(verticalNeighbour(CHAIN, 'a1', 'down')).toBe('a5')
  })

  it('moves between two different groups as an ordinary row change', () => {
    expect(verticalNeighbour(CHAIN, 'a5', 'down')).toBe('b1')
    expect(verticalNeighbour(CHAIN, 'b2', 'down')).toBe('c2')
    expect(verticalNeighbour(CHAIN, 'c4', 'up')).toBe('b2') // clamped from column 3 into a 2-wide row
  })

  it('treats the full-width expander as a one-cell row in both directions', () => {
    expect(verticalNeighbour(CHAIN, 'leagues-toggle', 'down')).toBe('a1')
    expect(verticalNeighbour(CHAIN, 'leagues-toggle', 'up')).toBe('rec-1')
    expect(verticalNeighbour(CHAIN, 'rec-3', 'down')).toBe('leagues-toggle')
    expect(verticalNeighbour(CHAIN, 'a2', 'up')).toBe('leagues-toggle')
  })

  it('returns null past the last row, so the caller can hand off to the footer', () => {
    expect(verticalNeighbour(CHAIN, 'c1', 'down')).toBeNull()
    expect(verticalNeighbour(CHAIN, 'c4', 'down')).toBeNull()
  })

  it('returns null above the first row, so the caller can block', () => {
    expect(verticalNeighbour(CHAIN, 'sport-football', 'up')).toBeNull()
    expect(verticalNeighbour(CHAIN, 'sport-f1', 'up')).toBeNull()
  })

  it('returns null for an unknown key rather than throwing', () => {
    expect(verticalNeighbour(CHAIN, 'nope', 'down')).toBeNull()
  })

  it('is reversible between two rows of the same width', () => {
    // b/c are 2 and 4 wide, so use the pair that genuinely lines up.
    expect(verticalNeighbour(CHAIN, verticalNeighbour(CHAIN, 'b1', 'down')!, 'up')).toBe('b1')
    expect(verticalNeighbour(CHAIN, verticalNeighbour(CHAIN, 'b2', 'down')!, 'up')).toBe('b2')
  })

  it('is deliberately NOT reversible across a narrower row — clamping wins', () => {
    // Down from a2 clamps into the single-cell row; Up from there clamps
    // back to column 0. Predictable, and far better than the alternative of
    // finding nothing at all.
    expect(verticalNeighbour(CHAIN, 'a2', 'down')).toBe('a5')
    expect(verticalNeighbour(CHAIN, 'a5', 'up')).toBe('a1')
  })

  it('answers Down for every key on the surface — no dead ends', () => {
    for (const row of CHAIN) {
      for (const key of row) {
        const target = verticalNeighbour(CHAIN, key, 'down')
        // Either a real neighbour, or null meaning "the footer" — never a
        // key that isn't on the surface.
        if (target !== null) expect(findInChain(CHAIN, target)).not.toBeNull()
      }
    }
  })

  it('collapses to a sports-only surface when football is deselected', () => {
    const collapsed = [['sport-football', 'sport-f1']]
    expect(verticalNeighbour(collapsed, 'sport-football', 'down')).toBeNull()
    expect(verticalNeighbour(collapsed, 'sport-football', 'up')).toBeNull()
  })
})

describe('isRowEdge', () => {
  it('detects the first and last cell of a row', () => {
    expect(isRowEdge(CHAIN, 'a1', 'left')).toBe(true)
    expect(isRowEdge(CHAIN, 'a1', 'right')).toBe(false)
    expect(isRowEdge(CHAIN, 'a4', 'right')).toBe(true)
    expect(isRowEdge(CHAIN, 'a2', 'left')).toBe(false)
  })

  it('treats a one-cell row as both edges', () => {
    expect(isRowEdge(CHAIN, 'leagues-toggle', 'left')).toBe(true)
    expect(isRowEdge(CHAIN, 'leagues-toggle', 'right')).toBe(true)
    expect(isRowEdge(CHAIN, 'a5', 'left')).toBe(true)
    expect(isRowEdge(CHAIN, 'a5', 'right')).toBe(true)
  })

  it('is false for a key that is not on the surface', () => {
    expect(isRowEdge(CHAIN, 'nope', 'left')).toBe(false)
  })
})

describe('lastRowEntry', () => {
  it('is the first key of the last row — where Up out of the footer lands', () => {
    expect(lastRowEntry(CHAIN)).toBe('c1')
  })

  it('skips trailing empty rows', () => {
    expect(lastRowEntry([['a'], []])).toBe('a')
  })

  it('is null for an empty surface', () => {
    expect(lastRowEntry([])).toBeNull()
    expect(lastRowEntry([[]])).toBeNull()
  })
})
