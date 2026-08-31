import type { ReactNode } from 'react'
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useFocusScrollIntoView } from '../../core/platform'
import './ListRow.css'

interface Props {
  // Countries show a flag; categories deliberately show no icon (per user
  // request) — so this is optional, not every row has one.
  icon?: ReactNode
  label: string
  count: number
  onSelect: () => void
  // NO FAVORITE STAR. This component used to render one for category rows;
  // the favorite-category feature was removed on 2026-08-31 (see
  // BrowseCascadeScreen's category column and data/session.ts), and with it
  // this row's second focusable, its Right/Left star handling and the
  // 4-column CSS rule that had to hide it. Channel rows keep their own star
  // — that is ChannelRow, a different component.
  // Highlights this row as the currently drilled-into selection — used by
  // the cascade browser, where the full list stays visible instead of
  // collapsing, so the chosen entry needs its own visual marker.
  active?: boolean
  // Fires as the row gains keyboard/remote focus (arrow-scrolling), not
  // just on Enter — lets the next column preview live as you scroll instead
  // of requiring a commit press first.
  onFocus?: () => void
  // Left-arrow steps back to the previous cascade column (e.g. Category ->
  // Country) instead of the default spatial-nav search, which — since this
  // row also has a nested favorite star — can otherwise land on that star
  // instead of leaving the column at all.
  onArrowLeft?: () => void
  // Up-arrow from the topmost row steps out to the toolbar above (Filter/
  // Recently Watched/Favorites) — that row doesn't horizontally overlap any
  // cascade column, so default geometry-based nav can't reliably reach it.
  onArrowUp?: () => void
  // Stable identity for this row, so a column can be entered at a SPECIFIC
  // row rather than by geometry. Optional.
  focusKey?: string
  // Flag-only rail mode, used ONLY by Browse Cascade's Country column in its
  // fully-expanded four-pane state (see BrowseCascadeScreen.css's
  // [data-cols='4'] rules). The label text, count and chevron are not
  // rendered at all — deliberately not CSS-hidden, so nothing invisible is
  // left occupying layout in a ~70px-wide rail. The label itself is NOT lost:
  // it moves onto the row as aria-label/title, so the country stays
  // identifiable to assistive tech and on hover.
  //
  // An explicit opt-in prop rather than a global style change, because this
  // component is shared with the Category column, which must keep its normal
  // full row at every column count.
  compact?: boolean
}

// Shared row component for both the Country list and the Category list, per
// NINETY_Channels_Design_System.md consistency rule #1 ("Country and
// Category use the same row component").
export function ListRow({
  icon,
  label,
  count,
  onSelect,
  active,
  onFocus,
  onArrowLeft,
  onArrowUp,
  focusKey,
  compact,
}: Props) {
  const { ref, focused } = useFocusable({
    focusKey,
    onEnterPress: onSelect,
    onFocus,
    onArrowPress: (direction) => {
      if (direction === 'left' && onArrowLeft) {
        onArrowLeft()
        return false
      }
      if (direction === 'up' && onArrowUp) {
        onArrowUp()
        return false
      }
      return true
    },
  })

  // The spatial-nav library moves focus but never scrolls — .cascade-list
  // scrolls its own overflow, so the newly focused row has to be scrolled
  // into view manually or it silently walks off-screen at the frame edges.
  useFocusScrollIntoView(ref, focused)

  return (
    <div
      ref={ref}
      className={`list-row ${compact ? 'list-row-compact' : ''} ${focused ? 'focused' : ''} ${active ? 'active' : ''}`}
      onClick={onSelect}
      aria-label={compact ? label : undefined}
      title={compact ? label : undefined}
    >
      {icon && <span className="list-row-icon">{icon}</span>}
      {!compact && (
        <>
          <span className="list-row-label">{label}</span>
          <span className="list-row-count">{count} channels</span>
        </>
      )}
      {!compact && <span className="list-row-chevron">›</span>}
    </div>
  )
}
