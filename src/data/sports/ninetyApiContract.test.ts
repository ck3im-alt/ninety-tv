import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getChannelCatalog, getCompetitions, getEvents, getTeams } from './ninetyApiClient'

// CLIENT/SERVER CONTRACT PINNING.
//
// A parameter-name mismatch against ninety-api is SILENT. It does not 4xx
// and it does not throw: the route simply ignores the parameter it does not
// recognise and answers 200 with an unfiltered result, which the TV then
// renders as if it were the answer to the question it asked.
//
// That is not hypothetical. `GET /v1/teams` takes `q`; the TV sent `search`
// (fixed in ac2b77f). Verified against a real ninety-api instance during
// the pre-beta pass:
//
//   /v1/teams?q=ars       -> filtered
//   /v1/teams?search=ars  -> 200, EVERY team, unfiltered
//
// So the favourite-team picker showed an arbitrary page of clubs and any
// club past the first page was unreachable — with nothing anywhere
// reporting an error.
//
// These tests pin the exact wire names against ninety-api's route handlers
// as they are today (src/routes/{events,teams,leagues,channels}.ts):
//
//   GET /v1/events           date, country, competition_id, team_id, from, to, limit, cursor
//   GET /v1/teams            competition_id, q, limit
//   GET /v1/competitions     (no parameters)
//   GET /v1/channels/catalog country
//
// Deliberately cheap and explicit rather than generated: this repo has no
// OpenAPI/shared-schema infrastructure, and introducing one for four routes
// would be a bigger, riskier change than the mismatch it prevents.
//
// IF ONE OF THESE FAILS, check ninety-api's route handler before changing
// the expectation. The handler is the contract; this file is only a copy of
// it.

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response
}

function requestedUrl(call = 0): URL {
  return new URL(vi.mocked(fetch).mock.calls[call][0] as string)
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  vi.stubEnv('VITE_NINETY_API_URL', 'https://api.example')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('GET /v1/events — parameter names', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ events: [], pagination: { has_more: false, next_cursor: null } }))
  })

  it('hits the /v1/events path', async () => {
    await getEvents()
    expect(requestedUrl().pathname).toBe('/v1/events')
  })

  it('sends competition_id (snake_case), not competitionId', async () => {
    await getEvents({ competitionId: 'football_premier_league' })
    const q = requestedUrl().searchParams
    expect(q.get('competition_id')).toBe('football_premier_league')
    expect(q.has('competitionId')).toBe(false)
  })

  it('sends several competitions comma-separated in ONE parameter', async () => {
    await getEvents({ competitionId: ['a', 'b', 'c'] })
    // ninety-api splits on ',' — repeated params would be read as one value.
    expect(requestedUrl().searchParams.getAll('competition_id')).toEqual(['a,b,c'])
  })

  it('sends country comma-separated, the broadcast-market narrowing parameter', async () => {
    await getEvents({ country: ['NO', 'SE'] })
    expect(requestedUrl().searchParams.getAll('country')).toEqual(['NO,SE'])
  })

  it('sends date/from/to/limit/cursor under exactly those names', async () => {
    await getEvents({ date: '2026-08-27', from: '2026-08-27', to: '2026-08-28', limit: 50, cursor: 'abc' })
    const q = requestedUrl().searchParams
    expect(q.get('date')).toBe('2026-08-27')
    expect(q.get('from')).toBe('2026-08-27')
    expect(q.get('to')).toBe('2026-08-28')
    expect(q.get('limit')).toBe('50')
    expect(q.get('cursor')).toBe('abc')
  })

  it('sends no query string at all when unfiltered — the rolling upcoming window', async () => {
    await getEvents()
    expect(requestedUrl().search).toBe('')
  })

  // "Empty means unfiltered, never means filter-to-nothing" is ninety-api's
  // documented rule; sending an empty value would be a pointless parameter.
  it('omits an empty competition/country rather than sending a blank value', async () => {
    await getEvents({ competitionId: [], country: [] })
    expect(requestedUrl().search).toBe('')
  })
})

describe('GET /v1/teams — the parameter that already broke once', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ teams: [] }))
  })

  it('sends the free-text lookup as q — NOT search', async () => {
    await getTeams({ search: 'arsenal' })
    const q = requestedUrl().searchParams
    expect(q.get('q')).toBe('arsenal')
    // The regression itself. `search` is ignored by the route, which then
    // answers 200 with an unfiltered page.
    expect(q.has('search')).toBe(false)
  })

  it('hits the /v1/teams path', async () => {
    await getTeams()
    expect(requestedUrl().pathname).toBe('/v1/teams')
  })

  it('sends competition_id and limit under exactly those names', async () => {
    await getTeams({ competitionId: ['football_premier_league', 'norway-eliteserien'], limit: 200 })
    const q = requestedUrl().searchParams
    expect(q.get('competition_id')).toBe('football_premier_league,norway-eliteserien')
    expect(q.get('limit')).toBe('200')
  })
})

describe('GET /v1/competitions and /v1/channels/catalog', () => {
  it('requests competitions with no parameters', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ competitions: [] }))
    await getCompetitions()
    const url = requestedUrl()
    expect(url.pathname).toBe('/v1/competitions')
    expect(url.search).toBe('')
  })

  it('requests the channel catalog with an optional country filter', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ version: '1', channels: [] }))
    await getChannelCatalog({ country: 'NO' })
    const url = requestedUrl()
    expect(url.pathname).toBe('/v1/channels/catalog')
    expect(url.searchParams.get('country')).toBe('NO')
  })
})

// The compatibility rule that lets a TV build ship against a backend that
// predates a field. Absent is NOT the same as "no", and must never be read
// as one — see NinetyEvent's personalization/broadcast-availability blocks.
describe('backward compatibility with an older backend', () => {
  it('parses an event payload with none of the newer optional fields', async () => {
    vi.stubGlobal('fetch', vi.fn())
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        events: [
          {
            id: 'e1',
            start_time_utc: '2026-08-27T18:00:00Z',
            status: 'scheduled',
            home_score: null,
            away_score: null,
            round_code: null,
            competition_id: 'football_premier_league',
            competition_name: 'Premier League',
            home_team_name: 'A',
            home_team_logo: null,
            home_team_form: null,
            away_team_name: 'B',
            away_team_logo: null,
            away_team_form: null,
            venue_name: null,
            broadcasts: [],
          },
        ],
        pagination: { has_more: false, next_cursor: null },
      }),
    )
    const page = await getEvents()
    const event = page.events[0]
    expect(event.id).toBe('e1')
    expect(event.broadcast_availability).toBeUndefined()
    expect(event.home_team_id).toBeUndefined()
  })
})
