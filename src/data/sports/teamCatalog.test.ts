// The team catalogue client: the confirmed /v1/teams contract, the wire
// parameter names it has to get exactly right, and its tolerance for a
// deployment that does not serve the route yet — "the route isn't there"
// has to degrade to a quiet unavailable state rather than break onboarding.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeLocalStorage } from '../../core/storage/testFakeLocalStorage'
import {
  MIN_TEAM_SEARCH_LENGTH,
  TeamCatalogUnavailableError,
  __resetTeamCatalogForTests,
  describeSavedTeams,
  loadTeamsForCompetition,
  loadTeamsForCompetitions,
  rememberTeams,
  searchTeams,
} from './teamCatalog'

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response
}

beforeEach(() => {
  __resetTeamCatalogForTests()
  vi.stubGlobal('fetch', vi.fn())
  vi.stubGlobal('localStorage', makeFakeLocalStorage())
  vi.stubEnv('VITE_NINETY_API_URL', 'https://api.example')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loadTeamsForCompetition', () => {
  // Exactly the payload ninety-api's /v1/teams sends, field for field.
  it('requests the competition and maps the canonical payload', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        teams: [
          {
            id: 't1',
            name: 'Bodø/Glimt',
            logo: 'https://cdn/glimt.png',
            country_code: 'NO',
            domestic_competition_id: 'norway-eliteserien',
            domestic_competition_name: 'Eliteserien',
            prominence: 0.4,
          },
        ],
      }),
    )
    const teams = await loadTeamsForCompetition('norway-eliteserien')
    expect(teams).toEqual([
      {
        id: 't1',
        name: 'Bodø/Glimt',
        logo: 'https://cdn/glimt.png',
        countryCode: 'NO',
        domesticCompetitionId: 'norway-eliteserien',
        domesticCompetitionName: 'Eliteserien',
        prominence: 0.4,
      },
    ])
    const url = vi.mocked(fetch).mock.calls[0][0] as string
    expect(new URLSearchParams(url.split('?')[1]).get('competition_id')).toBe('norway-eliteserien')
  })

  // The backend sends null, not an omitted key, for what it has no record
  // of — which must not become the string "null" or an undefined name.
  it('maps the nulls a real payload carries without inventing values', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        teams: [
          {
            id: 't1',
            name: 'Some Club',
            logo: null,
            country_code: null,
            domestic_competition_id: null,
            domestic_competition_name: null,
            prominence: 0.1,
          },
        ],
      }),
    )
    const [team] = await loadTeamsForCompetition('c1')
    expect(team).toEqual({
      id: 't1',
      name: 'Some Club',
      logo: undefined,
      countryCode: null,
      domesticCompetitionId: null,
      domesticCompetitionName: null,
      prominence: 0.1,
    })
  })

  // Pre-release spellings. A current backend never sends these; a dev
  // deployment can, and two `??`s beat a picker full of blank rows.
  it('still accepts the pre-release canonical_name/logo_url spellings', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ teams: [{ id: 't1', canonical_name: 'Rosenborg', logo_url: 'x.png' }] }))
    const [team] = await loadTeamsForCompetition('c1')
    expect(team.name).toBe('Rosenborg')
    expect(team.logo).toBe('x.png')
  })

  it('accepts a bare array as well as the { teams } envelope', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([{ id: 't1', name: 'Brann' }]))
    expect((await loadTeamsForCompetition('c1')).map((t) => t.name)).toEqual(['Brann'])
  })

  it('falls back to a neutral prominence when the backend has none for a club', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ teams: [{ id: 't1', name: 'Viking' }] }))
    const [team] = await loadTeamsForCompetition('c1')
    expect(Number.isFinite(team.prominence)).toBe(true)
    expect(team.prominence).toBeGreaterThan(0)
  })

  it('drops entries with no usable id rather than rendering them', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ teams: [{ name: 'Nameless' }, { id: '', name: 'Empty' }, { id: 'ok', name: 'Fine' }] }))
    expect((await loadTeamsForCompetition('c1')).map((t) => t.name)).toEqual(['Fine'])
  })

  // The whole point of the typed error: a deployment without the route is a
  // missing FEATURE, not a failure to show the viewer.
  it('reports a 404 as the catalogue being unavailable, not as an error', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}, false, 404))
    await expect(loadTeamsForCompetition('c1')).rejects.toBeInstanceOf(TeamCatalogUnavailableError)
  })

  it('propagates a real server failure as an ordinary error', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}, false, 500))
    await expect(loadTeamsForCompetition('c1')).rejects.not.toBeInstanceOf(TeamCatalogUnavailableError)
  })

  it('caches per competition for the session', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ teams: [{ id: 't1', name: 'A' }] }))
    await loadTeamsForCompetition('c1')
    await loadTeamsForCompetition('c1')
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })

  // A transient error must not make a competition permanently unloadable.
  it('does not cache a failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}, false, 500))
    await expect(loadTeamsForCompetition('c1')).rejects.toThrow()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ teams: [{ id: 't1', name: 'A' }] }))
    expect((await loadTeamsForCompetition('c1')).map((t) => t.name)).toEqual(['A'])
  })
})

