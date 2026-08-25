import { useEffect, useState } from 'react'
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import type { RankedEventStreamOption } from './buildEventStreamOptions'
import type { EventStreamDisplayParts } from './ppvDisplayName'
import type { Channel, ChannelSource } from '../../data/channel'

// 'default' — an ordinary trusted stream row, shown at full (compact)
// density inside a country group. 'candidate' — a loose/fuzzy match (see
// streamConfidence.ts), shown dimmer/denser inside the collapsed "might
// also have it" list. There is deliberately no third "recommended" variant
// any more — the redesign replaced the old separate Recommended/All views
// with one flowing list (see StreamSections.tsx); the single overall top
// pick is called out via the `primary` prop instead, orthogonal to variant.
export type StreamRowVariant = 'default' | 'candidate'

interface StreamRowProps {
  option: RankedEventStreamOption
  variant: StreamRowVariant
  // The single best stream across the whole event — strongest focus/
  // emphasis styling (a subtle accent border/tint, see the visual-redesign
  // task's "top pick" section). Row order and country grouping already
  // communicate rank otherwise, so this is the only row-level "this is the
  // one" signal.
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
  // Stable identity (option.key, the same value already used as this row's
  // React `key`) — lets EventDetailsScreen's root container target this
  // exact row via preferredChildFocusKey/setFocus once matches are ready,
  // instead of depending on forceFocus alone (which only affects the
  // global ROOT_FOCUS_KEY-resolution path, not a scoped screen key — see
  // App.tsx's SCREEN_FOCUS_KEYS for why this screen now needs one).
  focusKey?: string
  // Up from the FIRST row must land on the Back button above the list —
  // there's no filter bar any more for it to land on instead (see
  // StreamSections.tsx), and norigin's geometry-based search can't be
  // trusted to find a small top-left button from a full-width row on its
  // own.
  onArrowUp?: () => void
}

function LogoTile({ logo, displayName }: { logo?: string; displayName: string }) {
  if (logo) return <img className="stream-row-logo-img" src={logo} alt="" />
  const monogram = /^ppv\b/i.test(displayName) ? 'PPV' : displayName.slice(0, 2).toUpperCase()
  return <span className="stream-row-logo-fallback">{monogram}</span>
}

function PlayIcon() {
  return (
    <svg className="stream-row-watch-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 4.5v15l13-7.5-13-7.5Z" fill="currentColor" />
    </svg>
  )
}

// Missing metadata is rendered as a quiet dash, never a loud "Unknown"
// badge — absent information must read as visually LESS important than
// present information, and the fixed-width columns keep every row's layout
// identical regardless of what's missing.
const EMPTY_METADATA = '—'

// One selectable stream-GROUP row, reused across the country-grouped list
// and the collapsed candidate list — variant only changes density/emphasis,
// never the interaction model or the column layout.
//
// The whole row is ONE bordered/backgrounded card (.stream-row) so a
// top-pick's accent border wraps the favorite star too, not just the play
// button — the star lives in its own fixed-width column separated by a
// thin inner divider, not a separate floating box outside the card. The
// play button and the favorite button remain two independently focusable
// controls inside that one card (Right from the play button reaches the
// star; the star has its own onEnterPress) — only the visual container
// changed, not the interaction model.
//
// Quality selection deliberately isn't its own set of focusable pills —
// that turned every extra quality tier into another remote press just to
// reach Watch/Favorite. Left/Right while the row itself is focused cycles
// the selected variant in place (Enter always plays the currently selected
// one, which starts as the best available); Right falls through to normal
// spatial search (reaching the favorite star) once already at the lowest
// tier, same for Left at the highest. The quality column shows ‹ › cues
// while focused whenever more than one variant exists.
export function StreamRow({
  option,
  variant,
  primary,
  favoriteChannels,
  onToggleFavoriteChannel,
  onWatch,
  focusKey,
  onArrowUp,
}: StreamRowProps) {
  const [sourceIndex, setSourceIndex] = useState(0)
  const selected = option.sourceOptions[sourceIndex] ?? option.sourceOptions[0]
  const favorited = selected ? favoriteChannels.has(selected.channel.id) : false
  // Reflects whichever variant the user actually has selected right now
  // (they may have cycled Left/Right through quality tiers before pressing
  // Watch) rather than always the group's single best tier baked into
  // option.displayParts at build time — see Part W of the redesign task.
  const selectedDisplayParts = selected ? { ...option.displayParts, quality: selected.qualityLabel } : option.displayParts
  const hasVariants = option.sourceOptions.length > 1

  const { ref, focused } = useFocusable({
    focusKey,
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
      if (direction === 'up' && onArrowUp) {
        onArrowUp()
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

  const qualityLabel = selected?.qualityLabel ?? EMPTY_METADATA

  return (
    <div className={`stream-row stream-row-${variant} ${primary ? 'top-pick' : ''} ${focused ? 'focused' : ''}`}>
      <button
        ref={ref}
        className="stream-row-play"
        onClick={() => selected && onWatch(selected.channel, selected.source, selectedDisplayParts)}
      >
        <LogoTile logo={option.logo} displayName={option.displayName} />
        <span className="stream-row-name">{option.displayName}</span>
        {/* Consumer wording: "TV" / "Event" — never the IPTV-internal "PPV".
            The internal classification survives untouched on
            option.matchSource/sourceType for debug. Small outlined badge,
            not a filled status pill. */}
        <span className={`stream-row-badge stream-row-type ${option.sourceType}`}>{option.sourceType === 'event' ? 'EVENT' : 'TV'}</span>
        <span className={`stream-row-badge stream-row-quality-col ${selected?.qualityLabel == null ? 'unknown' : ''}`}>
          {hasVariants && <span className={`stream-row-quality-cue ${focused && sourceIndex > 0 ? 'active' : ''}`}>‹</span>}
          <span className="stream-row-quality-value">{qualityLabel}</span>
          {hasVariants && (
            <span className={`stream-row-quality-cue ${focused && sourceIndex < option.sourceOptions.length - 1 ? 'active' : ''}`}>›</span>
          )}
        </span>
        <span className="stream-row-watch">
          <PlayIcon /> Watch now
        </span>
      </button>
      <div className="stream-row-favorite-col">
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
    </div>
  )
}
