import { useEffect, useMemo, useState } from 'react'
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useBackHandler } from '../../core/platform'
import { matchChannelsForEvent } from '../../data/sports/channelMatch'
import type { ChannelMatch, BroadcastStationInfo } from '../../data/sports/channelMatch'
import { buildEventStreamOptions, rankEventStreamOptions, partitionStreamOptions } from './buildEventStreamOptions'
import type { EventStreamOption } from './buildEventStreamOptions'
import { FootballEventHeader, GenericEventHeader } from './EventHeader'
import { StreamRecommendations, StreamList, CandidateStreamList } from './StreamSections'
import { loadPreferences } from '../../data/preferences'
import type { SportEvent } from '../../data/sports/types'
import type { Channel, ChannelSource } from '../../data/channel'
import type { XtreamCredentials } from '../../data/xtream/types'
import type { ChannelIdentityIndex } from '../../data/sports/channelIdentityIndex'
import './EventDetailsScreen.css'

interface Props {
  event: SportEvent
  channels: Channel[]
  xtreamCreds: XtreamCredentials | null
  identityIndex: ChannelIdentityIndex | null
  // Same Set/setter App.tsx already owns for every other favorite star in
  // the app (see App.tsx's favoriteChannels/toggleInSet) — this screen
  // doesn't own or persist favorite state itself.
  favoriteChannels: ReadonlySet<string>
  onToggleFavoriteChannel: (channelId: string) => void
  onWatch: (channel: Channel, source: ChannelSource) => void
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
  xtreamCreds,
  identityIndex,
  favoriteChannels,
  onToggleFavoriteChannel,
  onWatch,
  onBack,
  onBrowseChannels,
}: Props) {
  const [state, setState] = useState<MatchState>({ status: 'loading' })

  useEffect(() => {
    // ninety-api and EPG matching both need "home vs away" text to match
    // against, so they're a no-op for single-entrant events (F1/golf/etc).
    // But matchChannelsForEvent also tries the static broadcaster map (see
    // channelMatch.ts), which needs no team names — it's a season-long
    // "this league airs on this channel in this country" fact — so it's
    // still worth calling matchChannelsForEvent for every event, not just
    // team fixtures.
    let cancelled = false
    const controller = new AbortController()
    setState({ status: 'loading' })
    matchChannelsForEvent(event, channels, xtreamCreds, identityIndex, { allowNetworkFallback: true, signal: controller.signal })
      .then(({ matches, apiStations }) => {
        if (cancelled) return
        setState(matches.length > 0 ? { status: 'ready', matches, apiStations } : { status: 'not-found', apiStations })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'not-found', apiStations: [] })
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [event, channels, xtreamCreds, identityIndex])

  useBackHandler(() => {
    onBack()
    return true
  })

  // Back is the only usable target while matches are still resolving (or
  // when nothing matched at all) — once real streams exist, the #1
  // recommendation takes over as the initial focus target instead (see
  // StreamSections.tsx's StreamRecommendations, and StreamRow's forceFocus
  // comment). Never steals focus back afterwards: this only ever
  // transitions true -> false for a given screen instance.
  const { ref: backRef, focused: backFocused } = useFocusable({ onEnterPress: onBack, forceFocus: state.status !== 'ready' })
  const isTeamFixture = Boolean(event.homeTeam && event.awayTeam)

  // Deliberately keyed on `state`/event identity only, NOT favoriteChannels
  // — favorite status still feeds the Top-3 tie-break (buildEventStreamOptions),
  // but re-deriving this on every favorite toggle would reshuffle the whole
  // list while the user is mid-navigation. StreamRow itself reads
  // favoriteChannels live for the star's fill state, so toggling still
  // updates immediately; it just doesn't reorder anything.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const partitioned = useMemo(() => {
    if (state.status !== 'ready') return null
    const { favoriteCountries } = loadPreferences()
    const options = buildEventStreamOptions(state.matches, favoriteChannels, {
      homeTeam: event.homeTeam,
      awayTeam: event.awayTeam,
    })
    return partitionStreamOptions(rankEventStreamOptions(options, favoriteCountries))
  }, [state, event.homeTeam, event.awayTeam])

  return (
    <main className="event-details">
      <button ref={backRef} className={`event-details-back ${backFocused ? 'focused' : ''}`} onClick={onBack}>
        ← Back
      </button>

      {isTeamFixture ? <FootballEventHeader event={event} /> : <GenericEventHeader event={event} />}

      <section className="stream-area">
        {state.status === 'loading' && <StreamAreaLoading />}
        {state.status === 'not-found' && <NoMatchState apiStations={state.apiStations} onBrowseChannels={onBrowseChannels} />}
        {state.status === 'ready' && partitioned && (
          <StreamAreaReady
            partitioned={partitioned}
            favoriteChannels={favoriteChannels}
            onToggleFavoriteChannel={onToggleFavoriteChannel}
            onWatch={onWatch}
          />
        )}
      </section>

      <p className="event-details-footer">Stream availability depends on your connected playlist and region.</p>

      {import.meta.env.DEV && state.status === 'ready' && (state.apiStations.length > 0 || partitioned) && (
        <DevBroadcastDebug apiStations={state.apiStations} partitioned={partitioned} />
      )}
    </main>
  )
}

function StreamAreaReady({
  partitioned,
  favoriteChannels,
  onToggleFavoriteChannel,
  onWatch,
}: {
  partitioned: ReturnType<typeof partitionStreamOptions>
  favoriteChannels: ReadonlySet<string>
  onToggleFavoriteChannel: (channelId: string) => void
  onWatch: (channel: Channel, source: ChannelSource) => void
}) {
  const shared = { favoriteChannels, onToggleFavoriteChannel, onWatch }
  return (
    <>
      <StreamRecommendations options={partitioned.top} {...shared} />
      <StreamList options={partitioned.rest} {...shared} />
      <CandidateStreamList
        options={partitioned.candidates}
        defaultOpen={partitioned.top.length === 0 && partitioned.rest.length === 0}
        {...shared}
      />
    </>
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

function NoMatchState({ apiStations, onBrowseChannels }: { apiStations: BroadcastStationInfo[]; onBrowseChannels: () => void }) {
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
  partitioned: ReturnType<typeof partitionStreamOptions> | null
}) {
  const { favoriteCountries } = loadPreferences()
  const favoriteCountrySet = new Set(favoriteCountries)

  function renderOption(option: EventStreamOption, tier: string) {
    const preferredMarket = option.countryName != null && favoriteCountrySet.has(option.countryName)
    return (
      <li key={option.key}>
        [{tier}] {option.displayName}
        {option.countryName && ` · ${option.countryName}${preferredMarket ? ' (preferred)' : ''}`}
        {' · '}
        {option.matchConfidence}
        {' · quality '}
        {option.bestQualityTier}
        {option.isFavorite && ' · ★ favorite'}
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
          <h2 className="event-details-debug-title">Debug: final ranked streams</h2>
          <ul className="event-details-debug-list">
            {partitioned.top.map((o) => renderOption(o, 'top'))}
            {partitioned.rest.map((o) => renderOption(o, 'rest'))}
            {partitioned.candidates.map((o) => renderOption(o, 'candidate'))}
          </ul>
        </>
      )}
    </section>
  )
}
