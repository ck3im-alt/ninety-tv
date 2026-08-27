import { useEffect, useMemo, useRef, useState } from 'react'
import { FocusContext, doesFocusableExist, getCurrentFocusKey, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useBackHandler, useFocusScrollIntoView } from '../../core/platform'
import { BACK_FOCUS_KEY, SCREEN_FOCUS_KEY } from './eventDetailsFocusKeys'
import { matchChannelsForEvent } from '../../data/sports/channelMatch'
import type { ChannelMatch, BroadcastStationInfo } from '../../data/sports/channelMatch'
import { buildEventStreamOptions, rankEventStreamOptions, partitionStreamOptions } from './buildEventStreamOptions'
import type { PartitionedStreamOptions, RankedEventStreamOption } from './buildEventStreamOptions'
import { FootballEventHeader, GenericEventHeader } from './EventHeader'
import { StreamList } from './StreamSections'
import { loadPreferences } from '../../data/preferences'
import { broadcastAvailabilityOf, isNegativeBroadcastAvailability } from '../../data/sports/broadcastAvailability'
import type { SportEvent } from '../../data/sports/types'
import type { EventPlaybackGroup } from './eventPlaybackGroup'
import type { Channel } from '../../data/channel'
import type { XtreamCredentialResolver } from '../../data/playlists/xtreamResolver'
import type { ChannelIdentityIndex } from '../../data/sports/channelIdentityIndex'
import './EventDetailsScreen.css'

interface Props {
  event: SportEvent
  channels: Channel[]
  // The identity of the CURRENT playlist generation (see
  // playlistDefinition.combinedGenerationId). This, not the `channels` array
  // reference, is what tells this screen the playlist genuinely changed.
  // Background refreshes now install a new generation every ~12 minutes, and
  // keying re-matching on array identity meant every one of them reset this
  // screen to "Finding the best streams…" and threw the viewer's focus back
  // to row 1 while they were reading row 5.
  playlistGenerationId: string | null
  xtream: XtreamCredentialResolver
  identityIndex: ChannelIdentityIndex | null
  // Same Set/setter App.tsx already owns for every other favorite star in
  // the app (see App.tsx's favoriteChannels/toggleInSet) — this screen
  // doesn't own or persist favorite state itself.
  favoriteChannels: ReadonlySet<string>
  // Takes every playlist channel behind one display row (see StreamRow) —
  // a logical row can span several of them now that Ninety's own channel
  // identity, not playlist text, decides what counts as one broadcaster.
  onToggleFavoriteChannels: (channelIds: string[]) => void
  // Playback receives the whole logical stream group — every quality
  // variant the row collapsed, best-first — so the player can offer them as
  // a quality menu and fail over across them. See eventPlaybackGroup.ts.
  onWatch: (group: EventPlaybackGroup) => void
  onBack: () => void
  onBrowseChannels: () => void
}

type MatchState =
  | { status: 'loading' }
  | { status: 'ready'; matches: ChannelMatch[]; apiStations: BroadcastStationInfo[] }
  // Nothing matched — but for two different reasons the user should see
  // different text for: either no broadcaster data existed anywhere to
  // check against (apiStations empty), or ninety-api told us exactly who's
  // airing it and none of those channels are in this playlist (apiStations
  // non-empty) — very different situations to leave the user guessing
  // between.
  | { status: 'not-found'; apiStations: BroadcastStationInfo[] }

