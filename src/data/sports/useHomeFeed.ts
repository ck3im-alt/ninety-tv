import { useCallback, useEffect, useRef, useState } from 'react'
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
const EMPTY_EVENTS_BY_ID: ReadonlyMap<string, SportEvent> = new Map()

// Shared by every HomeFeedState variant — see the union below. `eventsById`
// is every event this hook has fetched (football + F1, live and upcoming
// alike), keyed by SportEvent.id, so a screen holding onto ONE event by id
// (Event Details' selectedEvent in App.tsx) can look up its freshest known
// version after a background refresh without this hook needing to know
// anything about that screen. Deliberately broader than HomeFeed's own
// hero/liveNow/tonight — those are already filtered (liveNow requires a
// channel match, tonight excludes the hero) in ways that would otherwise
// make an event invisible to a lookup the moment it, say, goes live with no
// available channel. `refresh` is a stable (see silentRefresh below)
// imperative trigger for an immediate silent revalidation — used by App.tsx
// on Player exit (see the task's "immediate refresh on Player exit"
// requirement); periodic (~60s) and visibility-regain triggers are handled
// internally by this hook and need no caller involvement.
interface HomeFeedBase {
  feed: HomeFeed
  eventsById: ReadonlyMap<string, SportEvent>
  refresh: () => void
}

export type HomeFeedState =
  | (HomeFeedBase & { status: 'loading' })
  | (HomeFeedBase & { status: 'error'; message: string })
  | (HomeFeedBase & { status: 'partial'; message: string })
  | (HomeFeedBase & { status: 'ready' })

