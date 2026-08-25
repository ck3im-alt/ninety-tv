// Vertical navigation model for onboarding's picker surfaces.
//
// WHY THIS EXISTS. Norigin resolves Up/Down geometrically, and only treats
// two elements as adjacent when they overlap by >=20%. That works inside a
// single uniform grid and fails everywhere else onboarding actually needs
// it: a partially-filled last row (the cards above the gap have nothing
// beneath them), the boundary between two separate CSS grids (one group's
// last row to the next group's first), a full-width control sandwiched
// between grids, and the jump from the last card to the footer. The
// previous pass patched those cases one at a time with per-card
// `setFocus(<specific key>)` calls, which only held for one particular
// catalog shape.
//
// Instead, the screen declares the rendered surface as an ordered list of
// ROWS of focus keys — derived from the same arrays it renders from — and
// every Up/Down is answered by looking the current key up in that model.
// Nothing here knows a competition id, a country name or a grid size; add a
// group, change the column count, or let the backend grow the catalog and
// navigation follows automatically.

// One row of focus keys, left to right. A full-width control (the
// More-leagues expander) is simply a row with a single key.
export type FocusRow = readonly string[]
export type FocusChain = readonly FocusRow[]

// Splits a flat list of focus keys into grid rows. The final row is short
// whenever the count isn't a multiple of `columns` — which is precisely the
// case norigin's geometry gets wrong.
export function chunkIntoRows(keys: readonly string[], columns: number): string[][] {
  if (columns < 1) return keys.length > 0 ? [[...keys]] : []
  const rows: string[][] = []
  for (let i = 0; i < keys.length; i += columns) rows.push(keys.slice(i, i + columns))
  return rows
}

interface Position {
  row: number
  column: number
}

export function findInChain(chain: FocusChain, focusKey: string): Position | null {
  for (let row = 0; row < chain.length; row++) {
    const column = chain[row].indexOf(focusKey)
    if (column !== -1) return { row, column }
  }
  return null
}

// The key one row up/down, keeping the column where possible.
//
// Column is CLAMPED to the target row's length rather than requiring an
// exact match: moving down from column 5 of an 8-wide row into a 2-card
// group lands on that group's last card instead of nowhere. This is the
// single rule that makes partial rows and uneven groups behave.
//
// Returns null when there is no row in that direction — the caller decides
// what that means (the footer below the last row, blocking at the top).
export function verticalNeighbour(chain: FocusChain, focusKey: string, direction: 'up' | 'down'): string | null {
  const position = findInChain(chain, focusKey)
  if (!position) return null
  const targetRow = chain[position.row + (direction === 'down' ? 1 : -1)]
  if (!targetRow || targetRow.length === 0) return null
  return targetRow[Math.min(position.column, targetRow.length - 1)]
}

// Whether a key is at the far left / far right of its own row, i.e. moving
// that way would leave the surface entirely. Used to consume the key press
// rather than let norigin's search escape to the (invisible) screen root.
export function isRowEdge(chain: FocusChain, focusKey: string, direction: 'left' | 'right'): boolean {
  const position = findInChain(chain, focusKey)
  if (!position) return false
  return direction === 'left' ? position.column === 0 : position.column === chain[position.row].length - 1
}

// First key of the last non-empty row — where Up out of the footer lands.
export function lastRowEntry(chain: FocusChain): string | null {
  for (let row = chain.length - 1; row >= 0; row--) {
    if (chain[row].length > 0) return chain[row][0]
  }
  return null
}
