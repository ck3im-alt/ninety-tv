import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { XtreamError, getLiveCategories, getLiveStreams, getShortEpg } from './xtreamClient'
import type { XtreamCredentials } from './types'

const CREDS: XtreamCredentials = { server: 'https://panel.example', username: 'secretuser', password: 'secretpass' }

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

describe('xtreamClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('returns valid categories', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse([
        { category_id: '1', category_name: 'Sports' },
        { category_id: '2', category_name: 'News' },
      ]),
    )
    const categories = await getLiveCategories(CREDS)
    expect(categories).toEqual([
      { category_id: '1', category_name: 'Sports' },
      { category_id: '2', category_name: 'News' },
    ])
  })

  it('returns valid streams', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse([{ stream_id: 101, name: 'ESPN', category_id: '1' }]),
    )
    const streams = await getLiveStreams(CREDS)
    expect(streams).toEqual([{ stream_id: 101, name: 'ESPN', category_id: '1' }])
  })

  it('returns a valid short EPG', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ epg_listings: [{ id: '1', title: 'Now Playing', description: '', start: '', end: '', start_timestamp: 0, stop_timestamp: 0, now_playing: 1 }] }),
    )
    const listings = await getShortEpg(CREDS, 101)
    expect(listings).toHaveLength(1)
    expect(listings[0].title).toBe('Now Playing')
  })

  it('maps HTTP 401 to AUTH_FAILED without leaking credentials', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}, false, 401))
    await expect(getLiveCategories(CREDS)).rejects.toMatchObject({ code: 'AUTH_FAILED' })
    try {
      await getLiveCategories(CREDS)
    } catch (err) {
      expect((err as Error).message).not.toContain('secretuser')
      expect((err as Error).message).not.toContain('secretpass')
    }
  })

  it('maps HTTP 500 to HTTP_ERROR', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}, false, 500))
    await expect(getLiveCategories(CREDS)).rejects.toMatchObject({ code: 'HTTP_ERROR' })
  })

  it('maps HTTP 200 auth:0 body to AUTH_FAILED', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ user_info: { auth: 0, status: 'Disabled' } }))
    await expect(getLiveCategories(CREDS)).rejects.toMatchObject({ code: 'AUTH_FAILED' })
  })

  it('maps malformed JSON to MALFORMED_RESPONSE', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    } as unknown as Response)
    await expect(getLiveCategories(CREDS)).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' })
  })

  it('maps an object returned where an array is expected to MALFORMED_RESPONSE', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ not: 'an array' }))
    await expect(getLiveCategories(CREDS)).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' })
  })

  it('drops stream entries missing required fields instead of throwing', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse([{ stream_id: 101, name: 'ESPN' }, { name: 'Missing stream_id' }, { stream_id: 102 }]),
    )
    const streams = await getLiveStreams(CREDS)
    expect(streams).toEqual([{ stream_id: 101, name: 'ESPN' }])
  })

  it('reports EMPTY_PLAYLIST when the unfiltered stream list is empty', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([]))
    await expect(getLiveStreams(CREDS)).rejects.toMatchObject({ code: 'EMPTY_PLAYLIST' })
  })

  it('times out slow panels and reports TIMEOUT', async () => {
    vi.useFakeTimers()
    vi.mocked(fetch).mockImplementation(
      (_url, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        }),
    )
    const promise = getLiveCategories(CREDS)
    const assertion = expect(promise).rejects.toMatchObject({ code: 'TIMEOUT' })
    await vi.advanceTimersByTimeAsync(15_000)
    await assertion
  })

  it('maps a readable message for each error category', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}, false, 401))
    await expect(getLiveCategories(CREDS)).rejects.toThrow('Incorrect username or password')
  })

  it('exposes XtreamError as the concrete error class', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}, false, 401))
    await expect(getLiveCategories(CREDS)).rejects.toBeInstanceOf(XtreamError)
  })
})