export function EventDetailsScreen({
  event,
  channels,
  playlistGenerationId,
  xtream,
  identityIndex,
  favoriteChannels,
  onToggleFavoriteChannels,
  onWatch,
  onBack,
  onBrowseChannels,
}: Props) {
  const [state, setState] = useState<MatchState>({ status: 'loading' })

  // Read by the matching effect without being dependencies of it. `channels`
  // gets a new array reference on every playlist generation and `xtream` a
  // new resolver whenever the library's playlist list changes; neither is a
  // reason on its own to re-run matching, and depending on them is exactly
  // what made this screen flash on every background refresh. The generation
  // id below is the honest signal for "the playlist really changed".
  const channelsRef = useRef(channels)
  channelsRef.current = channels
  const xtreamRef = useRef(xtream)
  xtreamRef.current = xtream
  // Which event this screen last STARTED matching for. A change means a
  // fresh match (show the loading state); an unchanged value with a changed
  // generation/identity index means a REVALIDATION (keep what is on screen).
  const matchedEventIdRef = useRef<string | null>(null)

  useEffect(() => {
    // ninety-api and EPG matching both need "home vs away" text to match
    // against, so they're a no-op for single-entrant events (F1/golf/etc).
    // But matchChannelsForEvent also tries the static broadcaster map (see
    // channelMatch.ts), which needs no team names — it's a season-long
    // "this league airs on this channel in this country" fact — so it's
    // still worth calling matchChannelsForEvent for every event, not just
    // team fixtures.
    //
    // Deliberately keyed on event.id, NOT the whole `event` object — App.tsx
    // now passes the freshest known version of the event (see its own
    // liveSelectedEvent), which gets a NEW object reference roughly every
    // 60s as ninety-api's live-score poller updates status/score (see the
    // live-scores feature). None of that affects which channels air this
    // fixture, only whether it's currently live — re-running this (network-
    // fallback-enabled) match and flashing back to "Finding the best
    // streams…" on every background score tick would be exactly the
    // reload-during-silent-refresh this feature explicitly must not cause.
    //
    // STALE-WHILE-REVALIDATE FOR PLAYLIST GENERATIONS. A new generation is a
    // real reason to re-match — it is how a PPV stream added by the provider
    // twenty minutes into the build-up becomes discoverable without the
    // viewer backing out and re-entering. But it is NOT a reason to blank
    // the screen: the rows already shown are still valid until the new match
    // says otherwise, so the loading state is entered only for a genuinely
    // new event. A revalidation that FAILS (network, abort) keeps whatever
    // is on screen rather than replacing real streams with an error.
    const isFreshEvent = matchedEventIdRef.current !== event.id
    matchedEventIdRef.current = event.id

    let cancelled = false
    const controller = new AbortController()
    if (isFreshEvent) setState({ status: 'loading' })
    matchChannelsForEvent(event, channelsRef.current, xtreamRef.current, identityIndex, {
      allowNetworkFallback: true,
      signal: controller.signal,
    })
      .then(({ matches, apiStations }) => {
        if (cancelled) return
        setState(matches.length > 0 ? { status: 'ready', matches, apiStations } : { status: 'not-found', apiStations })
      })
      .catch(() => {
        if (cancelled) return
        // Keyed on what is ON SCREEN, not on why this run started. Real,
        // playable rows always beat an empty state produced by one failed
        // poll — but a run that fails while the screen is STILL on the
        // loading skeleton (identityIndex or a new generation landing
        // moments after mount, then the provider going down) has to resolve
        // it, or "Finding the best streams…" stays up forever with nothing
        // left to finish it.
        setState((prev) => (prev.status === 'ready' ? prev : { status: 'not-found', apiStations: [] }))
      })
    return () => {
      cancelled = true
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id, playlistGenerationId, identityIndex])

  useBackHandler(() => {
    onBack()
    return true
  })

  const isTeamFixture = Boolean(event.homeTeam && event.awayTeam)

  // A cheap synchronous localStorage read, not worth memoizing on its own —
  // used both by ranking below and by StreamFilterArea's country-section
  // headers (see StreamSections.tsx), so it's read once per render here
  // rather than each consumer re-reading it separately.
  const { favoriteCountries } = loadPreferences()

  // Deliberately keyed on `state`/event identity only, NOT favoriteChannels
  // — favorite status still feeds the ranking score (buildEventStreamOptions),
  // but re-deriving this on every favorite toggle would reshuffle the whole
  // list while the user is mid-navigation. StreamRow itself reads
  // favoriteChannels live for the star's fill state, so toggling still
  // updates immediately; it just doesn't reorder anything.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const partitioned = useMemo(() => {
    if (state.status !== 'ready') return null
    const { streamType } = loadPreferences()
    const options = buildEventStreamOptions(state.matches, favoriteChannels, {
      homeTeam: event.homeTeam,
      awayTeam: event.awayTeam,
      // Non-team events (F1 sessions, etc) have no home/away — event.title
      // is the canonical identity for those (see ppvDisplayName.ts's
      // buildEventStreamDisplayParts, Part O of the redesign task).
      eventTitle: event.title,
      dateTimeUtc: event.dateTimeUtc,
    })
    return partitionStreamOptions(rankEventStreamOptions(options, { favoriteCountries, streamType }))
  }, [state, event.homeTeam, event.awayTeam, event.title, event.dateTimeUtc])

  const topPickFocusKey =
    partitioned && partitioned.recommended.length > 0
      ? partitioned.recommended[0].key
      : partitioned && partitioned.trusted.length > 0
        ? partitioned.trusted[0].key
        : undefined

  // This screen is lazy-loaded (see App.tsx's SCREEN_FOCUS_KEYS) — the root
  // container is targeted by its own key rather than ROOT_FOCUS_KEY so
  // initial focus resolves correctly even if `screen` changes to
  // 'event-details' before this chunk finishes loading (see App.tsx's
  // initial-focus effect for the full explanation). Back is the only
  // resolvable target while matches are still loading (state.status starts
  // 'loading' on every mount, so this is always correct at the moment the
  // container first registers); once ready, this points at the #1
  // recommended stream instead.
  const { ref, focusKey } = useFocusable({
    focusKey: SCREEN_FOCUS_KEY,
    trackChildren: true,
    preferredChildFocusKey: topPickFocusKey ?? BACK_FOCUS_KEY,
  })

  // Explicitly advances focus onto the #1 recommendation the moment
  // matches finish resolving — changing preferredChildFocusKey above only
  // affects FUTURE focus resolutions (e.g. if this container gets
  // setFocus'd again later), it does not retroactively move focus that's
  // already sitting on Back. Keyed on the status transition alone (not on
  // `partitioned`, which is a fresh object every render) so this fires
  // exactly once per loading->ready transition, not on every render while
  // already ready — it must never repeatedly yank focus back to the top
  // pick while the user is actively browsing other streams.
  //
  // The `currentFocusKey` guard covers the sub-frame race the hardening
  // audit called out: while loading, Back is the only focusable, so that is
  // where focus legitimately is when matches land — but a user press
  // arriving in the same frame (or a future re-match triggered by something
  // other than a fresh mount) can leave focus on a stream row that still
  // exists. Claiming focus in that case would yank the viewer off the row
  // they were on. Claim it only from the loading-state fallback, or from
  // nothing at all.
  useEffect(() => {
    if (state.status !== 'ready' || !topPickFocusKey) return
    const current = getCurrentFocusKey()
    const holdsRealFocus = current != null && current !== BACK_FOCUS_KEY && current !== SCREEN_FOCUS_KEY && doesFocusableExist(current)
    if (holdsRealFocus) return
    void setFocus(topPickFocusKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status])

  // DETERMINISTIC FOCUS RECOVERY AFTER A REVALIDATION.
  //
  // Stream rows are keyed by their group key (see groupChannelMatches), which
  // is derived from channel identity rather than position — so a new playlist
  // generation that merely ADDS a PPV stream leaves every existing row's
  // focus key intact and nothing here fires. The case this handles is the
  // other one: the provider removed the stream the viewer was standing on, so
  // its focusable is gone and focus would be left pointing at a key that no
  // longer resolves, which reads on a TV as "the remote stopped working".
  //
  // Only ever moves focus when the CURRENT key genuinely no longer exists —
  // never on a routine revalidation, never on the first ready transition
  // (the effect above owns that), and never while focus is legitimately on
  // Back or the container.
  useEffect(() => {
    if (state.status !== 'ready' || !topPickFocusKey) return
    const current = getCurrentFocusKey()
    if (current == null || current === BACK_FOCUS_KEY || current === SCREEN_FOCUS_KEY) return
    if (doesFocusableExist(current)) return
    void setFocus(topPickFocusKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partitioned])

  return (
    <FocusContext.Provider value={focusKey}>
      <main ref={ref} className="event-details">
        <div className="event-details-topbar">
          <BackButton onBack={onBack} />
          <span className="event-details-logo">NINETY</span>
        </div>

        {isTeamFixture ? <FootballEventHeader event={event} /> : <GenericEventHeader event={event} />}

        <section className="stream-area">
          {state.status === 'loading' && <StreamAreaLoading />}
          {state.status === 'not-found' && (
            <NoMatchState event={event} apiStations={state.apiStations} onBrowseChannels={onBrowseChannels} />
          )}
          {state.status === 'ready' && partitioned && (
            <StreamList
              partitioned={partitioned}
              favoriteCountries={favoriteCountries}
              topPickKey={topPickFocusKey}
              favoriteChannels={favoriteChannels}
              onToggleFavoriteChannels={onToggleFavoriteChannels}
              onWatch={onWatch}
            />
          )}
        </section>

        {import.meta.env.DEV && state.status === 'ready' && (state.apiStations.length > 0 || partitioned) && (
          <DevBroadcastDebug apiStations={state.apiStations} partitioned={partitioned} />
        )}
      </main>
    </FocusContext.Provider>
  )
}

// Its own component purely so its useFocusable() runs INSIDE the screen's
// FocusContext.Provider and it therefore registers as a CHILD of
// `event-details-screen`.
//
// It used to be a bare useFocusable() call in EventDetailsScreen's own body.
// Hooks run before JSX, so the ambient FocusContext there is still App's —
// Back was registering as a SIBLING of the screen container, not a child of
// it. That quietly broke the container's `preferredChildFocusKey` fallback:
// while matches load, the screen has no other focusable children, so
// setFocus('event-details-screen') found no children at all and resolved to
// the container itself — an element with no onEnterPress. Focus was
// effectively nowhere, and reaching the on-screen Back button depended on a
// geometric search across the whole screen root. (The hardware Back key was
// always fine — that goes through backHandler, not focus.)
function BackButton({ onBack }: { onBack: () => void }) {
  const { ref, focused } = useFocusable({ focusKey: BACK_FOCUS_KEY, onEnterPress: onBack })
  useFocusScrollIntoView(ref, focused)
  return (
    <button ref={ref} className={`event-details-back ${focused ? 'focused' : ''}`} onClick={onBack}>
      ‹ Back
    </button>
  )
}

// Keeps the header rendered immediately and shows a restrained status line
// plus lightweight skeleton rows instead of flashing/blocking — matching
// resolution (ninety-api broadcasts, ChannelIdentityIndex, EPG fallback)
// can take a moment, and Back must stay operational throughout (see the
// `backFocused` handling above).
function StreamAreaLoading() {
  return (
    <div className="stream-area-loading">
      <p className="stream-area-loading-text">Finding the best streams…</p>
      <div className="stream-row-skeleton" />
      <div className="stream-row-skeleton" />
      <div className="stream-row-skeleton" />
    </div>
  )
}

function NoMatchState({
  event,
  apiStations,
  onBrowseChannels,
}: {
  event: SportEvent
  apiStations: BroadcastStationInfo[]
  onBrowseChannels: () => void
}) {
  // The one place the objective broadcast verdict is worth saying out loud.
  // "No TV channel has been reported for this event YET" implies data we are
  // still waiting on; when ninety-api has actually concluded that nobody is
  // expected to televise the fixture, that sentence is simply wrong, and the
  // honest version stops the viewer re-checking a screen that will never
  // change. Only ever shown in the already-empty state, and only for a
  // verdict the backend genuinely stated — UNKNOWN (which includes every
  // event from a backend predating the field) keeps the original wording.
  const notExpected = isNegativeBroadcastAvailability(broadcastAvailabilityOf(event))
  return (
    <div className="stream-area-empty">
      {apiStations.length > 0 ? (
        <>
          <p>This event is reported on:</p>
          <ul className="stream-area-station-list">
            {apiStations.map((station, i) => (
              <li key={i}>
                {station.name}
                {station.country && <span className="stream-area-station-country"> — {station.country}</span>}
              </li>
            ))}
          </ul>
          <p>None of these channels were found in your connected playlist.</p>
        </>
      ) : notExpected ? (
        <p>No TV coverage is expected for this event.</p>
      ) : (
        <p>No TV channel has been reported for this event yet.</p>
      )}
      <BrowseManuallyButton onClick={onBrowseChannels} />
    </div>
  )
}

function BrowseManuallyButton({ onClick }: { onClick: () => void }) {
  const { ref, focused } = useFocusable({ onEnterPress: onClick })
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [focused, ref])
  return (
    <button ref={ref} className={`stream-area-browse-manually ${focused ? 'focused' : ''}`} onClick={onClick}>
      Think we got it wrong? Check your channels manually
    </button>
  )
}

