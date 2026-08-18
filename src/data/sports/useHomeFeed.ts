import { useEffect, useState } from 'react'
import { fetchNextEventsForLeague, fetchPastEventsForLeague } from './theSportsDbClient'
import { getEvents } from './ninetyApiClient'
import { leaguesForPreferences } from './leagues'
import { mapNinetyEvent, mapEvent } from './mapEvent'
import { isHeuristicallyLive } from './liveHeuristic'
import { selectHero } from './heroScoring'
import { matchChannelsForEvent } from './channelMatch'
import type { SportEvent } from './types'
import type { SportPreferences } from '../preferences'
import type { LeagueDef } from './leagues'
import type { Channel } from '../channel'
import type { XtreamCredentials } from '../xtream/types'

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

export function useHomeFeed(preferences: SportPreferences, channels: Channel[], xtreamCreds: XtreamCredentials | null): HomeFeedState {
  const [state, setState] = useState<HomeFeedState>({ status: 'loading', feed: EMPTY_FEED })
  // Stable key so the effect only refires when the actual selection
  // changes, not on every render (preferences is a fresh object each time
  // it's loaded from storage upstream).
  const prefsKey = `${preferences.sports.join(',')}|${preferences.footballLeagueIds.join(',')}`

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading', feed: EMPTY_FEED })

    async function load() {
      const leagues = leaguesForPreferences(preferences)
      const footballLeagues = leagues.filter((l): l is LeagueDef & { ninetyCompetitionId: string } => l.ninetyCompetitionId != null)
      const otherLeagues = leagues.filter((l) => l.sportKey !== 'football')

      try {
        // ninety-api: one call covers every tracked competition's upcoming
        // window at once (see the backend's rolling-window default) —
        // filtered client-side to the leagues actually followed, same
        // pattern as the old Sportmonks day-wide fetch but a single
        // request instead of one per lookahead day.
        let footballAll: SportEvent[] = []
        // Unlike the per-league try/catch below for F1, a football fetch
        // failure isn't swallowed into an empty list — that used to make a
        // dead ninety-api (or a missing VITE_NINETY_API_URL) look like
        // "just no matches today" instead of a real outage. The message is
        // surfaced via footballError below so F1 can still render.
        let footballError: string | null = null
        if (footballLeagues.length > 0) {
          try {
            const { events } = await getEvents()
            footballAll = events.flatMap((ev) => {
              const league = footballLeagues.find((l) => l.ninetyCompetitionName === ev.competition_name)
              return league ? [mapNinetyEvent(ev, league)] : []
            })
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

        // Live Now is deliberately narrower than "everything currently
        // live in a followed league": a non-football sport (just F1 now)
        // is always allowed through (no channel-matching exists for
        // single-entrant events anyway — see channelMatch.ts), but a
        // football match only qualifies if we can actually find a channel
        // in the user's playlist airing it. A "live" card with nowhere to
        // watch it defeats the point of the row.
        const liveNowCandidates = [...footballLive, ...heuristicLive]
        const liveNow = (
          await Promise.all(
            liveNowCandidates.map(async (ev): Promise<SportEvent | null> => {
              if (ev.sportKey !== 'football') return ev
              try {
                const { matches } = await matchChannelsForEvent(ev, channels, xtreamCreds)
                return matches.length > 0 ? ev : null
              } catch {
                return null
              }
            }),
          )
        ).filter((ev): ev is SportEvent => ev != null)

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

        if (!cancelled) {
          if (footballError) {
            setState({ status: 'partial', feed, message: `Football fixtures unavailable: ${footballError}` })
          } else {
            setState({ status: 'ready', feed })
          }
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            status: 'error',
            feed: EMPTY_FEED,
            message: err instanceof Error ? err.message : 'Failed to load fixtures',
          })
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [prefsKey, channels, xtreamCreds])

  return state
}
