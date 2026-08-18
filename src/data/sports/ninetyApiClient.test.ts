import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAllEvents, getEvents } from './ninetyApiClient'

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
})
