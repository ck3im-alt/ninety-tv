import { useEffect, useMemo, useRef, useState } from 'react'
import { getAllEvents } from './ninetyApiClient'
import { loadFootballCompetitions } from './competitionsCatalog'
import { mapNinetyEvent } from './mapEvent'
import { localDayRangeOffset, isWithinLocalDay } from './localDay'
import { fallbackFootballLeague, type LeagueDef } from './leagues'
import type { SportEvent } from './types'

// Every football fixture Ninety knows about for ONE of the viewer's local
// calendar days, plus the canonical competition metadata for the
// competitions those fixtures belong to.
//
// `competitions` is keyed by the same id SportEvent.leagueId carries, and is
// how the Schedule screen labels a section "England – Premier League" with a
// real flag: region/countryCode/badge are competition facts (GET
// /v1/competitions), not event facts, so they are carried ALONGSIDE the
// fixtures rather than copied onto every SportEvent. The catalog is already
// fetched here to map events; exposing the resolved LeagueDefs costs one
// Map and keeps SportEvent from growing two fields that only one screen
// reads. Fixtures whose competition the catalog does not know get their
// synthesized fallback entry (see fallbackFootballLeague) — every group can
// therefore always find its competition, even an unknown one.
export interface ScheduleDayData {
  fixtures: SportEvent[]
  competitions: ReadonlyMap<string, LeagueDef>
}

export type ScheduleDayState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | ({ status: 'ready' } & ScheduleDayData)

// What `dayOffset` means, and the one boundary the product enforces:
// Schedule browses forward indefinitely but only ONE day back. Yesterday is
// still useful (last night's results), the day before that is history, and
// the events window is not an archive. Owned here rather than in the screen
// so the hook can never be asked for a day the product does not offer.
export const MIN_SCHEDULE_DAY_OFFSET = -1

export function canGoToPreviousScheduleDay(dayOffset: number): boolean {
  return dayOffset > MIN_SCHEDULE_DAY_OFFSET
}

// GENERALISED FROM useTodaysSchedule (which this replaces outright — there
// is deliberately no parallel "today" implementation left). Everything that
// hook got right is unchanged; only the day is now a parameter:
//
//   - ONE request set, not one per competition. /v1/events with no
//     competition_id returns every tracked competition, and getAllEvents
//     follows next_cursor so a busy Saturday spanning several pages still
//     comes back whole.
//   - The window is from/to rather than `date`, because ninety-api's `date`
//     filter compares the UTC calendar date — see localDay.ts for why that
//     is the wrong question for anyone outside UTC. isWithinLocalDay then
//     re-checks each fixture locally, so the day boundary holds regardless
//     of how the backend treats the ends of the range.
//   - NO filtering by followed competitions. The question this screen
//     answers is "what football is on", not "what of my selection is on".
//     Preferences only affect ORDER, and that happens later
//     (scheduleRanking.ts), never here.
//   - NO `country` narrowing. useHomeFeed passes viewer markets to shrink
//     each event's `broadcasts` payload, but events opened from here go
//     straight to Event Details, which ranks streams out of exactly that
//     array — narrowing it would quietly reduce what Event Details can offer
//     for a Schedule-opened fixture.
//
// VISITED DAYS ARE CACHED FOR THE LIFE OF THE HOOK, and no further: the ref
// below dies with the screen, so this is a "while you are browsing" cache,
// not a global layer with an invalidation story. Today -> Tomorrow -> Today
// therefore repaints instantly instead of re-fetching. The key is the day's
// own local-midnight instant rather than the offset, so a session left open
// across midnight cannot serve yesterday's fixtures as "today".
export function useScheduleDay(dayOffset: number): ScheduleDayState {
  const cacheRef = useRef<Map<number, ScheduleDayData> | null>(null)
  if (!cacheRef.current) cacheRef.current = new Map()
  const cache = cacheRef.current

  // One instant per requested day, taken at the moment the day changes —
  // not per render, which would make it a new object every time and re-fire
  // the effect forever.
  const range = useMemo(() => localDayRangeOffset(dayOffset), [dayOffset])
  const [loaded, setLoaded] = useState<{ startMs: number; state: ScheduleDayState } | null>(null)

  useEffect(() => {
    if (cache.has(range.startMs)) return
    let cancelled = false

    async function load() {
      try {
        const [catalog, events] = await Promise.all([
          loadFootballCompetitions(),
          getAllEvents({ from: range.fromUtc, to: range.toUtc }),
        ])
        const leagueById = new Map(catalog.map((league) => [league.id, league]))
        const competitions = new Map<string, LeagueDef>()
        const fixtures = events
          .filter((ev) => isWithinLocalDay(ev.start_time_utc, range))
          .map((ev) => {
            const league =
              (ev.competition_id ? leagueById.get(ev.competition_id) : undefined) ??
              fallbackFootballLeague(ev.competition_id, ev.competition_name)
            competitions.set(league.id, league)
            return mapNinetyEvent(ev, league)
          })
        const data: ScheduleDayData = { fixtures, competitions }
        // Cached even when cancelled: the work is done and correct, and the
        // day it belongs to is identified by its own instant, so a viewer
        // who steps past a day and back gets it for free.
        cache.set(range.startMs, data)
        if (!cancelled) setLoaded({ startMs: range.startMs, state: { status: 'ready', ...data } })
      } catch (err) {
        // Failures are deliberately NOT cached — coming back to a day that
        // failed must retry rather than replay the error forever.
        if (!cancelled) {
          setLoaded({
            startMs: range.startMs,
            state: { status: 'error', message: err instanceof Error ? err.message : 'Failed to load schedule' },
          })
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [cache, range])

  // Read during RENDER, not from an effect: a cache hit must paint the
  // already-known day on the very first frame after the date changes. Going
  // through state would render one frame of the loading skeleton first,
  // which is exactly the flicker the cache exists to remove.
  const cached = cache.get(range.startMs)
  if (cached) return { status: 'ready', ...cached }
  if (loaded && loaded.startMs === range.startMs) return loaded.state
  return { status: 'loading' }
}
