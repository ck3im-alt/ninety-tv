import { useEffect, useState } from 'react'
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useBackHandler } from '../../core/platform'
import { matchChannelsForEvent } from '../../data/sports/channelMatch'
import type { ChannelMatch, BroadcastStationInfo } from '../../data/sports/channelMatch'
import { useStreamQualities } from './useStreamQualities'
import type { QualityByGroup, QualityState } from './useStreamQualities'
import { groupChannelMatches } from './groupChannelMatches'
import type { MatchGroup, SourceOption } from './groupChannelMatches'
import type { SportEvent } from '../../data/sports/types'
import type { Channel, ChannelSource } from '../../data/channel'
import type { XtreamCredentials } from '../../data/xtream/types'
import './EventDetailsScreen.css'

interface Props {
  event: SportEvent
  channels: Channel[]
  xtreamCreds: XtreamCredentials | null
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

export function EventDetailsScreen({ event, channels, xtreamCreds, onWatch, onBack, onBrowseChannels }: Props) {
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
    setState({ status: 'loading' })
    matchChannelsForEvent(event, channels, xtreamCreds)
      .then(({ matches, apiStations }) => {
        if (cancelled) return
        setState(matches.length > 0 ? { status: 'ready', matches, apiStations } : { status: 'not-found', apiStations })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'not-found', apiStations: [] })
      })
    return () => {
      cancelled = true
    }
  }, [event, channels, xtreamCreds])

  useBackHandler(() => {
    onBack()
    return true
  })

  const { ref: backRef, focused: backFocused } = useFocusable({ onEnterPress: onBack, forceFocus: true })
  const isTeamFixture = Boolean(event.homeTeam && event.awayTeam)

  return (
    <main className="event-details">
      <button ref={backRef} className={`event-details-back ${backFocused ? 'focused' : ''}`} onClick={onBack}>
        ← Back
      </button>

      <div className="event-details-header">
        {event.league && (
          <div className="event-details-league">
            {event.leagueBadge && <img className="event-details-league-badge" src={event.leagueBadge} alt="" />}
            <span className="event-details-league-name">{event.league}</span>
          </div>
        )}
        <div className="event-details-tags">
          {event.isLive && (
            <span className="event-details-live-badge">
              <span className="event-details-live-dot" /> LIVE{!event.isLiveHeuristic && event.liveClock ? ` · ${event.liveClock}` : ''}
            </span>
          )}
          {event.round && isTeamFixture && <span className="event-details-round">{event.round.toUpperCase()}</span>}
        </div>
      </div>

      {isTeamFixture ? (
        <div className="event-details-matchup">
          <TeamBlock name={event.homeTeam!} badge={event.homeBadge} score={event.homeScore} />
          <span className="event-details-vs">vs</span>
          <TeamBlock name={event.awayTeam!} badge={event.awayBadge} score={event.awayScore} align="right" />
        </div>
      ) : (
        <h1 className="event-details-title">{event.title}</h1>
      )}

      <div className="event-details-meta">
        <span>{event.timeLabel}</span>
        {event.venue && <span>{event.venue}{event.venueCity && `, ${event.venueCity}`}</span>}
        {event.referee && <span>Referee: {event.referee}</span>}
      </div>

      <section className="event-details-broadcast">
        <h2 className="event-details-broadcast-title">Available On</h2>
        {state.status === 'loading' && <p className="event-details-status">Checking your playlist…</p>}
        {state.status === 'not-found' && (
          state.apiStations.length > 0 ? (
            <div className="event-details-status">
              <p>This match is reported to air on:</p>
              <ul className="event-details-station-list">
                {state.apiStations.map((s, i) => (
                  <li key={i}>
                    {s.name}
                    {s.country && <span className="event-details-station-country"> — {s.country}</span>}
                  </li>
                ))}
              </ul>
              <p>None of these are in your connected playlist.</p>
            </div>
          ) : (
            <p className="event-details-status">No TV channel has been reported for this match.</p>
          )
        )}
        {state.status === 'ready' && (
          <ChannelMatchGroups matches={state.matches} onWatch={onWatch} />
        )}

        {state.status === 'not-found' && (
          <BrowseManuallyButton onClick={onBrowseChannels} />
        )}
      </section>

      {state.status === 'ready' && state.apiStations.length > 0 && (
        <section className="event-details-debug">
          <h2 className="event-details-debug-title">Debug: ninety-api reports</h2>
          <ul className="event-details-debug-list">
            {state.apiStations.map((s, i) => (
              <li key={i}>
                {s.name}
                {s.country && ` (${s.country})`}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}

function TeamBlock({
  name,
  badge,
  score,
  align = 'left',
}: {
  name: string
  badge?: string
  score?: string
  align?: 'left' | 'right'
}) {
  return (
    <div className={`event-details-team event-details-team-${align}`}>
      {badge && <img className="event-details-team-logo" src={badge} alt="" />}
      <span className="event-details-team-name">{name}</span>
      {score != null && <span className="event-details-team-score">{score}</span>}
    </div>
  )
}

// Higher is better; groups with no quality hint (tier 0) sort after any
// group that has one, but otherwise keep their incoming relative order —
// see rankStreamQuality.ts for how the tier itself is derived.
function qualityRank(quality: QualityState | undefined): number {
  return quality?.tier ?? 0
}

function sortByQuality(groups: MatchGroup[], qualities: QualityByGroup): MatchGroup[] {
  return groups
    .map((group, index) => ({ group, index }))
    .sort((a, b) => qualityRank(qualities.get(b.group.key)) - qualityRank(qualities.get(a.group.key)) || a.index - b.index)
    .map((entry) => entry.group)
}

function ChannelMatchGroups({
  matches,
  onWatch,
}: {
  matches: ChannelMatch[]
  onWatch: (channel: Channel, source: ChannelSource) => void
}) {
  // Multiple ChannelMatch results (e.g. differently-quality-tagged playlist
  // entries for the same real channel) collapse into one group here, so the
  // list shows one row per real channel with its sources offered as a
  // quality choice, rather than one row per raw playlist entry — see
  // groupChannelMatches.ts.
  const groups = groupChannelMatches(matches)
  const qualities = useStreamQualities(groups)
  const exactGroups = sortByQuality(groups.filter((g) => g.isExactMatch), qualities)
  const fuzzyGroups = sortByQuality(groups.filter((g) => !g.isExactMatch), qualities)
  // namesOverlap (channelMatch.ts) deliberately keeps a loose net of
  // partial candidates alongside a confident exact match — numbered
  // siblings like "Arena Sport 1"/"Arena Sport 5" are kept in case the
  // exact channel is missing from this playlist, not because they're
  // likely right. That's the correct behavior when there's no exact match
  // to fall back on, but once one exists, a dozen loose guesses under it
  // is just noise — collapsed by default in that case, still one tap away.
  const [showFuzzy, setShowFuzzy] = useState(exactGroups.length === 0)
  const { ref: toggleRef, focused: toggleFocused } = useFocusable({ onEnterPress: () => setShowFuzzy((v) => !v) })

  return (
    <>
      {exactGroups.length > 0 && (
        <div className="event-details-channel-group">
          <h3 className="event-details-channel-group-title">Best Match</h3>
          <div className="event-details-channel-list">
            {exactGroups.map((group) => (
              <ChannelOption key={group.key} group={group} onWatch={onWatch} quality={qualities.get(group.key)} />
            ))}
          </div>
        </div>
      )}
      {fuzzyGroups.length > 0 && exactGroups.length > 0 && !showFuzzy && (
        <button ref={toggleRef} className={`event-details-show-more ${toggleFocused ? 'focused' : ''}`} onClick={() => setShowFuzzy(true)}>
          Show {fuzzyGroups.length} more channel{fuzzyGroups.length === 1 ? '' : 's'} that might have it
        </button>
      )}
      {fuzzyGroups.length > 0 && showFuzzy && (
        <div className="event-details-channel-group">
          <h3 className="event-details-channel-group-title">
            {exactGroups.length > 0 ? 'Partial Matches' : 'Channels That Might Have It'}
          </h3>
          <div className="event-details-channel-list">
            {fuzzyGroups.map((group) => (
              <ChannelOption key={group.key} group={group} onWatch={onWatch} quality={qualities.get(group.key)} />
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function BrowseManuallyButton({ onClick }: { onClick: () => void }) {
  const { ref, focused } = useFocusable({ onEnterPress: onClick })
  return (
    <button ref={ref} className={`event-details-browse-manually ${focused ? 'focused' : ''}`} onClick={onClick}>
      Think we got it wrong? Check your channels manually
    </button>
  )
}

// A name/label-derived hint (e.g. "UHD", "1080p") — not a measured value,
// since nothing here has opened the stream to check. Omitted entirely when
// no quality tag was found in the playlist metadata, rather than guessing.
function QualityBadge({ quality }: { quality: QualityState | undefined }) {
  if (!quality?.label) return null
  return <span className="event-details-channel-quality">{quality.label}</span>
}

function ChannelOption({
  group,
  onWatch,
  quality,
}: {
  group: MatchGroup
  onWatch: (channel: Channel, source: ChannelSource) => void
  quality?: QualityState
}) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const selected = group.sourceOptions[selectedIndex] ?? group.sourceOptions[0]
  const { ref, focused } = useFocusable({ onEnterPress: () => selected && onWatch(selected.channel, selected.source) })
  return (
    <div className="event-details-channel-card">
      <button
        ref={ref}
        className={`event-details-channel ${focused ? 'focused' : ''}`}
        onClick={() => selected && onWatch(selected.channel, selected.source)}
      >
        {group.logo && <img className="event-details-channel-logo" src={group.logo} alt="" />}
        <div className="event-details-channel-text">
          <span>{group.name}</span>
          <div className="event-details-channel-subrow">
            {/* Shows the actual broadcaster/programme-title text that produced
                this match — a match is inherently a guess against playlist
                channel names, so showing the evidence keeps it honest rather
                than presenting the pick as a verified fact. Skipped when the
                label is identical to the name (ppvName matches, where the
                playlist's own raw title is both) — showing it twice looks
                like broken/duplicated text, not "extra evidence". */}
            {group.label !== group.name && (
              <span className="event-details-channel-match-label">via {group.label}</span>
            )}
            <QualityBadge quality={quality} />
          </div>
        </div>
      </button>
      {group.sourceOptions.length > 1 && (
        <SourcePicker sourceOptions={group.sourceOptions} selectedIndex={selectedIndex} onSelect={setSelectedIndex} />
      )}
    </div>
  )
}

// Same real channel, multiple qualities in the user's playlist (UHD/HD/RAW
// etc, see mergeChannelSources) — offered as a pick rather than silently
// always playing the first one, since "always UHD" isn't reliably "always
// best" (see blueprint section 39: quality tags are a hint, not verified
// truth, until actually probed/played).
function SourcePicker({
  sourceOptions,
  selectedIndex,
  onSelect,
}: {
  sourceOptions: SourceOption[]
  selectedIndex: number
  onSelect: (index: number) => void
}) {
  return (
    <div className="event-details-source-picker">
      {sourceOptions.map((option, index) => (
        <SourcePickerOption
          key={`${option.channel.id}-${option.source.label}-${index}`}
          label={option.source.label}
          selected={index === selectedIndex}
          onSelect={() => onSelect(index)}
        />
      ))}
    </div>
  )
}

function SourcePickerOption({ label, selected, onSelect }: { label: string; selected: boolean; onSelect: () => void }) {
  const { ref, focused } = useFocusable({ onEnterPress: onSelect })
  return (
    <button
      ref={ref}
      className={`event-details-source-tag ${selected ? 'selected' : ''} ${focused ? 'focused' : ''}`}
      onClick={onSelect}
    >
      {label}
    </button>
  )
}
