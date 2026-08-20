import { useEffect, useState } from 'react'
import { fetchNextEventsForLeague, fetchPastEventsForLeague } from './theSportsDbClient'
import { getAllEvents } from './ninetyApiClient'
import { footballLeaguesForPreferences, otherLeaguesForPreferences } from './leagues'
import { loadFootballCompetitions } from './competitionsCatalog'
import { deriveViewerMarkets } from './viewerMarket'
import { mapNinetyEvent, mapEvent } from './mapEvent'
import { isHeuristicallyLive } from './liveHeuristic'
import { selectHero } from './heroScoring'
import { matchChannelsForEvent } from './channelMatch'
import { markPerf, measurePerf } from '../../core/perf/devPerf'
import type { SportEvent } from './types'
import type { SportPreferences } from '../preferences'
import type { Channel } from '../channel'
import type { XtreamCredentials } from '../xtream/types'
import type { ChannelIdentityIndex } from './channelIdentityIndex'

export interface HomeFeed {
  hero: SportEvent | null
  // Whether the hero is live/starting within the hour, i.e. whether
  // "Watch Now" is actually true right now — see selectHero in
  // heroScoring.ts. False means the hero is just the next upcoming event,
  // shown for awareness rather than something to jump into immediately.
  heroIsWatchableNow: boolean
  liveNow: SportEvent[]
  tonight: SportEvent[]
}

const EMPTY_FEED: HomeFeed = { hero: null, heroIsWatchableNow: false, liveNow: [], tonight: [] }

export type HomeFeedState =
  | { status: 'loading'; feed: HomeFeed }
  | { status: 'error'; feed: HomeFeed; message: string }
  | { status: 'partial'; feed: HomeFeed; message: string }
  | { status: 'ready'; feed: HomeFeed }

// The raw result of Effect 1's network fetch — everything needed to derive
// the final feed EXCEPT the channel-matching step, which depends on
// channels/xtreamCreds/identityIndex and must not itself trigger a refetch
// when those change (identityIndex in particular changes up to twice per
// session as the Channel Identity Resolver rebuilds — see
// useChannelIdentityIndex.ts).
type FetchState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; data: { upcoming: SportEvent[]; liveNowCandidates: SportEvent[]; footballError: string | null } }

