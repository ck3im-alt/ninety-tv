import { useEffect, useState } from 'react'
import { MIN_TEAM_SEARCH_LENGTH, TeamCatalogUnavailableError, rememberTeams, searchTeams, type TeamDef } from './teamCatalog'

// Free-text team lookup for the Settings picker's search field.
//
// Separate from useTeamCatalog because the two answer different questions
// and fail differently: browsing is scoped to the viewer's followed
// competitions and is cached for the session; searching is unscoped,
// uncached (a query is typed one character at a time) and is the ONLY way
// to reach a club outside those competitions.
//
// 'unavailable' means this Ninety backend has no /v1/teams route. The
// picker then says so and points at browsing, which still works for
// everything in a followed league — search degrading must never look like
// "there is no such club".
export type TeamSearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'unavailable' }
  | { status: 'ready'; teams: TeamDef[] }

const IDLE: TeamSearchState = { status: 'idle' }

// `query` is expected to be ALREADY debounced by the caller — the field
// owns its own typing cadence (see TeamPickerDialog's useDebouncedValue),
// this hook just runs whatever it is handed.
//
// Anything shorter than MIN_TEAM_SEARCH_LENGTH stays 'idle' rather than
// becoming 'loading' or 'error': the backend answers a one-character `q`
// with a 400, and typing the first letter of a club's name is not a
// mistake to be reported back to the viewer.
export function useTeamSearch(query: string): TeamSearchState {
  const [state, setState] = useState<TeamSearchState>(IDLE)

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < MIN_TEAM_SEARCH_LENGTH) {
      setState(IDLE)
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    searchTeams(trimmed)
      .then((teams) => {
        if (cancelled) return
        // A club found by search can be followed straight from the results,
        // so its name/crest has to be remembered too — otherwise Settings
        // would show it as an unnamed followed team next time it opens.
        rememberTeams(teams)
        setState({ status: 'ready', teams })
      })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof TeamCatalogUnavailableError) {
          setState({ status: 'unavailable' })
          return
        }
        setState({ status: 'error', message: err instanceof Error ? err.message : 'Search failed' })
      })
    return () => {
      cancelled = true
    }
  }, [query])

  return state
}
