import type { ReactNode } from 'react'
import { useFocusable, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { useFocusScrollIntoView } from '../../core/platform'
import './ListRow.css'

interface Props {
  // Countries show a flag; categories deliberately show no icon (per user
  // request) — so this is optional, not every row has one.
  icon?: ReactNode
  label: string
  count: number
  onSelect: () => void
  // Only categories are favoritable so far — optional so the country list
  // doesn't need to pass anything. Also the supported way to hide the star
  // in a layout that doesn't have room for it (e.g. Browse Cascade's
  // 4-column view) — omit both `favorited` and `onToggleFavorite` rather
  // than CSS-hiding it, so it stops being a registered spatial-nav target
  // too, not just an invisible one.
  favorited?: boolean
  onToggleFavorite?: () => void
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
  // Stable identity for this row — lets the favorite star get an explicit,
  // deterministic focusKey (`${focusKey}-favorite`) instead of depending on
  // geometry for Right (row -> star) / Left (star -> row). The row and its
  // star register as SIBLINGS in the focus tree (this component doesn't
  // introduce its own FocusContext), so without this, Right from a row
  // could land on the wrong row's star, and there was previously no way
  // back for Left from the star at all except accidental geometry.
  // Optional — omit for a row with no favorite star.
  focusKey?: string
}

function FavoriteStar({
  favorited,
  onToggle,
  focusKey,
  rowFocusKey,
}: {
  favorited: boolean
  onToggle: () => void
  focusKey?: string
  rowFocusKey?: string
}) {
  const { ref, focused } = useFocusable({
    focusKey,
    onEnterPress: onToggle,
    onArrowPress: (direction) => {
      if (direction === 'left' && rowFocusKey) {
        void setFocus(rowFocusKey)
        return false
      }
      return true
    },
  })
  return (
    <button
      ref={ref}
      className={`list-row-favorite ${favorited ? 'active' : ''} ${focused ? 'focused' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      aria-label={favorited ? 'Remove from favorites' : 'Add to favorites'}
    >
      {favorited ? '★' : '☆'}
    </button>
  )
}

// Shared row component for both the Country list and the Category list, per
// NINETY_Channels_Design_System.md consistency rule #1 ("Country and
// Category use the same row component").
export function ListRow({
  icon,
  label,
  count,
  onSelect,
  favorited,
  onToggleFavorite,
  active,
  onFocus,
  onArrowLeft,
  onArrowUp,
  focusKey,
}: Props) {
  const starFocusKey = onToggleFavorite && focusKey ? `${focusKey}-favorite` : undefined
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
      if (direction === 'right' && starFocusKey) {
        void setFocus(starFocusKey)
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
    <div ref={ref} className={`list-row ${focused ? 'focused' : ''} ${active ? 'active' : ''}`} onClick={onSelect}>
      {icon && <span className="list-row-icon">{icon}</span>}
      <span className="list-row-label">{label}</span>
      <span className="list-row-count">{count} channels</span>
      {onToggleFavorite && (
        <FavoriteStar favorited={!!favorited} onToggle={onToggleFavorite} focusKey={starFocusKey} rowFocusKey={focusKey} />
      )}
      <span className="list-row-chevron">›</span>
    </div>
  )
}
