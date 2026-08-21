// Pure decision logic for "the item that currently owns focus just
// disappeared from the list — what should focus move to instead?" Used
// anywhere a list can shrink out from under the user's remote: unfavoriting
// the focused channel on the Favorites screen, a Filter change hiding the
// focused country/category, Football being deselected while its league grid
// is focused, an event's candidate-stream row list re-filtering, etc.
//
// Kept as one pure function (no DOM/focus-library calls) so the actual
// decision — next item, else previous, else nothing — can be unit tested
// without simulating spatial-nav geometry. The caller is responsible for
// turning the returned index into a real setFocus() call (or falling back
// to a fixed anchor like Back when the result is null).
export interface FallbackAfterRemoval<T> {
  item: T
  index: number
}

// `previousItems`/`previousIndex` describe where the now-gone item used to
// sit; `nextItems` is the list AFTER the removal. Returns null when
// `nextItems` is empty — the caller should fall back to a fixed anchor
// (Back, a toolbar button, etc.) in that case, not call setFocus with
// nothing to target.
export function pickFallbackAfterRemoval<T>(previousIndex: number, nextItems: readonly T[]): FallbackAfterRemoval<T> | null {
  if (nextItems.length === 0) return null
  // Prefer "next item" (same index now points at whatever slid up to take
  // the removed item's place) — falls back to "previous item" only once the
  // removed item was the last one in the list.
  const index = Math.min(previousIndex, nextItems.length - 1)
  return { item: nextItems[index], index }
}

// Convenience wrapper for the common shape: a list of objects with a stable
// `id`, where the caller just wants to know "is the currently-selected id
// still present, and if not, what should replace it".
export function pickFallbackAfterIdRemoval<T>(
  previousItems: readonly T[],
  nextItems: readonly T[],
  selectedId: string,
  getId: (item: T) => string,
): FallbackAfterRemoval<T> | null {
  const stillPresent = nextItems.some((item) => getId(item) === selectedId)
  if (stillPresent) return null // nothing to recover from
  const previousIndex = previousItems.findIndex((item) => getId(item) === selectedId)
  if (previousIndex === -1) return null // wasn't in the previous list either — not a removal
  return pickFallbackAfterRemoval(previousIndex, nextItems)
}
