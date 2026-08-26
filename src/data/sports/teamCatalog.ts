// Ninety's canonical team catalogue, as the TV consumes it.
//
// The one place that talks to GET /v1/teams, so no component ever calls
// fetch() for a club list — same shape as competitionsCatalog.ts, which
// does the same job for competitions.
//
// TOLERANT BY DESIGN. This client is being written while the endpoint it
// calls is being written, in the other repo, in parallel. So:
//
//   - a 404/501 (a ninety-api deployment that predates the route) is
//     reported as UNAVAILABLE, not as an error. The team picker shows a
//     quiet "not available yet" state and onboarding continues; following
//     teams is optional and must never be able to block first-run setup.
//   - the payload's field names are accepted in either of the two plausible
//     spellings (`name`/`canonical_name`, `logo_url`/`logo`). Guessing
//     wrong here would ship a picker full of blank rows; two extra `??`s
//     cost nothing.
//   - a team with no prominence on record gets the same neutral value the
//     ranking uses, so suggestion ordering degrades to "alphabetical-ish"
//     rather than to nonsense.
import { getTeams, isEndpointUnavailable, type NinetyTeam } from './ninetyApiClient'
import { NEUTRAL_PROMINENCE } from './homePersonalization'
import { readStored, writeStored } from '../../core/storage/localStore'

export interface TeamDef {
  // The canonical ninety-api team id. THE identity — the only thing ever
  // persisted in SportPreferences.favoriteTeamIds, and the only thing
  // compared against SportEvent.homeTeamId/awayTeamId.
  id: string
  name: string
  logo?: string
  countryCode?: string | null
  // Which competition this club plays its league football in. Used to group
  // the picker and to decide which clubs to suggest for a followed league.
  domesticCompetitionId?: string | null
  // 0..1. Never undefined here (unlike on SportEvent, where "absent" has to
  // stay distinguishable for scoring): a picker only needs an order, and a
  // neutral value gives it a defined one.
  prominence: number
}

export class TeamCatalogUnavailableError extends Error {
  constructor() {
    super('Team catalogue is not available from this Ninety backend yet')
    this.name = 'TeamCatalogUnavailableError'
  }
}

function toTeamDef(team: NinetyTeam): TeamDef {
  return {
    id: team.id,
    name: team.name ?? team.canonical_name ?? team.id,
    logo: team.logo_url ?? team.logo ?? undefined,
    countryCode: team.country_code ?? null,
    domesticCompetitionId: team.domestic_competition_id ?? null,
    prominence: typeof team.prominence === 'number' && Number.isFinite(team.prominence) ? team.prominence : NEUTRAL_PROMINENCE,
  }
}

// Accepts `{ teams: [...] }` (the convention every other Ninety endpoint
// follows) and tolerates a bare array, so a backend that ships the simpler
// shape doesn't render an empty picker with no explanation.
function toTeamDefs(payload: unknown): TeamDef[] {
  const raw = Array.isArray(payload) ? payload : ((payload as { teams?: NinetyTeam[] } | null)?.teams ?? [])
  return raw.filter((team): team is NinetyTeam => typeof team?.id === 'string' && team.id.length > 0).map(toTeamDef)
}

async function request(params: Parameters<typeof getTeams>[0]): Promise<TeamDef[]> {
  try {
    return toTeamDefs(await getTeams(params))
  } catch (err) {
    if (isEndpointUnavailable(err)) throw new TeamCatalogUnavailableError()
    throw err
  }
}

// Cached per competition for the session, and de-duplicated across
// concurrent callers — onboarding's suggestions and its browser panel ask
// for overlapping sets, and a viewer moving through the competition rail
// would otherwise refetch a league they already looked at. The catalogue
// only changes on a Ninety deploy, so one fetch per competition per session
// is correct rather than stale.
const byCompetition = new Map<string, Promise<TeamDef[]>>()

