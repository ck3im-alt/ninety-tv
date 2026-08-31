// Event Details' empty state — what the screen shows when it has no stream
// to offer, which is not the same thing as having nothing to say.
//
// It replaces a single line of grey text ("No TV channel has been reported
// for this event yet.") that was, in the most interesting case, simply
// false: ninety-api routinely knows exactly which broadcasters are showing a
// fixture while the local resolver cannot confidently map any of them to
// this viewer's playlist. That distinction is now the centre of the screen.
//
// WHAT IS AND IS NOT A STREAM. Everything listed here is INFORMATION. The
// stations are the ones that did not produce a trusted match, and the
// "possible matches" under an ambiguous station are playlist names Ninety
// explicitly could not choose between. None of them are focusable, none of
// them play anything, and nothing in this file may ever turn one into a
// Watch action — the AMBIGUOUS tier exists precisely because guessing would
// put the wrong channel behind that button. See resolveNoStreamState.ts.
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation'
import { useFocusScrollIntoView } from '../../core/platform'
import { formatLastUpdated } from '../../core/time/lastUpdated'
import { COUNTRY_NAMES, flagSrc } from '../../data/countryCodes'
import { BROWSE_CHANNELS_FOCUS_KEY, REFRESH_PLAYLIST_FOCUS_KEY } from './eventDetailsFocusKeys'
import { ambiguousPlaylistHints, resolveNoStreamState } from './resolveNoStreamState'
import type { BroadcastStationInfo } from '../../data/sports/channelMatch'
import type { BroadcastAvailability } from '../../data/sports/broadcastAvailability'

// How the screen can refresh the viewer's channels. Supplied by App from the
// EXISTING playlist library (see usePlaylistLibrary's resyncPlaylist /
// resyncAll) — there is deliberately no second refresh mechanism here, and
// this screen deliberately does not try to guess WHICH playlist might carry
// a missing broadcaster.
export interface PlaylistRefresh {
  // How many connected playlists can actually be re-fetched. Drives the
  // label only: a file-upload playlist cannot be resynced at all, so it is
  // not counted.
  resyncableCount: number
  // When any of them last synced SUCCESSFULLY (epoch ms), or null if none
  // ever has. Shown under the button so pressing it has a visible result
  // even in the common case where the refresh changes nothing on screen —
  // without it, a viewer who finds no new channel cannot tell a refresh
  // that ran from one that silently did nothing.
  lastRefreshedAt: number | null
  refresh: () => Promise<void>
}

function StationCountry({ code }: { code: string }) {
  const flag = flagSrc(code)
  return (
    <span className="no-stream-station-country">
      {flag && <img className="no-stream-station-flag" src={flag} alt="" />}
      {/* The catalog's own name where the code is one Ninety knows, and the
          bare code otherwise — never an invented country. */}
      {COUNTRY_NAMES[code.toUpperCase()] ?? code.toUpperCase()}
    </span>
  )
}

function StationCard({ station }: { station: BroadcastStationInfo }) {
  const hints = ambiguousPlaylistHints(station)
  return (
    <li className="no-stream-station">
      <div className="no-stream-station-head">
        <span className="no-stream-station-name">{station.name}</span>
        {station.country && <StationCountry code={station.country} />}
      </div>
      {/* Deliberately worded as a possibility and styled as a quiet aside.
          Ninety has NOT confirmed these — it found several playlist channels
          that could be this broadcaster and could not choose. Saying so is
          useful; implying a match would not be. */}
      {hints.length > 0 && (
        <p className="no-stream-station-hint">
          <span className="no-stream-station-hint-label">Possible matches in your playlist:</span> {hints.join(' · ')}
        </p>
      )}
    </li>
  )
}

function ActionButton({
  focusKey,
  label,
  tone,
  busy,
  onSelect,
}: {
  focusKey: string
  label: string
  tone: 'primary' | 'secondary'
  busy?: boolean
  onSelect: () => void
}) {
  // STAYS FOCUSABLE WHILE BUSY, and swallows the press instead. A control
  // that leaves the spatial-nav tree under the viewer's own finger is the
  // failure this codebase keeps having to fix; and since the press is
  // swallowed here, a second Enter cannot start a second refresh either.
  const { ref, focused } = useFocusable({ focusKey, onEnterPress: () => !busy && onSelect() })
  useFocusScrollIntoView(ref, focused)
  return (
    <button
      ref={ref}
      className={`no-stream-action ${tone} ${focused ? 'focused' : ''} ${busy ? 'busy' : ''}`}
      onClick={() => !busy && onSelect()}
      aria-busy={busy ? true : undefined}
    >
      {label}
    </button>
  )
}

export function NoStreamState({
  apiStations,
  availability,
  availabilityReason,
  playlistRefresh,
  refreshing,
  onRefreshPlaylists,
  onBrowseChannels,
}: {
  apiStations: BroadcastStationInfo[]
  availability: BroadcastAvailability
  availabilityReason?: string
  playlistRefresh?: PlaylistRefresh
  refreshing: boolean
  onRefreshPlaylists: () => void
  onBrowseChannels: () => void
}) {
  const state = resolveNoStreamState({ apiStations, availability, availabilityReason })
  // Offered only when refreshing could plausibly help AND there is something
  // to refresh — a viewer with no connected playlist, or only a file one, is
  // not shown a button that cannot do anything.
  const canRefresh = state.offersRefresh && (playlistRefresh?.resyncableCount ?? 0) > 0
  const refreshLabel = refreshing
    ? 'Refreshing…'
    : (playlistRefresh?.resyncableCount ?? 0) > 1
      ? 'Refresh playlists'
      : 'Refresh playlist'

  return (
    <div className={`no-stream no-stream-${state.kind}`}>
      <div className="no-stream-message">
        <h2 className="no-stream-title">{state.title}</h2>
        <p className="no-stream-body">{state.body}</p>
      </div>

      {state.stations.length > 0 && (
        <section className="no-stream-stations">
          <h3 className="no-stream-section-title">Available on TV</h3>
          <ul className="no-stream-station-list">
            {state.stations.map((station, index) => (
              // The logical channel id is the station's real identity — one
              // broadcaster can arrive under more than one spelling, so the
              // name is not a key. Index only as a last resort, for a
              // backend old enough not to send the id.
              <StationCard key={station.logicalChannelId || `${station.name}-${index}`} station={station} />
            ))}
          </ul>
        </section>
      )}

      <div className="no-stream-actions">
        {canRefresh && (
          <div className="no-stream-action-group">
            <ActionButton
              focusKey={REFRESH_PLAYLIST_FOCUS_KEY}
              label={refreshLabel}
              tone="primary"
              busy={refreshing}
              onSelect={onRefreshPlaylists}
            />
            {/* WHEN IT LAST ACTUALLY HAPPENED. A refresh that finds nothing
                new leaves the screen looking identical, so without this the
                viewer has no way to tell it ran at all — and would keep
                pressing. The timestamp comes from the playlist library's own
                lastSyncedAt, so it only moves on a SUCCESSFUL sync: a failed
                refresh correctly keeps showing the older time rather than
                claiming a success that did not happen. Within the first
                minute it reads "Refreshed just now", which is the
                confirmation the press itself needs. */}
            <p className="no-stream-refreshed">{formatLastUpdated('Refreshed', playlistRefresh?.lastRefreshedAt ?? null)}</p>
          </div>
        )}
        <ActionButton
          focusKey={BROWSE_CHANNELS_FOCUS_KEY}
          label="Check channels manually"
          tone={canRefresh ? 'secondary' : 'primary'}
          onSelect={onBrowseChannels}
        />
      </div>
    </div>
  )
}
