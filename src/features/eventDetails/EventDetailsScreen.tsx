import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FocusContext, doesFocusableExist, getCurrentFocusKey, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useBackHandler, useFocusScrollIntoView } from '../../core/platform'
import { BACK_FOCUS_KEY, BROWSE_CHANNELS_FOCUS_KEY, REFRESH_PLAYLIST_FOCUS_KEY, SCREEN_FOCUS_KEY } from './eventDetailsFocusKeys'
import { NoStreamState, type PlaylistRefresh } from './NoStreamState'
import { matchChannelsForEvent } from '../../data/sports/channelMatch'
import type { ChannelMatch, BroadcastStationInfo } from '../../data/sports/channelMatch'
import { buildEventStreamOptions, rankEventStreamOptions, partitionStreamOptions } from './buildEventStreamOptions'
import type { PartitionedStreamOptions, RankedEventStreamOption } from './buildEventStreamOptions'
import { FootballEventHeader, GenericEventHeader } from './EventHeader'
import { StreamList } from './StreamSections'
import { loadPreferences } from '../../data/preferences'
import { broadcastAvailabilityOf } from '../../data/sports/broadcastAvailability'
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
  // The EXISTING playlist library's resync, threaded down from App — see
  // NoStreamState's PlaylistRefresh. Optional so a caller with no playlists
  // (and every existing test) simply gets an empty state with one action.
  playlistRefresh?: PlaylistRefresh
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
  playlistRefresh,
}: Props) {
  const [state, setState] = useState<MatchState>({ status: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  // Guards a SECOND activation while the first is still running — checked
  // synchronously, because two Enter presses in one frame both read the same
  // stale `refreshing` state and would both start a sync.
  const refreshingRef = useRef(false)
  // A refresh outlives a fast Back, so the completion handler has to know
  // whether there is still a screen to update.
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

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

  // REFRESHING GOES THROUGH THE PLAYLIST LIBRARY, and nothing else. It is
  // the same coordinator Settings' Resync uses (see usePlaylistLibrary's
  // resyncPlaylist/resyncAll), which already deduplicates against a
  // background sync that happens to be in flight and already forces a
  // manual result to install even during playback.
  //
  // Nothing here re-runs matching by hand. Installing a new generation
  // changes `playlistGenerationId`, and the matching effect above is keyed
  // on it — so the re-evaluation happens through exactly the same path a
  // background refresh takes, including its stale-while-revalidate
  // behaviour. That is deliberate: bypassing it with a bespoke re-match
  // would step around the generation-isolation this screen is tested for.
  //
  // The viewer stays on Event Details throughout. A failed refresh is not
  // surfaced as an error state — the empty state they are already looking at
  // IS the outcome, and replacing it with a second failure message would
  // just be the same information twice.
  const refreshPlaylists = useCallback(() => {
    if (!playlistRefresh || refreshingRef.current) return
    refreshingRef.current = true
    setRefreshing(true)
    void playlistRefresh
      .refresh()
      .catch(() => {})
      .finally(() => {
        refreshingRef.current = false
        if (aliveRef.current) setRefreshing(false)
      })
  }, [playlistRefresh])

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

  // WHERE FOCUS LANDS, which is not the same question as which row wears the
  // top-pick styling.
  //
  // Usually they are the same row. They part company when every match this
  // playlist produced is a loose candidate (see streamConfidence.ts — a
  // broadcaster-map word overlap or a weak EPG guess): `trusted` is then
  // empty, so there is no top pick to call out, and the screen used to fall
  // all the way back to Back — with a full, open list of streams sitting
  // right below it. That is the reported bug: entering a match focused the
  // Back button instead of the first stream.
  //
  // The candidate fallback is exactly as wide as the case that needs it, and
  // the two conditions are the same one by construction: `topPickFocusKey`
  // is defined whenever `trusted` is non-empty, and CandidateStreamList
  // opens by default on precisely the opposite condition (`defaultOpen =
  // trusted.length === 0` — see StreamSections). So this only ever names a
  // candidate row while those rows are actually rendered.
  //
  // What it deliberately does NOT do is widen `topPickKey` below: a fuzzy
  // guess may be the best thing on offer and therefore worth focusing, but
  // labelling it "top pick" would make an editorial claim the match
  // confidence does not support.
  const initialFocusKey =
    topPickFocusKey ?? (partitioned && partitioned.candidates.length > 0 ? partitioned.candidates[0].key : undefined)

  // WHERE FOCUS LANDS WHEN THERE ARE NO STREAMS AT ALL. Previously nowhere:
  // the empty state's one button had no focus key and the container fell
  // back to Back, so a viewer arriving at a fixture with nothing to play was
  // pointed at the exit rather than at the two things that might change
  // that. Refresh when it is offered (see NoStreamState), otherwise the
  // manual-browse action, which is always rendered.
  const emptyStateFocusKey =
    state.status !== 'not-found'
      ? undefined
      : playlistRefresh && playlistRefresh.resyncableCount > 0
        ? REFRESH_PLAYLIST_FOCUS_KEY
        : BROWSE_CHANNELS_FOCUS_KEY

  // This screen is lazy-loaded (see App.tsx's SCREEN_FOCUS_KEYS) — the root
  // container is targeted by its own key rather than ROOT_FOCUS_KEY so
  // initial focus resolves correctly even if `screen` changes to
  // 'event-details' before this chunk finishes loading (see App.tsx's
  // initial-focus effect for the full explanation). Back is the only
  // resolvable target while matches are still loading (state.status starts
  // 'loading' on every mount, so this is always correct at the moment the
  // container first registers); once ready, this points at the first stream
  // row on screen instead (see initialFocusKey).
  const { ref, focusKey } = useFocusable({
    focusKey: SCREEN_FOCUS_KEY,
    trackChildren: true,
    preferredChildFocusKey: initialFocusKey ?? emptyStateFocusKey ?? BACK_FOCUS_KEY,
  })

  // WHERE FOCUS GOES ONCE MATCHING FINISHES, whichever way it finishes: the
  // first stream row when there are streams, and the empty state's own
  // action when there are none.
  //
  // Both halves are needed, and preferredChildFocusKey above cannot do
  // either on its own — it only affects FUTURE focus resolutions (e.g. if
  // this container gets setFocus'd again later) and does not retroactively
  // move focus that is already sitting on Back. In the real app it always
  // is: App focuses this screen the moment `screen` changes, which is while
  // status is still 'loading', when Back is the only resolvable target.
  //
  // Keyed on the status transition alone (not on `partitioned`, which is a
  // fresh object every render) so this fires exactly once per
  // loading->resolved transition, not on every render while already
  // resolved — it must never repeatedly yank focus back to the top pick
  // while the user is actively browsing other streams.
  //
  // The `currentFocusKey` guard covers the sub-frame race the hardening
  // audit called out: while loading, Back is the only focusable, so that is
  // where focus legitimately is when matches land — but a user press
  // arriving in the same frame (or a future re-match triggered by something
  // other than a fresh mount) can leave focus on a stream row that still
  // exists. Claiming focus in that case would yank the viewer off the row
  // they were on. Claim it only from the loading-state fallback, or from
  // nothing at all.
  const resolvedFocusKey = initialFocusKey ?? emptyStateFocusKey
  useEffect(() => {
    if (state.status === 'loading' || !resolvedFocusKey) return
    const current = getCurrentFocusKey()
    const holdsRealFocus = current != null && current !== BACK_FOCUS_KEY && current !== SCREEN_FOCUS_KEY && doesFocusableExist(current)
    if (holdsRealFocus) return
    void setFocus(resolvedFocusKey)
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
    if (state.status !== 'ready' || !initialFocusKey) return
    const current = getCurrentFocusKey()
    if (current == null || current === BACK_FOCUS_KEY || current === SCREEN_FOCUS_KEY) return
    if (doesFocusableExist(current)) return
    void setFocus(initialFocusKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partitioned])

  return (
    <FocusContext.Provider value={focusKey}>
      <main ref={ref} className="event-details">
        {/* Deliberately NOT wrapped in a header row of its own. It is
            absolutely positioned over the hero (see .event-details-back), so
            it costs no layout height and the competition artwork inside
            EventHeader starts at the very top of the canvas instead of below
            a strip of exposed page background. */}
        <BackButton onBack={onBack} />

        {isTeamFixture ? <FootballEventHeader event={event} /> : <GenericEventHeader event={event} />}

        <section className="stream-area">
          {state.status === 'loading' && <StreamAreaLoading />}
          {state.status === 'not-found' && (
            <NoStreamState
              apiStations={state.apiStations}
              availability={broadcastAvailabilityOf(event)}
              availabilityReason={event.broadcastAvailabilityReason}
              playlistRefresh={playlistRefresh}
              refreshing={refreshing}
              onRefreshPlaylists={refreshPlaylists}
              onBrowseChannels={onBrowseChannels}
            />
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

// The screen's only chrome — this screen renders no TopNav and no wordmark
// (see App.tsx's TopNav condition); Back is overlaid on the hero artwork
// rather than sitting in a bar above it.
//
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