// The raw result of Effect 1's network fetch — everything needed to derive
// the final feed EXCEPT the channel-matching step, which depends on
// channels/xtreamCreds/identityIndex and must not itself trigger a refetch
// when those change (identityIndex in particular changes up to twice per
// session as the Channel Identity Resolver rebuilds — see
// useChannelIdentityIndex.ts).
type FetchState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'loaded'
      data: { upcoming: SportEvent[]; liveNowCandidates: SportEvent[]; footballError: string | null; eventsById: ReadonlyMap<string, SportEvent> }
    }

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

  // True while ANY fetch (the prefsKey-driven load below, or a silent
  // background refresh — see silentRefresh) is in flight — shared between
  // both so they can never overlap (task requirement: no duplicate/
  // overlapping requests). A background refresh that arrives while the
  // initial load is still running just no-ops rather than racing it; the
  // initial load's own result already covers that same data.
  const inFlightRef = useRef(false)
  // Read inside silentRefresh's already-resolved .then, not at call time —
  // lets a background refresh detect that preferences changed (and Effect 1
  // below already started a fresher load) while it was in flight, and
  // discard its now-stale result instead of overwriting newer data.
  const prefsKeyRef = useRef(prefsKey)
  prefsKeyRef.current = prefsKey

  // Extracted out of Effect 1 (unlike before) so silentRefresh (see below)
  // can run the exact same fetch logic for a background revalidation — only
  // how the result is APPLIED to fetchState differs between "the user's
  // selection changed, show loading" (Effect 1) and "silently refresh
  // whatever's already there" (silentRefresh). Recreated every render (like
  // any other function in a component body) — cheap, and always closes over
  // the current preferences/viewerMarkets; see loadRef below for how a
  // long-lived effect gets at the LATEST version without re-subscribing.
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
    const eventsById = new Map<string, SportEvent>()
    for (const ev of footballAll) eventsById.set(ev.id, ev)
    for (const ev of otherEventLists.flat()) eventsById.set(ev.id, ev)
    for (const ev of heuristicLive) eventsById.set(ev.id, ev)
    return { upcoming, liveNowCandidates, footballError, eventsById }
  }

  // Effect 1 — fetch-only, on the user's actual selection changing.
  // Deps: [prefsKey] ONLY. Deliberately excludes channels/xtreamCreds/
  // identityIndex: this effect's only job is acquiring event data from
  // ninety-api/TheSportsDB, which has nothing to do with the user's local
  // playlist — refetching fixtures because the identity index finished
  // rebuilding was the actual bug this split fixes. The ONLY place that
  // shows a loading state (see HomeFeed's own comment on EMPTY_FEED/Effect
  // 2 below) — a changed prefsKey means genuinely different data is
  // needed, unlike a background revalidation of the same selection.
  useEffect(() => {
    let cancelled = false
    setFetchState({ status: 'loading' })
    markPerf('home:fetch-start')
    inFlightRef.current = true

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
      .finally(() => {
        inFlightRef.current = false
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsKey])

  // Always the CURRENT render's `load` (fresh preferences/viewerMarkets
  // closure) without the timer/visibility effect below needing to
  // re-subscribe on every render — the standard "latest ref" pattern for an
  // effect that must call fresh logic without depending on it directly.
  const loadRef = useRef(load)
  loadRef.current = load

  // Silent background revalidation — stale-while-revalidate, per the
  // feature's own core requirement: NEVER sets fetchState to 'loading'
  // (Effect 2 below treats that as "blank the feed," which is exactly the
  // full-reload flash this exists to avoid), and a failure is silently
  // swallowed, leaving whatever fetchState already holds completely
  // untouched — stale-but-real data beats a spinner or an error screen.
  // Stable identity (useCallback, empty deps) so it's safe both as an
  // effect dependency below and as the `refresh` App.tsx calls on Player
  // exit without that triggering extra effect churn.
  const silentRefresh = useCallback(() => {
    if (inFlightRef.current) return // an initial/prefsKey load or another silent refresh is already in flight
    inFlightRef.current = true
    const requestedPrefsKey = prefsKeyRef.current
    loadRef
      .current()
      .then((data) => {
        // preferences changed while this was in flight -- Effect 1 above
        // already issued (or is about to issue) a fresher load for the new
        // selection; applying this now-stale result would fight it.
        if (prefsKeyRef.current !== requestedPrefsKey) return
        // load() catches a football-fetch failure internally (see its own
        // try/catch above) and still RESOLVES, with empty upcoming/
        // liveNowCandidates/eventsById plus a set footballError -- correct
        // for the initial/prefsKey-driven load (which has nothing better
        // to show yet, hence 'partial' with an error message), but wrong
        // for a background refresh: applying this would blank out perfectly
        // good existing data just because one transient poll failed. Treat
        // it the same as an outright rejection instead.
        if (data.footballError) {
          console.warn('[useHomeFeed] background refresh failed, keeping last known fixtures:', data.footballError)
          return
        }
        setFetchState({ status: 'loaded', data })
      })
      .catch((err) => {
        console.warn('[useHomeFeed] background refresh failed, keeping last known fixtures:', err)
      })
      .finally(() => {
        inFlightRef.current = false
      })
  }, [])

  // The one place this hook decides WHEN to silently refresh: ~60s while
  // the app is actually visible/active (per the feature's target cadence),
  // plus immediately on regaining visibility (covers both a browser tab
  // coming back into focus and a Tizen app resuming from suspend, since
  // both fire the standard Page Visibility API — no Tizen-specific
  // lifecycle hook exists elsewhere in this codebase to prefer instead).
  // Player-exit's own immediate refresh is triggered externally (App.tsx
  // calls the returned `refresh`, i.e. this same silentRefresh) since only
  // App.tsx knows about screen navigation. One interval/listener pair for
  // the whole app — this hook has exactly one instance (lifted to App.tsx),
  // so this is the single global mechanism the feature spec asks for, not
  // a per-screen timer.
  useEffect(() => {
    const REFRESH_INTERVAL_MS = 60_000
    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible') silentRefresh()
    }, REFRESH_INTERVAL_MS)
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') silentRefresh()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [silentRefresh])

  const [state, setState] = useState<HomeFeedState>({ status: 'loading', feed: EMPTY_FEED, eventsById: EMPTY_EVENTS_BY_ID, refresh: silentRefresh })

  // Effect 2 — local derivation. Deps: [fetchState, channels, xtreamCreds,
  // identityIndex]. Re-runs whenever the identity index (or the playlist
  // itself) changes WITHOUT any network call — this is the actual fix.
  // Channel-matching here never sets allowNetworkFallback, so this is
  // purely local/free-stage matching (see channelMatch.ts) — safe to run
  // for every simultaneously-live event via Promise.all.
  useEffect(() => {
    if (fetchState.status === 'loading') {
      setState({ status: 'loading', feed: EMPTY_FEED, eventsById: EMPTY_EVENTS_BY_ID, refresh: silentRefresh })
      return
    }
    if (fetchState.status === 'error') {
      setState({ status: 'error', feed: EMPTY_FEED, message: fetchState.message, eventsById: EMPTY_EVENTS_BY_ID, refresh: silentRefresh })
      return
    }

    let cancelled = false
    markPerf('home:local-match-start')
    const { upcoming, liveNowCandidates, footballError, eventsById } = fetchState.data
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
        setState({ status: 'partial', feed, message: `Football fixtures unavailable: ${footballError}`, eventsById, refresh: silentRefresh })
      } else {
        setState({ status: 'ready', feed, eventsById, refresh: silentRefresh })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [fetchState, channels, xtreamCreds, identityIndex, silentRefresh])

  return state
}
