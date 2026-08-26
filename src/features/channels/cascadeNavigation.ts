import type { CascadeLevel } from './BrowseCascadeScreen'

// Pure decision logic for what a Back press does in the channel cascade
// (Country → Category → Channel → Preview) — pulled out of
// BrowseCascadeScreen's useBackHandler callback so the actual drill-up
// sequence can be unit tested without simulating spatial-nav focus/DOM.
// Search mode is handled by the caller BEFORE calling this (clearing the
// query takes priority over any cascade level) — see BrowseCascadeScreen's
// own back handler.
export type CascadeBackResult = { level: CascadeLevel } | { exit: true }

export function previousCascadeStep(level: CascadeLevel): CascadeBackResult {
  if (level === 'preview') return { level: 'channel' }
  if (level === 'channel') return { level: 'category' }
  if (level === 'category') return { level: 'country' }
  return { exit: true }
}

// The Country column collapses to a flag-only rail ONLY in the fully
// expanded four-pane state (Country + Category + Channels + Preview), where
// four panes and their gaps no longer leave Channels a usable width. At one,
// two or three panes there is room for the full country row, and it stays
// exactly as it was.
//
// Pure and shared so the TSX (which passes `compact` to ListRow) and the CSS
// (which keys the same state off [data-cols='4']) can never disagree about
// what "four panes" means — a mismatch would render a full-width row inside a
// ~96px rail, or a flag-only row inside a wide column. Search mode is a
// different, 1- or 2-pane layout and never reaches four.
export const CASCADE_FULL_PANE_COUNT = 4

export function isCompactCountryRail(colCount: number): boolean {
  return colCount >= CASCADE_FULL_PANE_COUNT
}