// Readable labels for ChannelMatch.source, so the debug list below can show
// "was this a real resolved broadcaster, or a guess against a one-off PPV
// playlist entry" directly — added after a real case where every visible
// row was PPV and it wasn't obvious without a live API call to check.
const MATCH_SOURCE_LABELS: Record<ChannelMatch['source'], string> = {
  ninety: 'ninety broadcast',
  broadcasterMap: 'broadcaster map',
  ppvName: 'PPV playlist entry',
  epg: 'EPG guess',
}

// Dev-only diagnostic (see the redesign task: production must never show
// this) — kept available for development rather than deleted outright,
// same DEV-gating precedent as App.tsx's admin panel entry point.
//
// Phase 2B (event -> EPG -> stream diagnostics, see the task spec's "event
// -> broadcast evidence debug view"): the backend side of this ("why did
// this EPG programme resolve/not resolve") already has its own tool --
// ninety-api's GET /internal/resolution/events/:id/explain. It can never
// see WHY a resolved broadcast did or didn't turn into a playable stream in
// THIS user's own playlist, because that matching is deliberately
// client-side/local (the playlist itself is private, never uploaded — see
// channelIdentityResolver.ts). This panel is that other half: for each
// broadcast ninety-api reported, whether it resolved to a playlist channel
// and why not when it didn't (identityClassification/
// ambiguousPlaylistChannelNames already carry that from channelMatch.ts),
// plus the final ranked tier (top 3 / rest / candidates) with the exact
// signals rankEventStreamOptions used — country match, quality, confidence,
// favorite — so "why did Ninety choose this channel" and "why did Ninety
// reject that channel" are both answerable without reading source.
function DevBroadcastDebug({
  apiStations,
  partitioned,
}: {
  apiStations: BroadcastStationInfo[]
  partitioned: PartitionedStreamOptions | null
}) {
  const { favoriteCountries } = loadPreferences()
  const favoriteCountrySet = new Set(favoriteCountries)

  function renderOption(option: RankedEventStreamOption, tier: string) {
    const preferredMarket = option.countryName != null && favoriteCountrySet.has(option.countryName)
    // The raw provider names behind this group — the canonicalized display
    // name deliberately hides them (task section 16: keep the raw M3U
    // titles reachable for diagnostics without exposing them in normal
    // rows).
    const candidates = option.qualityVariants.flatMap((variant) => variant.candidates)
    const rawNames = [...new Set(candidates.flatMap((c) => [c.source.originalName ?? '', c.channel.name]))].filter(Boolean)
    return (
      <li key={option.key}>
        [{tier}] {option.displayName}
        {' · score '}
        {option.rankingScore}
        {' · '}
        {option.sourceType.toUpperCase()}
        {option.countryName && ` · ${option.countryName}${preferredMarket ? ' (preferred)' : ''}`}
        {' · '}
        {option.matchConfidence}
        {' · '}
        {MATCH_SOURCE_LABELS[option.matchSource]}
        {option.logicalChannelId && ` · identity ${option.logicalChannelId}`}
        {option.channelIds.length > 1 && ` · ${option.channelIds.length} playlist channels merged`}
        {' · quality '}
        {option.bestQualityTier}
        {' · variants '}
        {/* "UHD×2" = one user-facing quality with two playback candidates
            behind it (failover mirrors, never separate rows). */}
        {option.qualityVariants.map((v) => `${v.qualityLabel ?? '—'}${v.candidates.length > 1 ? `×${v.candidates.length}` : ''}`).join('/')}
        {option.isFavorite && ' · ★ favorite'}
        {' · raw: '}
        {rawNames.join(' / ')}
      </li>
    )
  }

  return (
    <section className="event-details-debug">
      <h2 className="event-details-debug-title">Debug: ninety-api reports</h2>
      <ul className="event-details-debug-list">
        {apiStations.map((station, i) => (
          <li key={i}>
            {station.name}
            {station.country && ` (${station.country})`}
            {station.identityClassification && ` — playlist identity: ${station.identityClassification}`}
            {station.ambiguousPlaylistChannelNames && station.ambiguousPlaylistChannelNames.length > 0 && (
              <> (ambiguous against: {station.ambiguousPlaylistChannelNames.join(', ')})</>
            )}
          </li>
        ))}
      </ul>
      {partitioned && (
        <>
          <h2 className="event-details-debug-title">Debug: final ranked stream groups</h2>
          <ul className="event-details-debug-list">
            {partitioned.trusted.map((o) => renderOption(o, o.recommended ? 'recommended' : 'all'))}
            {partitioned.candidates.map((o) => renderOption(o, 'candidate'))}
          </ul>
        </>
      )}
    </section>
  )
}