export function useHomeFeed(
  preferences: SportPreferences,
  channels: Channel[],
  xtreamCreds: XtreamCredentials | null,
  identityIndex: ChannelIdentityIndex | null,
): HomeFeedState {
  // Stable key so Effect 1 only refires when the actual selection changes,
  // not on every render (preferences is a fresh object each time it's
  // loaded from storage upstream). Includes the derived viewer markets (not
  // raw favoriteCountries) so a favorite-country change that doesn't
  // actually change which EPG markets are requested (e.g. adding a country
  // with no EPG coverage) doesn't trigger a needless refetch.
  const viewerMarkets = deriveViewerMarkets(preferences.favoriteCountries)
  const prefsKey = `${preferences.sports.join(',')}|${preferences.footballLeagueIds.join(',')}|${viewerMarkets.join(',')}`

  const [fetchState, setFetchState] = useState<FetchState>({ status: 'loading' })

  // Effect 1 — fetch-only. Deps: [prefsKey] ONLY. Deliberately excludes
  // channels/xtreamCreds/identityIndex: this effect's only job is acquiring
  // event data from ninety-api/TheSportsDB, which has nothing to do with
  // the user's local playlist — refetching fixtures because the identity
  // index finished rebuilding was the actual bug this split fixes.
  useEffect(() => {
    let cancelled = false
    setFetchState({ status: 'loading' })
    markPerf('home:fetch-start')

    async function load() {
      const otherLeagues = otherLeaguesForPreferences(preferences.sports)

      // ninety-api: filtered server-side to just the leagues the user
      // actually follows (competition_id accepts a comma-separated list —
      // see ninetyApiClient.ts) rather than fetching every one of Ninety's
      // 50 tracked competitions and discarding most of it client-side, the
      // way this used to work when there were only 7. getAllEvents follows
      // next_cursor to fetch every page rather than assuming the first
      // page is the entire feed.
      //
      // The competition catalog itself is now an async fetch too (see
      // competitionsCatalog.ts — ninety-tv no longer hardcodes all 50
      // competitions, it fetches them from ninety-api's GET
      // /v1/competitions). Folded into the same try/catch as the events
      // fetch below: from this hook's perspective, "can't get the
      // catalog" and "can't get events for the catalog's competitions"
      // are both just "football fixtures unavailable" — same footballError
      // surface either way, so F1 can still render regardless of which
      // step failed.
      //
      // No favorites selected (empty footballLeagueIds, or none of them
      // resolve to a real entry in the fetched catalog — e.g. a stale/
      // removed competition id) intentionally short-circuits before ever
      // calling getAllEvents: this must never send an empty
      // `competition_id=` to the API, which the backend would treat as
      // "no filter, return every tracked competition's events," not as
      // "return nothing."
      let footballAll: SportEvent[] = []
      let footballError: string | null = null
      if (preferences.sports.includes('football') && preferences.footballLeagueIds.length > 0) {
        try {
          const catalog = await loadFootballCompetitions()
          const footballLeagues = footballLeaguesForPreferences(preferences.footballLeagueIds, catalog)
          if (footballLeagues.length > 0) {
            const competitionIds = footballLeagues.map((l) => l.ninetyCompetitionId!)
            const leagueByCompetitionId = new Map(footballLeagues.map((l) => [l.ninetyCompetitionId!, l]))
            // country narrows each event's `broadcasts` payload to the
            // viewer's preferred markets (reduces response size — see
            // Phase 2B's performance goal); it never removes an event, even
            // when none of these markets have a resolved broadcast for it
            // (ninety-api's /v1/events country filter is broadcast-
            // narrowing only, not event-eligibility). Omitted entirely when
            // the user has no supported-market favorites, which the API
            // already treats as "don't filter."
            const events = await getAllEvents({
              competitionId: competitionIds,
              country: viewerMarkets.length > 0 ? viewerMarkets : undefined,
            })
            footballAll = events.flatMap((ev) => {
              const league = ev.competition_id ? leagueByCompetitionId.get(ev.competition_id) : undefined
              return league ? [mapNinetyEvent(ev, league)] : []
            })
          }
        } catch (err) {
          footballError = err instanceof Error ? err.message : 'Failed to load football fixtures'
        }
      }
      const footballUpcoming = footballAll.filter((ev) => !ev.isLive)
      const footballLive = footballAll.filter((ev) => ev.isLive)

      // Every other sport (just F1 now — see types.ts): unchanged
      // TheSportsDB per-league lookup, low enough volume that its "only
      // returns one event" limitation rarely matters.
      const otherEventLists = await Promise.all(
        otherLeagues.map(async (league) => {
          try {
            const raw = await fetchNextEventsForLeague(league.id)
            return raw.map((ev) => mapEvent(ev, league))
          } catch {
            return []
          }
        }),
      )

      const upcoming = [...footballUpcoming, ...otherEventLists.flat()]
        .filter((ev) => ev.dateTimeUtc && new Date(ev.dateTimeUtc).getTime() > Date.now())
        .sort((a, b) => new Date(a.dateTimeUtc!).getTime() - new Date(b.dateTimeUtc!).getTime())

      // Every other sport has no live signal at all — guess instead:
      // fetch each league's most recently-STARTED fixture (not "next",
      // which stops returning an event the moment it begins — see
      // fetchPastEventsForLeague) and check whether it's still plausibly
      // in progress. No score is ever attached to these.
      const heuristicLive = (
        await Promise.all(
          otherLeagues.map(async (league): Promise<SportEvent | null> => {
            try {
              const raw = await fetchPastEventsForLeague(league.id)
              const mostRecent = raw[0]
              if (!mostRecent) return null
              const mapped = mapEvent(mostRecent, league)
              if (!isHeuristicallyLive(league.sportKey, mapped.title, mapped.dateTimeUtc)) return null
              return { ...mapped, isLive: true, isLiveHeuristic: true }
            } catch {
              return null
            }
          }),
        )
      ).filter((ev): ev is SportEvent => ev != null)

      const liveNowCandidates = [...footballLive, ...heuristicLive]
      return { upcoming, liveNowCandidates, footballError }
    }

    load()
      .then((data) => {
        if (cancelled) return
        markPerf('home:fetch-end')
        measurePerf('home:fetch', 'home:fetch-start', 'home:fetch-end')
        setFetchState({ status: 'loaded', data })
      })
      .catch((err) => {
        if (cancelled) return
        setFetchState({ status: 'error', message: err instanceof Error ? err.message : 'Failed to load fixtures' })
      })

    return () => {
      cancelled = true
    }
  }, [prefsKey])

  const [state, setState] = useState<HomeFeedState>({ status: 'loading', feed: EMPTY_FEED })

  // Effect 2 — local derivation. Deps: [fetchState, channels, xtreamCreds,
  // identityIndex]. Re-runs whenever the identity index (or the playlist
  // itself) changes WITHOUT any network call — this is the actual fix.
  // Channel-matching here never sets allowNetworkFallback, so this is
  // purely local/free-stage matching (see channelMatch.ts) — safe to run
  // for every simultaneously-live event via Promise.all.
  useEffect(() => {
    if (fetchState.status === 'loading') {
      setState({ status: 'loading', feed: EMPTY_FEED })
      return
    }
    if (fetchState.status === 'error') {
      setState({ status: 'error', feed: EMPTY_FEED, message: fetchState.message })
      return
    }

    let cancelled = false
    markPerf('home:local-match-start')
    const { upcoming, liveNowCandidates, footballError } = fetchState.data
    ;(async () => {
      // Live Now is deliberately narrower than "everything currently live
      // in a followed league": a non-football sport (just F1 now) is
      // always allowed through (no channel-matching exists for
      // single-entrant events anyway — see channelMatch.ts), but a
      // football match only qualifies if we can actually find a channel in
      // the user's playlist airing it. A "live" card with nowhere to watch
      // it defeats the point of the row.
      const liveNow = (
        await Promise.all(
          liveNowCandidates.map(async (ev): Promise<SportEvent | null> => {
            if (ev.sportKey !== 'football') return ev
            try {
              const { matches } = await matchChannelsForEvent(ev, channels, xtreamCreds, identityIndex)
              return matches.length > 0 ? ev : null
            } catch {
              return null
            }
          }),
        )
      ).filter((ev): ev is SportEvent => ev != null)

      // A newer fetchState/channels/identityIndex has already superseded
      // this pass — never overwrite state produced for a newer generation
      // with a stale one that just finished.
      if (cancelled) return

      // Two-tier pick, not a single blended score — see selectHero in
      // heroScoring.ts: live/starting-within-the-hour wins outright over
      // everything else regardless of prestige (a smaller game happening
      // now beats a bigger one two days out, since only one of them can
      // actually be watched right now); otherwise it falls back to the
      // single soonest time slot. `upcoming` itself stays chronologically
      // sorted for the Coming Up row below either way.
      const { hero, isWatchableNow } = selectHero(liveNow, upcoming)
      const tonight = upcoming.filter((ev) => ev.id !== hero?.id)
      const feed: HomeFeed = { hero, heroIsWatchableNow: isWatchableNow, liveNow, tonight }

      markPerf('home:local-match-end')
      measurePerf('home:local-match', 'home:local-match-start', 'home:local-match-end')

      if (footballError) {
        setState({ status: 'partial', feed, message: `Football fixtures unavailable: ${footballError}` })
      } else {
        setState({ status: 'ready', feed })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [fetchState, channels, xtreamCreds, identityIndex])

  return state
}
