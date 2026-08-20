import { useEffect, useState } from 'react'
import { loadFootballCompetitions } from './competitionsCatalog'
import type { LeagueDef } from './leagues'

export type FootballCompetitionsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; leagues: LeagueDef[] }

// React wrapper around competitionsCatalog.ts's cached fetch -- used by
// screens that render the competition list (CompetitionsScreen,
// OnboardingSportsScreen). Multiple mounted consumers share the same
// underlying cache/in-flight request, so this is cheap to call from more
// than one component.
export function useFootballCompetitions(): FootballCompetitionsState {
  const [state, setState] = useState<FootballCompetitionsState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    loadFootballCompetitions()
      .then((leagues) => {
        if (!cancelled) setState({ status: 'ready', leagues })
      })
      .catch((err) => {
        if (!cancelled) setState({ status: 'error', message: err instanceof Error ? err.message : 'Failed to load competitions' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return state
}
