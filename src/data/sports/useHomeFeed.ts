import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchNextEventsForLeague, fetchPastEventsForLeague } from './theSportsDbClient'
import { getAllEvents } from './ninetyApiClient'
import { fallbackFootballLeague, footballLeaguesForPreferences, otherLeaguesForPreferences } from './leagues'
import { loadFootballCompetitions } from './competitionsCatalog'
import { localDayRange } from './localDay'
import { deriveViewerMarkets } from './viewerMarket'
import { mapNinetyEvent, mapEvent } from './mapEvent'
import { isHeuristicallyLive } from './liveHeuristic'
import { buildPersonalizationContext } from './homePersonalization'
import { describeRanking, eventTiming, rankHomeFeed, selectHero, type EventTiming, type HomeFeedItem } from './homeRanking'
import { loadWatchAffinity } from './watchAffinity'
import { matchChannelsForEvent } from './channelMatch'
import { markPerf, measurePerf } from '../../core/perf/devPerf'
import type { SportEvent } from './types'
import type { SportPreferences } from '../preferences'
import type { Channel } from '../channel'
import type { XtreamCredentialResolver } from '../playlists/xtreamResolver'
import type { ChannelIdentityIndex } from './channelIdentityIndex'

export interface HomeFeed {
  hero: SportEvent | null
  // Whether the hero is live/starting within the hour AND actually playable
  // from the viewer's own playlist — see selectHero in homeRanking.ts.
  // False means the hero is shown for awareness ("Event Preview") rather
  // than as something to jump straight into.
  heroIsWatchableNow: boolean
  // Where the hero sits relative to the clock, resolved with the same
  // `now` the ranking used. Carried on the feed rather than recomputed at
  // render time so the hero badge can never disagree with the card in the
  // row below it about whether a match has kicked off.
  heroTiming: EventTiming
  // The "Live now & coming up" row, already ranked and grouped: every live
  // event, then everything starting within the hour, then the rest of
  // today. Each item carries its own group so a card can label itself
  // ("STARTING SOON · 21:00") without re-deriving the boundary.
  items: HomeFeedItem[]
  // Flat views over the same items, kept because Multiview's EventPicker
  // consumes them (it reuses Home's already-fetched feed rather than
  // fetching its own). Derived, never separately ranked — the two can't
  // drift.
  liveNow: SportEvent[]
  tonight: SportEvent[]
}

const EMPTY_FEED: HomeFeed = { hero: null, heroIsWatchableNow: false, heroTiming: 'unknown', items: [], liveNow: [], tonight: [] }
const EMPTY_EVENTS_BY_ID: ReadonlyMap<string, SportEvent> = new Map()

// How far BACK the urgent window reaches. Long enough to still contain a
// match that kicked off before the app was opened and is now at 80 minutes
// (football's longest realistic in-play span, plus stoppages and a
// half-time), short enough not to drag in a whole afternoon of finished
// fixtures.
const URGENT_LOOKBACK_MS = 3 * 60 * 60 * 1000

// Only used when the viewer's day is genuinely out of football — see the
// fallback fetch in load(). Narrow AND favorite-filtered on purpose: it
// exists so Home isn't empty at 23:40, not so it can list a month of
// fixtures.
const FALLBACK_LOOKAHEAD_DAYS = 3

// Shared by every HomeFeedState variant — see the union below. `eventsById`
// is every event this hook has fetched (football + F1, live and upcoming
// alike), keyed by SportEvent.id, so a screen holding onto ONE event by id
// (Event Details' selectedEvent in App.tsx) can look up its freshest known
// version after a background refresh without this hook needing to know
// anything about that screen. Deliberately broader than HomeFeed's own
// hero/items — those are already filtered (the live row requires a channel
// match) in ways that would otherwise make an event invisible to a lookup
// the moment it, say, goes live with no available channel. `refresh` is a
// stable (see silentRefresh below) imperative trigger for an immediate
// silent revalidation — used by App.tsx on Player exit (see the task's
// "immediate refresh on Player exit" requirement); periodic (~60s) and
// visibility-regain triggers are handled internally by this hook and need
// no caller involvement.
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
// channels/xtream/identityIndex and must not itself trigger a refetch
// when those change (identityIndex in particular changes up to twice per
// session as the Channel Identity Resolver rebuilds — see
// useChannelIdentityIndex.ts).
type FetchState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'loaded'
      data: { candidates: SportEvent[]; footballError: string | null; eventsById: ReadonlyMap<string, SportEvent> }
    }

