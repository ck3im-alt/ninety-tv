import { useEffect, useState } from 'react'
import {
  TeamCatalogUnavailableError,
  loadTeamsForCompetition,
  loadTeamsForCompetitions,
  rememberTeams,
  type TeamDef,
} from './teamCatalog'

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
    // STALE-WHILE-REVALIDATE, and it fixes a real layout bug rather than
    // being a nicety.
    //
    // This effect re-runs every time the viewer's followed-league set
    // changes, which is every single time they tick a league. Blanking to
    // 'loading' made the picker below collapse from a grid of clubs to one
    // line of text and then back again a few milliseconds later (most of
    // these fetches are served from teamCatalog's session cache) — and
    // because onboarding's content area centres itself in the leftover
    // height, that collapse dragged EVERY row above it down and back up.
    // That was the "league row jumps and returns" bug: not a border, not a
    // font weight, not the animation — a transient loading state below the
    // thing that appeared to move.
    //
    // Keeping the last known teams on screen while the new set resolves
    // means the grid never collapses, so nothing above it can move. There
    // is genuinely nothing to keep on a first load, which is the one case
    // that still shows 'loading' — and that one is a real transition, not a
    // flicker.
    setState((prev) => (prev.status === 'ready' && prev.teams.length > 0 ? prev : { status: 'loading' }))
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

// ONE competition's clubs, fetched only when it is actually being looked at.
//
// The sibling of useTeamCatalog above, and deliberately not the same hook.
// useTeamCatalog answers "clubs from the leagues this viewer follows",
// which is a bounded set known up front. This answers "clubs from the
// competition the viewer is browsing RIGHT NOW", which is how the teams
// step lets someone reach a club from a league they did not select without
// the app fetching all ~50 competitions' rosters to offer it.
//
// Per-competition requests are already de-duplicated and cached for the
// session by teamCatalog.ts, so walking back up a rail costs nothing. The
// CALLER is responsible for not thrashing this while the viewer scrolls —
// onboarding's teams step debounces the active competition first, the same
// way the channel browser debounces its preview.
//
// `null` means "nothing is being browsed" and resolves to an empty ready
// state without a request.
export function useCompetitionTeams(competitionId: string | null): TeamCatalogState {
  const [state, setState] = useState<TeamCatalogState>(() => (competitionId ? { status: 'loading' } : READY_EMPTY))

  useEffect(() => {
    if (!competitionId) {
      setState(READY_EMPTY)
      return
    }
    let cancelled = false
    // NOT stale-while-revalidate, unlike useTeamCatalog: switching rail rows
    // changes which competition's heading is on screen, and holding the
    // previous competition's clubs under a new name would be wrong rather
    // than merely stale. The panel is a fixed height either way, so a
    // loading state here cannot move anything.
    setState({ status: 'loading' })
    loadTeamsForCompetition(competitionId)
      .then((teams) => {
        if (cancelled) return
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
  }, [competitionId])

  return state
}
