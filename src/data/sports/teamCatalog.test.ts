// The team catalogue client, and specifically its tolerance: it is written
// against an endpoint that is being built in the other repo at the same
// time, so "the route isn't there yet" and "the field is spelled the other
// way" both have to degrade rather than break.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeLocalStorage } from '../../core/storage/testFakeLocalStorage'
import {
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
  it('requests the competition and maps the canonical payload', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        teams: [
          {
            id: 't1',
            name: 'Bodø/Glimt',
            logo_url: 'https://cdn/glimt.png',
            country_code: 'NO',
            domestic_competition_id: 'norway_eliteserien',
            prominence: 0.4,
          },
        ],
      }),
    )
    const teams = await loadTeamsForCompetition('norway_eliteserien')
    expect(teams).toEqual([
      {
        id: 't1',
        name: 'Bodø/Glimt',
        logo: 'https://cdn/glimt.png',
        countryCode: 'NO',
        domesticCompetitionId: 'norway_eliteserien',
        prominence: 0.4,
      },
    ])
    const url = vi.mocked(fetch).mock.calls[0][0] as string
    expect(new URLSearchParams(url.split('?')[1]).get('competition_id')).toBe('norway_eliteserien')
  })

  // Written against a spec that had not shipped — accepting both spellings
  // costs two `??`s and avoids a picker full of blank rows.
  it('accepts canonical_name/logo as alternative field spellings', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ teams: [{ id: 't1', canonical_name: 'Rosenborg', logo: 'x.png' }] }))
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
  it('forwards the query and returns matches', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ teams: [{ id: 't1', name: 'Arsenal' }] }))
    expect((await searchTeams('arse')).map((t) => t.name)).toEqual(['Arsenal'])
    const url = vi.mocked(fetch).mock.calls[0][0] as string
    expect(new URLSearchParams(url.split('?')[1]).get('search')).toBe('arse')
  })

  // The local filter is a safety net for a backend that ignores `search`.
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