export function useHomeFeed(
  preferences: SportPreferences,
  channels: Channel[],
  xtream: XtreamCredentialResolver,
  identityIndex: ChannelIdentityIndex | null,
): HomeFeedState {
  // Stable key so Effect 1 only refires when something that changes WHAT IS
  // FETCHED changes, not on every render (preferences is a fresh object each
  // time it's loaded from storage upstream). Includes the derived viewer
  // markets (not raw favoriteCountries) so a favorite-country change that
  // doesn't actually change which EPG markets are requested (e.g. adding a
  // country with no EPG coverage) doesn't trigger a needless refetch.
  //
  // Deliberately does NOT include favoriteTeamIds, and no longer depends on
  // footballLeagueIds for the primary fetch: since candidate generation
  // stopped filtering by followed competitions (see load() below), those
  // preferences only affect ORDER. Re-ordering is local and instant — it
  // happens in the derivation memo, with no network round-trip at all.
  const viewerMarkets = deriveViewerMarkets(preferences.favoriteCountries)
  const fetchKey = `${preferences.sports.join(',')}|${preferences.footballLeagueIds.join(',')}|${viewerMarkets.join(',')}`

  const [fetchState, setFetchState] = useState<FetchState>({ status: 'loading' })

  // True while ANY fetch (the fetchKey-driven load below, or a silent
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
  const fetchKeyRef = useRef(fetchKey)
  fetchKeyRef.current = fetchKey

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

    // FAVORITES ARE NOT A FETCH FILTER ANY MORE.
    //
    // This used to send the viewer's followed competitions as
    // competition_id, which quietly made "leagues I follow" a hard content
    // filter: a Champions League final could be live and Ninety would not
    // know it existed, and a followed club playing outside its own league
    // (Bodø/Glimt in Europe) was invisible. Both are exactly what Home is
    // supposed to surface. Favorites now decide ORDER only — see
    // homePersonalization.ts.
    //
    // The window is one query, not three: `now - 3h` through the end of the
    // viewer's LOCAL day covers both the urgent band (anything live, or
    // kicking off within the hero's 60-minute window) and the rest of
    // today's candidates. Bounding it at the end of today is what keeps the
    // unfiltered, all-competitions request a sane size — a month of every
    // tracked competition would be an absurd payload to rank a TV home
    // screen with.
    //
    // LOCAL day, via localDay.ts: ninety-api's own `date` filter compares
    // the UTC calendar date, which misfiles evening kickoffs for anyone
    // outside UTC. from/to asks the question the viewer actually means.
    let footballCandidates: SportEvent[] = []
    let footballError: string | null = null
    if (preferences.sports.includes('football')) {
      try {
        const now = Date.now()
        const day = localDayRange(new Date(now))
        const catalog = await loadFootballCompetitions()
        const leagueById = new Map(catalog.map((league) => [league.id, league]))
        const toEvents = (raw: Awaited<ReturnType<typeof getAllEvents>>): SportEvent[] =>
          raw.map((ev) => {
            const league =
              (ev.competition_id ? leagueById.get(ev.competition_id) : undefined) ??
              fallbackFootballLeague(ev.competition_id, ev.competition_name)
            return mapNinetyEvent(ev, league)
          })

        // `country` narrows each event's `broadcasts` payload to the
        // viewer's preferred markets (a real response-size reduction on an
        // all-competitions query); it never removes an event, even when
        // none of those markets carry it — ninety-api's /v1/events country
        // filter is broadcast-narrowing only, not event-eligibility.
        const country = viewerMarkets.length > 0 ? viewerMarkets : undefined
        footballCandidates = toEvents(
          await getAllEvents({ from: new Date(now - URGENT_LOOKBACK_MS).toISOString(), to: day.toUtc, country }),
        )

        // Late in the evening "the rest of today" is legitimately empty,
        // and a Home screen with nothing coming up is a worse answer than
        // looking slightly further ahead. This second request only fires in
        // that case, and unlike the primary one it IS favorite-filtered and
        // day-bounded: it is a small courtesy fetch, not part of the
        // candidate architecture. Skipped entirely with no followed
        // competitions — an empty competition_id would be read by the
        // backend as "no filter", i.e. every tracked competition for three
        // days, which is precisely what must not happen here.
        const hasUpcoming = footballCandidates.some(
          (ev) => !ev.isLive && ev.dateTimeUtc != null && new Date(ev.dateTimeUtc).getTime() > now,
        )
        if (!hasUpcoming) {
          const followed = footballLeaguesForPreferences(preferences.footballLeagueIds, catalog)
          if (followed.length > 0) {
            const ahead = new Date(now + FALLBACK_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000).toISOString()
            const extra = toEvents(
              await getAllEvents({
                competitionId: followed.map((l) => l.id),
                from: new Date(day.endMs).toISOString(),
                to: ahead,
                country,
              }),
            )
            footballCandidates = [...footballCandidates, ...extra]
          }
        }
      } catch (err) {
        footballError = err instanceof Error ? err.message : 'Failed to load football fixtures'
      }
    }

    // Every other sport (just F1 now — see types.ts): unchanged
    // TheSportsDB per-league lookup, low enough volume that its "only
    // returns one event" limitation rarely matters. Deliberately NOT
    // day-bounded the way football is — F1 runs one weekend in three, and
    // "the next race" is the only useful thing to say about it.
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

    // ONE candidate pool, unranked and un-grouped. Which of these is live,
    // which is starting soon and which is merely on later is a question
    // about the CURRENT clock, so it is answered during derivation (below,
    // and again on every background refresh) rather than frozen here at
    // fetch time — an event fetched as "in 70 minutes" has to become
    // "starting soon" on its own, without a refetch.
    const candidates = [...footballCandidates, ...otherEventLists.flat(), ...heuristicLive]
    const eventsById = new Map<string, SportEvent>()
    for (const ev of candidates) eventsById.set(ev.id, ev)
    return { candidates, footballError, eventsById }
  }

  // Effect 1 — fetch-only, on the user's actual selection changing.
  // Deps: [fetchKey] ONLY. Deliberately excludes channels/xtream/
  // identityIndex: this effect's only job is acquiring event data from
  // ninety-api/TheSportsDB, which has nothing to do with the user's local
  // playlist — refetching fixtures because the identity index finished
  // rebuilding was the actual bug this split fixes. The ONLY place that
  // shows a loading state (see HomeFeed's own comment on EMPTY_FEED/Effect
  // 2 below) — a changed fetchKey means genuinely different data is
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
  }, [fetchKey])

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
    if (inFlightRef.current) return // an initial/fetchKey load or another silent refresh is already in flight
    inFlightRef.current = true
    const requestedFetchKey = fetchKeyRef.current
    loadRef
      .current()
      .then((data) => {
        // preferences changed while this was in flight -- Effect 1 above
        // already issued (or is about to issue) a fresher load for the new
        // selection; applying this now-stale result would fight it.
        if (fetchKeyRef.current !== requestedFetchKey) return
        // load() catches a football-fetch failure internally (see its own
        // try/catch above) and still RESOLVES, with empty candidates plus a
        // set footballError -- correct for the initial/fetchKey-driven load
        // (which has nothing better to show yet, hence 'partial' with an
        // error message), but wrong for a background refresh: applying this
        // would blank out perfectly good existing data just because one
        // transient poll failed. Treat it the same as an outright rejection
        // instead.
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
  //
  // This tick is also what keeps the feed's own time GROUPING current: a
  // 21:00 kickoff becomes "starting soon" at 20:00 without anyone pressing
  // anything, because the derivation below re-runs with a fresh clock every
  // time a refresh lands.
  //
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

  // The viewer half of ranking, rebuilt only when the actual preference
  // VALUES change — not on every render, and never as part of the fetch key
  // (changing a favorite must reorder Home instantly, with no network
  // round-trip). Learned affinity is read from local storage here, once per
  // derivation rather than once per event.
  const favoriteTeamsKey = preferences.favoriteTeamIds.join(',')
  const favoriteLeaguesKey = preferences.footballLeagueIds.join(',')
  const personalization = useMemo(() => {
    const affinity = loadWatchAffinity()
    return buildPersonalizationContext({
      favoriteTeamIds: preferences.favoriteTeamIds,
      favoriteCompetitionIds: preferences.footballLeagueIds,
      teamAffinity: affinity.teams,
      competitionAffinity: affinity.competitions,
      continuityEventId: affinity.continuityEventId,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favoriteTeamsKey, favoriteLeaguesKey, fetchState])

  const [state, setState] = useState<HomeFeedState>({ status: 'loading', feed: EMPTY_FEED, eventsById: EMPTY_EVENTS_BY_ID, refresh: silentRefresh })

  // Effect 2 — local derivation. Deps: [fetchState, personalization,
  // channels, xtream, identityIndex]. Re-runs whenever the identity index
  // (or the playlist, or a favorite) changes WITHOUT any network call.
  // Channel-matching here never sets allowNetworkFallback, so this is
  // purely local/free-stage matching (see channelMatch.ts) — safe to run
  // for every watchable-now candidate via Promise.all.
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
    const { candidates, footballError, eventsById } = fetchState.data
    ;(async () => {
      const now = Date.now()

      // WHICH EVENTS CAN THIS VIEWER ACTUALLY PLAY?
      //
      // A separate question from which are relevant, and answered only for
      // football (nothing else has broadcast data at all — see
      // channelMatch.ts) and only for events near enough to matter, which
      // keeps this bounded to a few dozen local lookups rather than the
      // whole day's fixture list.
      const nearTerm = candidates.filter((ev) => ev.sportKey === 'football' && isNearTerm(ev, now))
      const playableIds = new Set<string>(
        (
          await Promise.all(
            nearTerm.map(async (ev): Promise<string | null> => {
              try {
                const { matches } = await matchChannelsForEvent(ev, channels, xtream, identityIndex)
                return matches.length > 0 ? ev.id : null
              } catch {
                return null
              }
            }),
          )
        ).filter((id): id is string => id != null),
      )

      // A newer fetchState/channels/identityIndex has already superseded
      // this pass — never overwrite state produced for a newer generation
      // with a stale one that just finished.
      if (cancelled) return

      // A LIVE football card with nowhere to watch it defeats the point of
      // the row, so those stay out of the feed — the long-standing
      // behaviour, unchanged. Note what this does NOT do: the event is
      // still in `candidates` (so the hero can consider it, and
      // `eventsById` can still resolve it), and scheduled events are never
      // filtered this way. "We can't play it" is a presentation decision
      // about one row, not a reason to pretend the match isn't happening.
      const feedEvents = candidates.filter((ev) => !(ev.isLive && ev.sportKey === 'football' && !playableIds.has(ev.id)))

      const items = rankHomeFeed(feedEvents, personalization, now)
      // The hero ranks over the FULL candidate pool, including live events
      // with no playable stream — see selectHero: it prefers a playable
      // candidate, and falls back to showing the most relevant one as a
      // preview rather than to nothing.
      const { hero, isWatchableNow } = selectHero(candidates, personalization, now, (ev) =>
        ev.sportKey === 'football' ? playableIds.has(ev.id) : true,
      )

      const feed: HomeFeed = {
        hero,
        heroIsWatchableNow: isWatchableNow,
        heroTiming: hero ? eventTiming(hero, now) : 'unknown',
        items,
        liveNow: items.filter((item) => item.group === 'live').map((item) => item.event),
        tonight: items.filter((item) => item.group !== 'live').map((item) => item.event),
      }

      markPerf('home:local-match-end')
      measurePerf('home:local-match', 'home:local-match-start', 'home:local-match-end')

      // Why this order, itemized — see describeRanking. A ranking with this
      // many inputs cannot be calibrated from its final order alone, so the
      // full breakdown is parked on `window.__ninetyHomeRanking` (same
      // convention as devPerf.ts's __ninetyPerf) where it can be inspected
      // from a console — including Tizen's remote debugger — without any
      // logging in the ranking itself. The printed table is additionally
      // suppressed under `vitest` (MODE === 'test'), where it would bury
      // real test output; a packaged production build runs none of it.
      if (import.meta.env.DEV) {
        const explained = describeRanking(candidates, personalization, now)
        ;(window as unknown as { __ninetyHomeRanking?: unknown }).__ninetyHomeRanking = {
          now,
          hero: hero?.id ?? null,
          isWatchableNow,
          events: explained,
        }
        if (import.meta.env.MODE !== 'test') {
          console.groupCollapsed(`[home] ranking — hero: ${hero?.title ?? 'none'} (watchable: ${isWatchableNow})`)
          console.table(explained.slice(0, 12).map((row) => ({ title: row.title, timing: row.timing, ...row.breakdown })))
          console.groupEnd()
        }
      }

      if (footballError) {
        setState({ status: 'partial', feed, message: `Football fixtures unavailable: ${footballError}`, eventsById, refresh: silentRefresh })
      } else {
        setState({ status: 'ready', feed, eventsById, refresh: silentRefresh })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [fetchState, personalization, channels, xtream, identityIndex, silentRefresh])

  return state
}

// Live, or kicking off within the next few hours — the band worth spending
// a channel lookup on. Wider than the hero's own 60-minute window so a
// scheduled card the viewer might select still resolves instantly, and
// still far narrower than "every fixture today".
const NEAR_TERM_WINDOW_MS = 4 * 60 * 60 * 1000

function isNearTerm(event: SportEvent, now: number): boolean {
  if (event.isLive) return true
  if (!event.dateTimeUtc) return false
  const start = new Date(event.dateTimeUtc).getTime()
  if (Number.isNaN(start)) return false
  return start > now && start - now <= NEAR_TERM_WINDOW_MS
}
