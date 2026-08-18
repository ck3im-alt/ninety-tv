import { useEffect, useState } from 'react'
import { getAllEvents } from './ninetyApiClient'
import { mapNinetyEvent } from './mapEvent'
import type { SportEvent } from './types'
import type { LeagueDef } from './leagues'

// Must match ninety-api's /v1/events default rolling-window length (see
// its routes/events.ts) — shown in the "no fixtures found" empty state.
export const LOOKAHEAD_DAYS = 30

export interface FixtureRound {
  name: string
  fixtures: SportEvent[]
}

export type CompetitionFixturesState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rounds: FixtureRound[] }

export function useCompetitionFixtures(league: LeagueDef | null): CompetitionFixturesState {
  const [state, setState] = useState<CompetitionFixturesState>({ status: 'loading' })

  useEffect(() => {
    if (!league) {
      setState({ status: 'loading' })
      return
    }
    if (league.ninetyCompetitionId == null) {
      setState({ status: 'error', message: 'This competition has no fixture-listing source yet.' })
      return
    }
    const competitionId = league.ninetyCompetitionId
    const activeLeague = league
    let cancelled = false
    setState({ status: 'loading' })

    async function load() {
      try {
        // Filtered server-side by competition_id (ninety-api's rolling
        // upcoming window still applies) -- getAllEvents follows
        // next_cursor so a competition with more than one page of
        // fixtures still returns everything, not just the first page.
        const events = await getAllEvents({ competitionId })
        const fixtures = events
          .map((ev) => mapNinetyEvent(ev, activeLeague))
          .sort((a, b) => new Date(a.dateTimeUtc ?? 0).getTime() - new Date(b.dateTimeUtc ?? 0).getTime())

        // Grouped in the order rounds first appear in the (already
        // chronologically sorted) event list, so "Matchweek 1" naturally
        // comes before "Matchweek 2" without needing to parse round names.
        const roundOrder: string[] = []
        const byRound = new Map<string, SportEvent[]>()
        for (const ev of fixtures) {
          const roundName = ev.round ?? 'Fixtures'
          if (!byRound.has(roundName)) {
            byRound.set(roundName, [])
            roundOrder.push(roundName)
          }
          byRound.get(roundName)!.push(ev)
        }
        const rounds = roundOrder.map((name) => ({ name, fixtures: byRound.get(name)! }))
        if (!cancelled) setState({ status: 'ready', rounds })
      } catch (err) {
        if (!cancelled) {
          setState({ status: 'error', message: err instanceof Error ? err.message : 'Failed to load fixtures' })
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [league])

  return state
}
