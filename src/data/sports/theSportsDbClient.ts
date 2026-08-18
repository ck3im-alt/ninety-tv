// TheSportsDB free/community API. `3` is their published public test key
// (documented on thesportsdb.com/documentation as free to use for
// non-commercial/testing traffic) — there is no per-app registration for
// the free tier. CORS is open (`access-control-allow-origin: *`, verified
// directly against the API), so this can be called straight from the
// browser/TV runtime with no dev-proxy needed, unlike the Xtream panels.
// If usage grows beyond what the free key comfortably supports, swap this
// constant for a paid TheSportsDB Patreon key or a different provider —
// nothing else in this module needs to change.
const API_KEY = '3'
const BASE_URL = `https://www.thesportsdb.com/api/v1/json/${API_KEY}`

// Small TTL cache so switching sport filters back and forth, or the Home
// screen remounting, doesn't refire the same requests every time — polite
// to a free shared API, and avoids visible reload flicker.
const CACHE_TTL_MS = 3 * 60 * 1000
const cache = new Map<string, { data: unknown; ts: number }>()

async function getJson<T>(path: string): Promise<T> {
  const cached = cache.get(path)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data as T
  }
  const res = await fetch(`${BASE_URL}${path}`)
  if (!res.ok) throw new Error(`TheSportsDB request failed: ${res.status} ${path}`)
  const data = (await res.json()) as T
  cache.set(path, { data, ts: Date.now() })
  return data
}

export interface RawSportsDbEvent {
  idEvent: string
  strEvent: string
  strSport: string
  strLeague: string
  strLeagueBadge: string | null
  strHomeTeam: string | null
  strAwayTeam: string | null
  strHomeTeamBadge: string | null
  strAwayTeamBadge: string | null
  strVenue: string | null
  strTimestamp: string | null
  dateEvent: string | null
  strTime: string | null
  strThumb: string | null
  strBanner: string | null
  strPoster: string | null
  intRound: string | null
  strStatus: string | null
}

export async function fetchNextEventsForLeague(leagueId: string): Promise<RawSportsDbEvent[]> {
  const data = await getJson<{ events: RawSportsDbEvent[] | null }>(`/eventsnextleague.php?id=${leagueId}`)
  return data.events ?? []
}

// eventsnextleague.php only ever hands back a single fixture per league
// (confirmed above) — useless on a day where a league has several games
// (e.g. a Europa League/Conference League matchday). eventsday.php?d=&l=
// returns every fixture for that league on a given calendar date, letting
// the Home feed show all of today's games in order instead of just one.
export async function fetchEventsForLeagueOnDate(leagueId: string, dateYmd: string): Promise<RawSportsDbEvent[]> {
  const data = await getJson<{ events: RawSportsDbEvent[] | null }>(`/eventsday.php?d=${dateYmd}&l=${leagueId}`)
  return data.events ?? []
}

// eventsnextleague.php stops returning an event the moment its scheduled
// time passes (confirmed against the live API — it rolls straight to the
// following fixture, it does not keep showing an in-progress one) — so
// there is no "current" event to fetch. eventspastleague.php's most
// recent entry is the only way to find the fixture that just started, for
// the heuristic-live check in liveHeuristic.ts.
export async function fetchPastEventsForLeague(leagueId: string): Promise<RawSportsDbEvent[]> {
  const data = await getJson<{ events: RawSportsDbEvent[] | null }>(`/eventspastleague.php?id=${leagueId}`)
  return data.events ?? []
}

