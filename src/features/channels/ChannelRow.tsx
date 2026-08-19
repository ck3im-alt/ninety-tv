import { useEffect } from 'react'
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import type { Channel } from '../../data/channel'

// Shared channel-row component for CategoryChannelsScreen (Favorites/
// Recently Watched) and BrowseCascadeScreen's channel/search columns (via
// VirtualChannelList). Kept in its own file — both CategoryChannelsScreen
// and VirtualChannelList need it, and VirtualChannelList is itself used by
// CategoryChannelsScreen, so defining it there would create a circular
// import.
export function ChannelRow({
  channel,
  active,
  favorited,
  onSelect,
  onToggleFavorite,
  forceFocus,
  onFocus,
  onArrowLeft,
  onArrowUp,
  onArrowDown,
  focusKey,
}: {
  channel: Channel
  active: boolean
  favorited: boolean
  onSelect: () => void
  onToggleFavorite: () => void
  // The initial-focus target norigin's setFocus(ROOT_FOCUS_KEY) lands on —
  // set on the first row so arrow keys have something to navigate from.
  forceFocus?: boolean
  // Fires as the row gains keyboard/remote focus (arrow-scrolling), not
  // just on Enter — lets the preview pane show live as you scroll instead
  // of requiring a commit press first.
  onFocus?: () => void
  // Left-arrow steps back to the previous cascade column instead of the
  // default spatial-nav search, which — since this row also nests a
  // focusable favorite star — can otherwise land on that star instead of
  // leaving the column at all.
  onArrowLeft?: () => void
  // Up-arrow from the topmost row steps out to the toolbar above (Filter/
  // Recently Watched/Favorites).
  onArrowUp?: () => void
  // Down-arrow from the bottommost MOUNTED row (not necessarily the last
  // logical channel — see VirtualChannelList) shifts the virtualization
  // window instead of falling through to norigin's default geometry search,
  // which has nothing mounted below to find.
  onArrowDown?: () => void
  // Stable per-absolute-index key so VirtualChannelList can setFocus() a
  // specific row once it's mounted after a window shift. Optional — falls
  // back to norigin's auto-generated key for any other caller.
  focusKey?: string
}) {
  const { ref, focused } = useFocusable({
    focusKey,
    onEnterPress: onSelect,
    onFocus,
    forceFocus,
    onArrowPress: (direction) => {
      if (direction === 'left' && onArrowLeft) {
        onArrowLeft()
        return false
      }
      if (direction === 'up' && onArrowUp) {
        onArrowUp()
        return false
      }
      if (direction === 'down' && onArrowDown) {
        onArrowDown()
        return false
      }
      return true
    },
  })
  const { ref: starRef, focused: starFocused } = useFocusable({ onEnterPress: onToggleFavorite })

  // Spatial nav moves focus but never scrolls its container for you.
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [focused, ref])

  return (
    <div ref={ref} className={`ch-row ${active ? 'active' : ''} ${focused ? 'focused' : ''}`} onClick={onSelect}>
      <div className="ch-row-logo">
        {channel.logo ? <img src={channel.logo} alt="" /> : <span className="ch-row-logo-fallback">{channel.name.slice(0, 2).toUpperCase()}</span>}
      </div>
      <span className="ch-row-name">{channel.name}</span>
      {channel.sources.length > 1 ? (
        <span className="ch-row-source-count">{channel.sources.length} sources</span>
      ) : (
        channel.sources[0] && <span className="ch-row-source-count">{channel.sources[0].label}</span>
      )}
      <button
        ref={starRef}
        className={`ch-row-favorite ${favorited ? 'active' : ''} ${starFocused ? 'focused' : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          onToggleFavorite()
        }}
        aria-label={favorited ? 'Remove from favorites' : 'Add to favorites'}
      >
        {favorited ? '★' : '☆'}
      </button>
    </div>
  )
}
