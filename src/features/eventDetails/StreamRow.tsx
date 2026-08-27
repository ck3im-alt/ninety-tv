import { useEffect } from 'react'
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { countryNameToCode, flagSrc } from '../../data/countryCodes'
import { toEventPlaybackGroup } from './eventPlaybackGroup'
import type { RankedEventStreamOption } from './buildEventStreamOptions'
import type { EventPlaybackGroup } from './eventPlaybackGroup'

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
  // Takes the row's WHOLE channel set (option.channelIds), not one id: one
  // logical row can span several playlist Channel objects (see
  // groupChannelMatches.ts), and a star that only ever toggled one of them
  // would leave the same row reading as favorited or not depending on which
  // playlist spelling happened to be first. See App.tsx's
  // toggleFavoriteChannels for the all-or-nothing semantics.
  onToggleFavoriteChannels: (channelIds: string[]) => void
  // Playback receives the entire logical stream group — every quality
  // variant this row collapsed, best-first — not just the one source the
  // row happens to display. See eventPlaybackGroup.ts.
  onWatch: (group: EventPlaybackGroup) => void
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
  // Whether this row has to say which country it comes from.
  //
  // Country is normally the SECTION HEADING above a run of rows (see
  // StreamSections.tsx), which is both quieter and more scannable than
  // repeating it per row. That works for the viewer's preferred markets,
  // which each get their own headed section — but everything else is
  // deliberately collapsed into one flat "Other countries" bucket, and in
  // there a row's origin was simply unstated. Ninety will legitimately
  // recommend a Danish feed to a Norwegian viewer when it is the best
  // source available; the viewer has to be able to see that at a glance
  // rather than discover it when the commentary starts.
  //
  // So: on, exactly for rows in that flat bucket. Preferred-country rows
  // already sit under their own flag and name, and a second copy on every
  // row would be noise.
  showCountry?: boolean
}

// The row's origin, at the smallest size that still reads across a room:
// the flag carries the recognition, the ISO code disambiguates it. The full
// name goes in the title/aria-label rather than on screen — "United
// Kingdom" would be wider than the quality and type tags combined, and the
// metadata columns have to stay narrower than the stream name they sit
// beside.
function CountryTag({ countryName, countryCode }: { countryName: string | null; countryCode: string | null }) {
  const code = (countryCode ?? (countryName ? countryNameToCode(countryName) : null))?.toUpperCase() ?? null
  // Nothing at all rather than a "?" placeholder: an unknown origin is
  // genuinely absent information, and the ranking already treats it as
  // such (see countryBucketRank).
  if (!code && !countryName) return null
  const flag = code ? flagSrc(code) : null
  return (
    <span className="stream-row-badge stream-row-country" title={countryName ?? code ?? undefined}>
      {flag && <img className="stream-row-country-flag" src={flag} alt="" />}
      <span className="stream-row-country-code">{code ?? countryName}</span>
    </span>
  )
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
// present information. The metadata GROUP is fixed-width (see
// .stream-row-meta), so a row with nothing to say still lines its Watch
// column up with every other row's.
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
// Quality is NOT selectable here. A row is one logical broadcaster / event
// feed, and quality is a characteristic of playing it, not a separate
// viewing choice: the row always shows (and Enter always starts) the best
// available variant, and every other variant travels with it into the
// player, where the user can change quality without leaving playback. The
// old Left/Right variant cycling on this row is deliberately gone — it made
// the user answer a question ("8K or 720p?") before they'd even seen the
// stream, and Left/Right now falls through to ordinary spatial navigation.
export function StreamRow({
  option,
  variant,
  primary,
  favoriteChannels,
  onToggleFavoriteChannels,
  onWatch,
  focusKey,
  onArrowUp,
  showCountry,
}: StreamRowProps) {
  // Always the best available quality (qualityVariants is sorted best-tier
  // first — see groupSourcesByTier), never a user-selected index. Extra
  // same-tier candidates behind it are a playback detail the row
  // deliberately says nothing about.
  const best = option.qualityVariants[0]
  // One favorite state for the whole logical row: filled when ANY of its
  // playlist channels is favorited, matching option.isFavorite's own
  // any-of semantics used for ranking.
  const favorited = option.channelIds.some((id) => favoriteChannels.has(id))

  const watch = () => {
    if (best) onWatch(toEventPlaybackGroup(option))
  }

  const { ref, focused } = useFocusable({
    focusKey,
    onEnterPress: watch,
    onArrowPress: (direction) => {
      if (direction === 'up' && onArrowUp) {
        onArrowUp()
        return false
      }
      return true
    },
  })
  const { ref: starRef, focused: starFocused } = useFocusable({
    onEnterPress: () => onToggleFavoriteChannels(option.channelIds),
  })

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [focused, ref])
  useEffect(() => {
    if (starFocused) starRef.current?.scrollIntoView({ block: 'nearest' })
  }, [starFocused, starRef])

  const qualityLabel = best?.qualityLabel ?? EMPTY_METADATA

  return (
    <div className={`stream-row stream-row-${variant} ${primary ? 'top-pick' : ''} ${focused ? 'focused' : ''}`}>
      <button ref={ref} className="stream-row-play" onClick={watch}>
        <LogoTile logo={option.logo} displayName={option.displayName} />
        <span className="stream-row-name">{option.displayName}</span>
        {/* ONE right-aligned metadata group rather than three independently
            fixed-width columns. Each tag is now sized by its own content —
            "8K" must not occupy the width of "FHD" — while the GROUP keeps a
            fixed width, so the Watch column still lines up perfectly down
            the list. */}
        <span className="stream-row-meta">
          {showCountry && <CountryTag countryName={option.countryName} countryCode={option.countryCode} />}
          {/* Consumer wording: "TV" / "Event" — never the IPTV-internal
              "PPV". The internal classification survives untouched on
              option.matchSource/sourceType for debug. */}
          <span className={`stream-row-badge stream-row-type ${option.sourceType}`}>{option.sourceType === 'event' ? 'EVENT' : 'TV'}</span>
          {/* `high` for UHD/4K/8K only (see rankStreamQuality's tiers) —
              one small step up in emphasis for the tiers a viewer actively
              looks for, NOT a green/amber/red ladder down the list. */}
          <span
            className={`stream-row-badge stream-row-quality-col ${best?.qualityLabel == null ? 'unknown' : best.qualityTier >= 4 ? 'high' : ''}`}
          >
            {qualityLabel}
          </span>
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
            onToggleFavoriteChannels(option.channelIds)
          }}
          aria-label={favorited ? 'Remove from favorites' : 'Add to favorites'}
        >
          {favorited ? '★' : '☆'}
        </button>
      </div>
    </div>
  )
}