describe('loadTeamsForCompetitions', () => {
  it('merges several competitions, de-duplicated, in the requested order', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ teams: [{ id: 'a', name: 'A' }, { id: 'shared', name: 'Shared' }] }))
      .mockResolvedValueOnce(jsonResponse({ teams: [{ id: 'shared', name: 'Shared' }, { id: 'b', name: 'B' }] }))
    const teams = await loadTeamsForCompetitions(['c1', 'c2'])
    expect(teams.map((t) => t.id)).toEqual(['a', 'shared', 'b'])
  })

  // One unreachable league is a much better picker than an error screen.
  it('lets one competition fail without failing the whole picker', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({}, false, 500))
      .mockResolvedValueOnce(jsonResponse({ teams: [{ id: 'b', name: 'B' }] }))
    expect((await loadTeamsForCompetitions(['c1', 'c2'])).map((t) => t.id)).toEqual(['b'])
  })

  // ...but the endpoint not existing is a different situation, and the UI
  // has different copy for it.
  it('still reports the endpoint being missing, because that is not per-competition', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}, false, 404))
    await expect(loadTeamsForCompetitions(['c1'])).rejects.toBeInstanceOf(TeamCatalogUnavailableError)
  })

  it('makes no request at all with nothing to load', async () => {
    expect(await loadTeamsForCompetitions([])).toEqual([])
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })
})

describe('searchTeams', () => {
  // The parameter ninety-api actually parses is `q`. Sending `search`
  // instead does not fail loudly — an unfiltered page comes back and the
  // local filter below makes it look like search works — so this asserts
  // the URL, not the results.
  it('sends the query as q=, not as search=', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ teams: [{ id: 't1', name: 'Arsenal' }] }))
    expect((await searchTeams('arse')).map((t) => t.name)).toEqual(['Arsenal'])
    const query = new URLSearchParams((vi.mocked(fetch).mock.calls[0][0] as string).split('?')[1])
    expect(query.get('q')).toBe('arse')
    expect(query.has('search')).toBe(false)
  })

  it('passes the result limit through', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ teams: [] }))
    await searchTeams('manchester', 60)
    const query = new URLSearchParams((vi.mocked(fetch).mock.calls[0][0] as string).split('?')[1])
    expect(query.get('q')).toBe('manchester')
    expect(query.get('limit')).toBe('60')
  })

  // The local filter is a safety net for an older backend that ignores the
  // parameter, not the mechanism — the backend does the real matching.
  it('filters locally too, so an unfiltered response still looks filtered', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ teams: [{ id: 't1', name: 'Arsenal' }, { id: 't2', name: 'Chelsea' }] }),
    )
    expect((await searchTeams('arse')).map((t) => t.name)).toEqual(['Arsenal'])
  })

  it('makes no request for an empty query', async () => {
    expect(await searchTeams('   ')).toEqual([])
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  // ninety-api 400s a one-character q. Firing it anyway would turn "typed
  // the first letter" into an error state on screen.
  it('makes no request below the backend minimum query length', async () => {
    expect(MIN_TEAM_SEARCH_LENGTH).toBe(2)
    expect(await searchTeams('m')).toEqual([])
    expect(await searchTeams(' m ')).toEqual([])
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('does request as soon as the query reaches the minimum', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ teams: [] }))
    await searchTeams('ma')
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })
})

describe('the display cache', () => {
  it('remembers names and crests so Settings can label saved favorites with no round-trip', () => {
    rememberTeams([{ id: 't1', name: 'Manchester United', logo: 'mu.png', prominence: 0.9 }])
    expect(describeSavedTeams(['t1'])).toEqual([{ id: 't1', name: 'Manchester United', logo: 'mu.png' }])
  })

  // Identity is the id; a missing label degrades to a neutral placeholder,
  // never to matching the wrong club.
  it('falls back to a neutral label for an id it has never seen, not to the raw id', () => {
    const [described] = describeSavedTeams(['t_unknown'])
    expect(described.id).toBe('t_unknown')
    expect(described.name).not.toContain('t_unknown')
  })

  it('preserves the order the preference stores', () => {
    rememberTeams([
      { id: 'a', name: 'A', prominence: 0.5 },
      { id: 'b', name: 'B', prominence: 0.5 },
    ])
    expect(describeSavedTeams(['b', 'a']).map((t) => t.name)).toEqual(['B', 'A'])
  })

  it('survives unparseable storage', () => {
    localStorage.setItem('ninety.knownTeams', 'not json')
    expect(() => describeSavedTeams(['a'])).not.toThrow()
  })
})
