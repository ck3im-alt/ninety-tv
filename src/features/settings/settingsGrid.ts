// Explicit neighbour resolution for Settings' small card grids.
//
// The spatial-navigation library's geometric search is reliable for a single
// column (every list in this screen leans on it) but has been repeatedly
// unreliable across this app's grids — the 20%-overlap rule makes "the card
// below" ambiguous whenever rows differ in height, and a miss leaves focus
// on the screen root, which draws no ring at all. These grids are small and
// their shape is known, so stating the answer is both cheaper and provably
// dead-end-free.
export type GridDirection = 'left' | 'right' | 'up' | 'down'

// Returns the index the given arrow press should move to, or null when the
// press leaves the grid entirely (the caller decides what's outside: the
// section rail, the row above, or nothing at all). Never wraps.
export function gridNeighborIndex(index: number, count: number, columns: number, direction: GridDirection): number | null {
  if (index < 0 || index >= count || columns < 1) return null
  const column = index % columns
  if (direction === 'left') return column === 0 ? null : index - 1
  if (direction === 'right') return column === columns - 1 || index + 1 >= count ? null : index + 1
  if (direction === 'up') return index - columns >= 0 ? index - columns : null
  // Down from a partial last row: fall to the last item rather than nowhere,
  // so a grid whose final row is short never has an unreachable entry.
  if (index + columns < count) return index + columns
  const lastRowStart = (Math.ceil(count / columns) - 1) * columns
  return index < lastRowStart ? count - 1 : null
}
