import { useFocusable, setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { useFocusScrollIntoView } from '../../core/platform'
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
  showFavorite = true,
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
  // back to norigin's auto-generated key for any other caller. Also used
  // (below) to derive the favorite star's own key, so Right/Left between
  // the row and its star has an explicit, deterministic target instead of
  // depending on norigin's geometry-based search — which, since the row and
  // its nested star both register under whatever the ambient FocusContext
  // is (this component doesn't introduce its own), are really SIBLINGS in
  // the focus tree, not parent/child, despite the visual nesting. Geometry
  // alone previously meant Right from a row could occasionally land on a
  // DIFFERENT row's star, or Left from a star could skip past its own row.
  focusKey?: string
  // Four-column Browse Cascade hides the star via CSS to keep that fully-
  // expanded view calm (see BrowseCascadeScreen.css's [data-cols='4']
  // rule) — this must also stop it from being a registered spatial-nav
  // target, or a hidden/zero-size star becomes a dead landing spot for
  // Right from the row. Defaults true for every other caller.
  showFavorite?: boolean
}) {
  const starFocusKey = focusKey ? `${focusKey}-favorite` : undefined
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
      if (direction === 'right' && showFavorite && starFocusKey) {
        void setFocus(starFocusKey)
        return false
      }
      return true
    },
  })
  const { ref: starRef, focused: starFocused } = useFocusable({
    focusKey: starFocusKey,
    focusable: showFavorite,
    onEnterPress: onToggleFavorite,
    onArrowPress: (direction) => {
      if (direction === 'left' && focusKey) {
        void setFocus(focusKey)
        return false
      }
      return true
    },
  })

  // Spatial nav moves focus but never scrolls its container for you.
  useFocusScrollIntoView(ref, focused)

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
      {showFavorite && (
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
      )}
    </div>
  )
}
