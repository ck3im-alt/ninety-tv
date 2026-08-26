import { useEffect, useState } from 'react'
import { TeamCatalogUnavailableError, loadTeamsForCompetitions, rememberTeams, type TeamDef } from './teamCatalog'

// React wrapper around teamCatalog.ts's cached fetch, used by both team
// pickers (onboarding step 2 and Settings).
//
// FOUR STATES, NOT THREE. 'unavailable' is deliberately distinct from
// 'error': it means this Ninety backend has no /v1/teams route yet, which
// is a temporary fact about the deployment rather than something that went
// wrong, and the two want different copy. Neither is ever fatal — following
// teams is optional, so a picker that can't load must degrade to a quiet
// explanatory line and let the viewer carry on, never block Continue.
export type TeamCatalogState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'unavailable' }
  | { status: 'ready'; teams: TeamDef[] }

// Stable empty result for the "nothing selected yet" case, so a consumer's
// memos don't see a new array identity on every render.
const NO_TEAMS: TeamDef[] = []
const READY_EMPTY: TeamCatalogState = { status: 'ready', teams: NO_TEAMS }

// `competitionIds` is joined into the effect key rather than used directly:
// callers build it from a Set of followed leagues, which is a fresh array
// every render.
export function useTeamCatalog(competitionIds: readonly string[]): TeamCatalogState {
  const key = competitionIds.join(',')
  const [state, setState] = useState<TeamCatalogState>(() => (competitionIds.length === 0 ? READY_EMPTY : { status: 'loading' }))

  useEffect(() => {
    const ids = key ? key.split(',') : []
    if (ids.length === 0) {
      setState(READY_EMPTY)
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    loadTeamsForCompetitions(ids)
      .then((teams) => {
        if (cancelled) return
        // Remember names/crests for everything the viewer can see, so a
        // later Settings visit can label their saved favorites without a
        // round-trip — see teamCatalog.ts's display cache.
        rememberTeams(teams)
        setState({ status: 'ready', teams })
      })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof TeamCatalogUnavailableError) {
          setState({ status: 'unavailable' })
          return
        }
        setState({ status: 'error', message: err instanceof Error ? err.message : 'Failed to load teams' })
      })
    return () => {
      cancelled = true
    }
  }, [key])

  return state
}