export function loadTeamsForCompetition(competitionId: string): Promise<TeamDef[]> {
  const cached = byCompetition.get(competitionId)
  if (cached) return cached
  const inFlight = request({ competitionId }).catch((err) => {
    // Never cache a failure: a transient network error must not leave this
    // competition permanently unloadable for the rest of the session.
    byCompetition.delete(competitionId)
    throw err
  })
  byCompetition.set(competitionId, inFlight)
  return inFlight
}

// Several competitions at once, de-duplicated by team id (a club can
// legitimately be returned for more than one competition). Order follows
// the requested competitions, so a caller can rely on "my first league's
// clubs come first".
//
// One competition failing does NOT fail the whole call — an unreachable
// league simply contributes nothing, which is a much better picker than an
// error screen. The exception is the endpoint being missing entirely, which
// is a different situation and is reported as such.
export async function loadTeamsForCompetitions(competitionIds: readonly string[]): Promise<TeamDef[]> {
  if (competitionIds.length === 0) return []
  const results = await Promise.all(
    competitionIds.map(async (id) => {
      try {
        return await loadTeamsForCompetition(id)
      } catch (err) {
        if (err instanceof TeamCatalogUnavailableError) throw err
        return []
      }
    }),
  )
  const seen = new Set<string>()
  const teams: TeamDef[] = []
  for (const team of results.flat()) {
    if (seen.has(team.id)) continue
    seen.add(team.id)
    teams.push(team)
  }
  return teams
}

// Free-text lookup, for the picker's search field. Deliberately NOT cached:
// a query is typed one character at a time and caching every prefix would
// be pure waste.
//
// The local `filter` is a safety net, not the mechanism: if the backend
// ignores `search` and returns an unfiltered page, the viewer still sees a
// filtered list rather than a thousand unrelated clubs.
export async function searchTeams(query: string, limit = 60): Promise<TeamDef[]> {
  const trimmed = query.trim()
  if (!trimmed) return []
  const teams = await request({ search: trimmed, limit })
  const needle = trimmed.toLowerCase()
  return teams.filter((team) => team.name.toLowerCase().includes(needle)).slice(0, limit)
}

// ---------------------------------------------------------------------------
// DISPLAY CACHE
// ---------------------------------------------------------------------------

const KNOWN_TEAMS_KEY = 'ninety.knownTeams'
const MAX_KNOWN_TEAMS = 200

interface KnownTeam {
  id: string
  name: string
  logo?: string
}

// Names and crests for teams the viewer has actually followed, remembered
// locally so Settings can render "Manchester United · Bodø/Glimt" the
// instant it opens instead of after a network round-trip (or not at all,
// against a backend with no /v1/teams).
//
// THIS IS A LABEL CACHE, NOT IDENTITY. The preference itself is still a
// list of canonical ids and nothing else; this only answers "what do I call
// id X on screen". A stale or missing label degrades to showing the id's
// team as unnamed, never to matching the wrong club — which is exactly the
// failure mode storing names as the preference would have.
export function rememberTeams(teams: readonly TeamDef[]): void {
  if (teams.length === 0) return
  const known = readKnownTeams()
  for (const team of teams) known.set(team.id, { id: team.id, name: team.name, logo: team.logo })
  const entries = [...known.values()].slice(-MAX_KNOWN_TEAMS)
  writeStored<KnownTeam[]>(KNOWN_TEAMS_KEY, entries)
}

function readKnownTeams(): Map<string, KnownTeam> {
  const stored = readStored<KnownTeam[]>(KNOWN_TEAMS_KEY, [])
  if (!Array.isArray(stored)) return new Map()
  return new Map(
    stored.filter((team) => typeof team?.id === 'string' && typeof team?.name === 'string').map((team) => [team.id, team]),
  )
}

// Best-known display form for a saved favorite. Falls back to a neutral
// placeholder rather than the raw id, which would read as a bug on screen.
export function describeSavedTeams(teamIds: readonly string[]): { id: string; name: string; logo?: string }[] {
  const known = readKnownTeams()
  return teamIds.map((id) => known.get(id) ?? { id, name: 'Followed team' })
}

// Test-only — production never needs to invalidate the session cache.
export function __resetTeamCatalogForTests(): void {
  byCompetition.clear()
}
