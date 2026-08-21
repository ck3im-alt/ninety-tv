import { useEffect, useState } from 'react'
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import type { EventStreamOption } from './buildEventStreamOptions'
import type { EventStreamDisplayParts } from './ppvDisplayName'
import type { Channel, ChannelSource } from '../../data/channel'

export type StreamRowVariant = 'top' | 'other' | 'candidate'

interface StreamRowProps {
  option: EventStreamOption
  variant: StreamRowVariant
  // The #1 recommended row — strongest focus/emphasis styling, no numeric
  // badge (removed per the redesign task's second pass: row order already
  // communicates rank; a green "1/2/3" circle was redundant decoration).
  primary?: boolean
  // Live favorite-channel state, same Set/setter App.tsx already owns for
  // every other favorite star in the app (see App.tsx's favoriteChannels).
  // Read fresh here (not baked into `option` at build time) so toggling a
  // star updates immediately without re-ranking/reshuffling the list the
  // user is actively navigating — see EventDetailsScreen.tsx's ranking memo.
  favoriteChannels: ReadonlySet<string>
  onToggleFavoriteChannel: (channelId: string) => void
  // The optional third argument carries this row's contextual event-stream
  // display identity through to playback (see App.tsx's watchChannel /
  // ChannelPlayerScreen) — see Part V of the redesign task. Ordinary
  // channel-browsing screens' own onWatch handlers simply never read a
  // third argument, so this is additive, not a behavior change for them.
  onWatch: (channel: Channel, source: ChannelSource, displayParts?: EventStreamDisplayParts) => void
  // Grabs initial focus on mount — set only on the #1 recommended stream
  // once matches are ready (see EventDetailsScreen.tsx); choosing a stream
  // is this screen's whole purpose, so that's the right initial target,
  // not Back.
  forceFocus?: boolean
  // Stable identity (option.key, the same value already used as this row's
  // React `key`) — lets EventDetailsScreen's root container target this
  // exact row via preferredChildFocusKey/setFocus once matches are ready,
  // instead of depending on forceFocus alone (which only affects the
  // global ROOT_FOCUS_KEY-resolution path, not a scoped screen key — see
  // App.tsx's SCREEN_FOCUS_KEYS for why this screen now needs one).
  focusKey?: string
}

function LogoTile({ logo, displayName }: { logo?: string; displayName: string }) {
  if (logo) return <img className="stream-row-logo-img" src={logo} alt="" />
  const monogram = /^ppv\b/i.test(displayName) ? 'PPV' : displayName.slice(0, 2).toUpperCase()
  return <span className="stream-row-logo-fallback">{monogram}</span>
}

// One selectable channel/quality row, reused for the Top 3 recommendations,
// "All other streams", and "Channels that might show it" — variant only
// changes the copy ("Watch now" vs "Watch") and row density (see the
// redesign task: recommended rows ~60-64px, other rows lighter still),
// never the underlying interaction model or quality rendering.
//
// Quality selection deliberately isn't its own set of focusable pills (the
// old SourcePicker's per-option useFocusable) — that turned every extra
// quality tier into another remote press just to reach Watch/Favorite. Left/
// Right while the row itself is focused instead cycles the selected source
// in place; Right falls through to normal spatial search (reaching the
// favorite star) once already at the lowest tier, same for Left at the
// highest.
export function StreamRow({
  option,
  variant,
  primary,
  favoriteChannels,
  onToggleFavoriteChannel,
  onWatch,
  forceFocus,
  focusKey,
}: StreamRowProps) {
  const [sourceIndex, setSourceIndex] = useState(0)
  const selected = option.sourceOptions[sourceIndex] ?? option.sourceOptions[0]
  const favorited = selected ? favoriteChannels.has(selected.channel.id) : false
  // Reflects whichever source the user actually has selected right now
  // (they may have cycled Left/Right through quality tiers before
  // pressing Watch — see the row's own onArrowPress) rather than always
  // the group's single best tier baked into option.displayParts at build
  // time — see Part W of the redesign task ("active source quality").
  const selectedDisplayParts = selected ? { ...option.displayParts, quality: selected.qualityLabel } : option.displayParts

  const { ref, focused } = useFocusable({
    focusKey,
    forceFocus,
    onEnterPress: () => selected && onWatch(selected.channel, selected.source, selectedDisplayParts),
    onArrowPress: (direction) => {
      if (direction === 'right' && sourceIndex < option.sourceOptions.length - 1) {
        setSourceIndex((i) => i + 1)
        return false
      }
      if (direction === 'left' && sourceIndex > 0) {
        setSourceIndex((i) => i - 1)
        return false
      }
      return true
    },
  })
  const { ref: starRef, focused: starFocused } = useFocusable({
    onEnterPress: () => selected && onToggleFavoriteChannel(selected.channel.id),
  })

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [focused, ref])
  useEffect(() => {
    if (starFocused) starRef.current?.scrollIntoView({ block: 'nearest' })
  }, [starFocused, starRef])

  return (
    <div className={`stream-row stream-row-${variant} ${primary ? 'top-pick' : ''} ${focused ? 'focused' : ''}`}>
      <button
        ref={ref}
        className="stream-row-main"
        onClick={() => selected && onWatch(selected.channel, selected.source, selectedDisplayParts)}
      >
        <LogoTile logo={option.logo} displayName={option.displayName} />
        <span className="stream-row-name">{option.displayName}</span>
        <span className="stream-row-country">{option.countryName ?? ''}</span>
        {/* Every row shows quality explicitly — an unrecognized tier reads
            as "Unknown" rather than an empty gap, which otherwise looks
            like the app forgot to load something (see the redesign task's
            second pass). Same renderer for every variant (top/other/
            candidate) and both the single- and multi-quality cases: the
            currently selected real tier is the only one visually
            highlighted, not hard-coded to whichever tier is "best". */}
        <span className="stream-row-qualities">
          {option.sourceOptions.map((sourceOption, index) => (
            <span
              key={`${sourceOption.channel.id}-${index}`}
              className={`stream-row-quality ${sourceOption.qualityLabel == null ? 'unknown' : index === sourceIndex ? 'selected' : ''}`}
            >
              {sourceOption.qualityLabel ?? 'Unknown'}
            </span>
          ))}
        </span>
        <span className="stream-row-watch">▷ {variant === 'top' ? 'Watch now' : 'Watch'}</span>
      </button>
      <button
        ref={starRef}
        className={`stream-row-favorite ${favorited ? 'active' : ''} ${starFocused ? 'focused' : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          if (selected) onToggleFavoriteChannel(selected.channel.id)
        }}
        aria-label={favorited ? 'Remove from favorites' : 'Add to favorites'}
      >
        {favorited ? '★' : '☆'}
      </button>
    </div>
  )
}
