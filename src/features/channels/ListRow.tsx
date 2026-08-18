import { useEffect, type ReactNode } from 'react'
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import './ListRow.css'

interface Props {
  // Countries show a flag; categories deliberately show no icon (per user
  // request) — so this is optional, not every row has one.
  icon?: ReactNode
  label: string
  count: number
  onSelect: () => void
  // Only categories are favoritable so far — optional so the country list
  // doesn't need to pass anything.
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
  // row also nests a focusable favorite star — can otherwise land on that
  // star instead of leaving the column at all.
  onArrowLeft?: () => void
  // Up-arrow from the topmost row steps out to the toolbar above (Filter/
  // Recently Watched/Favorites) — that row doesn't horizontally overlap any
  // cascade column, so default geometry-based nav can't reliably reach it.
  onArrowUp?: () => void
}

function FavoriteStar({ favorited, onToggle }: { favorited: boolean; onToggle: () => void }) {
  const { ref, focused } = useFocusable({ onEnterPress: onToggle })
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
export function ListRow({ icon, label, count, onSelect, favorited, onToggleFavorite, active, onFocus, onArrowLeft, onArrowUp }: Props) {
  const { ref, focused } = useFocusable({
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
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [focused, ref])

  return (
    <div ref={ref} className={`list-row ${focused ? 'focused' : ''} ${active ? 'active' : ''}`} onClick={onSelect}>
      {icon && <span className="list-row-icon">{icon}</span>}
      <span className="list-row-label">{label}</span>
      <span className="list-row-count">{count} channels</span>
      {onToggleFavorite && <FavoriteStar favorited={!!favorited} onToggle={onToggleFavorite} />}
      <span className="list-row-chevron">›</span>
    </div>
  )
}
