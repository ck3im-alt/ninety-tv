import { useEffect, useState } from 'react'
import { getAllEvents } from './ninetyApiClient'
import { loadFootballCompetitions } from './competitionsCatalog'
import { mapNinetyEvent } from './mapEvent'
import { localDayRange, isWithinLocalDay } from './localDay'
import { fallbackFootballLeague } from './leagues'
import type { SportEvent } from './types'

export type TodaysScheduleState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; fixtures: SportEvent[] }

// Every football fixture Ninety knows about for the VIEWER'S local calendar
// day — deliberately unfiltered by the user's followed competitions, because
// the question this screen answers is "what football is on today", not "what
// of my selection is on today". Preferences only affect ORDER, and that
// happens later (scheduleRanking.ts), never here.
//
// One request set, not one per competition: /v1/events with no competition_id
// returns every tracked competition, and getAllEvents follows next_cursor so
// a busy Saturday spanning several pages still comes back whole. The old
// per-competition screen could get away with a single narrow query; an
// all-competitions day view would be ~50 round trips if it kept that shape.
//
// The window is from/to rather than `date`, because ninety-api's `date`
// filter compares the UTC calendar date — see localDay.ts for why that is
// the wrong question for anyone outside UTC. isWithinLocalDay then re-checks
// each fixture locally, so the day boundary holds regardless of how the
// backend treats the ends of the range.
//
// No `country` narrowing is applied. useHomeFeed passes viewer markets to
// shrink each event's `broadcasts` payload, but events opened from here go
// straight to Event Details, which ranks streams out of exactly that array —
// narrowing it would quietly reduce what Event Details can offer for a
// Schedule-opened fixture. One day of events is a small enough response to
// take unnarrowed.
export function useTodaysSchedule(): TodaysScheduleState {
  const [state, setState] = useState<TodaysScheduleState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })

    async function load() {
      const range = localDayRange()
      try {
        const [catalog, events] = await Promise.all([
          loadFootballCompetitions(),
          getAllEvents({ from: range.fromUtc, to: range.toUtc }),
        ])
        const leagueById = new Map(catalog.map((league) => [league.id, league]))
        const fixtures = events
          .filter((ev) => isWithinLocalDay(ev.start_time_utc, range))
          .map((ev) => {
            const league = (ev.competition_id ? leagueById.get(ev.competition_id) : undefined) ?? fallbackFootballLeague(ev.competition_id, ev.competition_name)
            return mapNinetyEvent(ev, league)
          })
        if (!cancelled) setState({ status: 'ready', fixtures })
      } catch (err) {
        if (!cancelled) {
          setState({ status: 'error', message: err instanceof Error ? err.message : 'Failed to load schedule' })
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return state
}
