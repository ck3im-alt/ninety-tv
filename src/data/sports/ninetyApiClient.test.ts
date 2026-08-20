import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAllEvents, getCompetitions, getEvents } from './ninetyApiClient'

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

describe('ninetyApiClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.stubEnv('VITE_NINETY_API_URL', 'https://api.example')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('getEvents forwards competition_id/from/to/limit/cursor as query params', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ events: [], pagination: { has_more: false, next_cursor: null } }),
    )
    await getEvents({ competitionId: 'comp-1', from: '2026-08-20', to: '2026-08-21', limit: 10, cursor: 'abc' })
    const url = vi.mocked(fetch).mock.calls[0][0] as string
    const query = new URLSearchParams(url.split('?')[1])
    expect(query.get('competition_id')).toBe('comp-1')
    expect(query.get('from')).toBe('2026-08-20')
    expect(query.get('to')).toBe('2026-08-21')
    expect(query.get('limit')).toBe('10')
    expect(query.get('cursor')).toBe('abc')
  })

  it('getAllEvents follows next_cursor until has_more is false', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          events: [{ id: 'a' }, { id: 'b' }],
          pagination: { has_more: true, next_cursor: 'cursor-1' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          events: [{ id: 'c' }],
          pagination: { has_more: false, next_cursor: null },
        }),
      )

    const events = await getAllEvents({ competitionId: 'comp-1' })
    expect(events.map((e) => e.id)).toEqual(['a', 'b', 'c'])
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)

    const secondUrl = vi.mocked(fetch).mock.calls[1][0] as string
    expect(new URLSearchParams(secondUrl.split('?')[1]).get('cursor')).toBe('cursor-1')
  })

  it('getAllEvents stops after a single page when has_more is false', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ events: [{ id: 'a' }], pagination: { has_more: false, next_cursor: null } }),
    )
    const events = await getAllEvents()
    expect(events.map((e) => e.id)).toEqual(['a'])
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })

  it('getCompetitions calls GET /v1/competitions with no query params', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ competitions: [] }))
    await getCompetitions()
    const url = vi.mocked(fetch).mock.calls[0][0] as string
    expect(url.endsWith('/v1/competitions')).toBe(true)
  })

  it('getCompetitions returns the competitions array from the response', async () => {
    const competition = {
      id: 'football_premier_league',
      name: 'Premier League',
      country_code: 'GB',
      region: 'England',
      type: 'league',
      tier: 1,
      badge_url: 'https://footballdata.io/img/league/england-premier-league.png',
      footballdata_league_id: 15,
    }
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ competitions: [competition] }))
    const result = await getCompetitions()
    expect(result.competitions).toEqual([competition])
  })

  it('getCompetitions resolves cleanly with an empty array (not an error)', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ competitions: [] }))
    const result = await getCompetitions()
    expect(result.competitions).toEqual([])
  })

  // getJson (the shared fetch wrapper behind every ninetyApiClient call,
  // including getCompetitions) has its failure paths exercised here --
  // resilience further up the stack (competitionsCatalog.ts not caching a
  // failed fetch, useFootballCompetitions/useHomeFeed surfacing a
  // 'partial'/'error' status instead of silently treating it as "zero
  // competitions") all depend on this actually rejecting cleanly rather
  // than resolving with something malformed.
  describe('getJson failure paths (via getCompetitions)', () => {
    it('a non-2xx response rejects with a clear error, not a malformed success value', async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: 'Internal Server Error' }, false, 500))
      await expect(getCompetitions()).rejects.toThrow('ninety-api /v1/competitions failed: 500')
    })

    it('a network failure / timeout (fetch itself rejects) propagates as a rejection', async () => {
      vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))
      await expect(getCompetitions()).rejects.toThrow('Failed to fetch')
    })

    it('a malformed (non-JSON) response body rejects rather than returning garbage', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError('Unexpected token in JSON')),
      } as unknown as Response)
      await expect(getCompetitions()).rejects.toThrow()
    })
  })
})
