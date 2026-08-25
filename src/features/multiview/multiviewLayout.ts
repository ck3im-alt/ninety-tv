// Pure pane-count -> layout classification. The actual grid-template
// values live in MultiviewScreen.css, keyed off this id via a data
// attribute — kept out of this function so the "which layout for N panes"
// decision stays trivially testable without touching CSS/DOM at all.
export type MultiviewLayoutId = 'single' | 'two' | 'three' | 'four'

// 2 -> 50/50 side-by-side; 3 -> one large pane + two stacked small; 4 -> 2x2.
// 'single' exists for completeness (a lone pane, e.g. right after Add to
// Multiview before a second event is added) — full-bleed, no split.
export function multiviewLayoutFor(paneCount: number): MultiviewLayoutId {
  if (paneCount <= 1) return 'single'
  if (paneCount === 2) return 'two'
  if (paneCount === 3) return 'three'
  return 'four'
}
