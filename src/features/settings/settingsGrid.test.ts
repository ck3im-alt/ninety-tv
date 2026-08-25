import { describe, expect, it } from 'vitest'
import { gridNeighborIndex } from './settingsGrid'

// A 2-column grid of 5 entries:
//   0 1
//   2 3
//   4
describe('gridNeighborIndex (2 columns)', () => {
  it('moves within a row', () => {
    expect(gridNeighborIndex(0, 5, 2, 'right')).toBe(1)
    expect(gridNeighborIndex(1, 5, 2, 'left')).toBe(0)
  })

  it('moves between rows', () => {
    expect(gridNeighborIndex(0, 5, 2, 'down')).toBe(2)
    expect(gridNeighborIndex(3, 5, 2, 'up')).toBe(1)
  })

  it('reports leaving the grid on the left edge — the caller sends focus back to the region rail', () => {
    expect(gridNeighborIndex(0, 5, 2, 'left')).toBeNull()
    expect(gridNeighborIndex(2, 5, 2, 'left')).toBeNull()
  })

  it('reports leaving the grid on the top row and the right edge', () => {
    expect(gridNeighborIndex(1, 5, 2, 'up')).toBeNull()
    expect(gridNeighborIndex(1, 5, 2, 'right')).toBeNull()
  })

  it('falls to the last item when Down lands past a short final row, so no entry is unreachable', () => {
    // Index 3 is above nothing (the last row holds only index 4, in column
    // 0) — a strict index+columns move would dead-end here.
    expect(gridNeighborIndex(3, 5, 2, 'down')).toBe(4)
  })

  it('reports leaving the grid on the last row', () => {
    expect(gridNeighborIndex(4, 5, 2, 'down')).toBeNull()
  })

  it('never wraps, and rejects out-of-range input', () => {
    expect(gridNeighborIndex(4, 5, 2, 'right')).toBeNull()
    expect(gridNeighborIndex(-1, 5, 2, 'down')).toBeNull()
    expect(gridNeighborIndex(9, 5, 2, 'up')).toBeNull()
    expect(gridNeighborIndex(0, 5, 0, 'right')).toBeNull()
  })
})
