// End-to-end coverage of the connect flow, with only `fetch` stubbed: the
// real sourceFromUrl, the real xtreamClient, the real devCorsProxy, the real
// M3U parse and merge. Mocking the module boundaries instead would let the
// fallback wiring pass while the pieces disagree about what an error IS,
// which is exactly the failure this suite exists to catch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectPlaylistFromUrl } from './connectPlaylist'
import { ConnectionError } from './connectionError'

// The shape a panel hands out, kept verbatim so the "we resend exactly what
// the user gave us" assertions mean something: a path, credentials, AND the
// two extra parameters parseXtreamPlaylistUrl does not retain.
const GET_PHP_URL = 'http://panel.example.com/get.php?username=41a3abc&password=5df00d&type=m3u_plus&output=ts'
const PLAIN_M3U_URL = 'https://provider.example.net/lists/mine.m3u'

const M3U_BODY = [
  '#EXTM3U',
  '#EXTINF:-1 tvg-logo="logo.png" group-title="NO| Sports",TV 2 Sport 1',
  'http://panel.example.com/live/41a3abc/5df00d/1.ts',
  '#EXTINF:-1 group-title="NO| News",NRK 1',
  'http://panel.example.com/live/41a3abc/5df00d/2.ts',
].join('\n')

// Hand-rolled rather than `new Response(...)`: undici refuses to construct a
// Response outside status 200-599, and 884 — a real code from a real panel —
// is the whole point of several tests below.
function fakeResponse(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body) as unknown),
  } as unknown as Response
}

type Route = (url: string) => Response | Promise<Response>

let requested: string[]

function routeFetch(route: Route): void {
  vi.mocked(fetch).mockImplementation((input: unknown) => {
    const url = String(input)
    requested.push(url)
    return Promise.resolve(route(url))
  })
}

const CATEGORIES = JSON.stringify([{ category_id: '1', category_name: 'Sports' }])
const STREAMS = JSON.stringify([
  { stream_id: 101, name: 'TV 2 Sport 1', category_id: '1' },
  { stream_id: 102, name: 'NRK 1', category_id: '1' },
])

function isApi(url: string): boolean {
  return url.includes('player_api.php')
}

beforeEach(() => {
  requested = []
  vi.stubGlobal('fetch', vi.fn())
  // Production/Tizen conditions. The dev-proxy CORS fallback has its own
  // suite (core/net/devCorsProxy.test.ts); leaving it on here would double
  // every failing request and blur the "how many attempts did we make"
  // assertions that matter most.
  vi.stubEnv('DEV', false)
  // The playlist build Worker does not exist under Vitest's node
  // environment, so buildPlaylistChannels logs one warning per call as it
  // drops to its documented synchronous path. Expected, and noise here.
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('connectPlaylistFromUrl — a panel whose Xtream API works', () => {
  it('connects over player_api.php and never downloads the M3U', async () => {
    routeFetch((url) => {
      if (url.includes('get_live_categories')) return fakeResponse(200, CATEGORIES)
      if (url.includes('get_live_streams')) return fakeResponse(200, STREAMS)
      throw new Error(`unexpected request: ${url}`)
    })

    const { source, channels } = await connectPlaylistFromUrl(GET_PHP_URL)

    expect(source).toEqual({
      type: 'xtream',
      server: 'http://panel.example.com',
      username: '41a3abc',
      password: '5df00d',
    })
    expect(channels.length).toBeGreaterThan(0)
    // The fallback must cost a working account nothing at all.
    expect(requested.every(isApi)).toBe(true)
    expect(requested.some((url) => url.includes('get.php'))).toBe(false)
  })

  it('tolerates surrounding whitespace on the pasted URL', async () => {
    routeFetch((url) => fakeResponse(200, url.includes('get_live_streams') ? STREAMS : CATEGORIES))
    const { source } = await connectPlaylistFromUrl(`  ${GET_PHP_URL}\n`)
    expect(source.type).toBe('xtream')
  })
})

describe('connectPlaylistFromUrl — falling back to the M3U export', () => {
  it('retries as an M3U when player_api.php is not implemented, resending the URL byte for byte', async () => {
    routeFetch((url) => (isApi(url) ? fakeResponse(404, 'Not Found') : fakeResponse(200, M3U_BODY)))

    const { source, channels } = await connectPlaylistFromUrl(GET_PHP_URL)

    expect(source).toEqual({ type: 'm3u-url', url: GET_PHP_URL })
    expect(channels.map((c) => c.name)).toContain('TV 2 Sport 1')
    // Not rebuilt from the parsed credentials: type=m3u_plus and output=ts
    // are the provider's, and dropping them hands the host a URL the user
    // never tested.
    expect(requested.filter((url) => url.includes('get.php'))).toEqual([GET_PHP_URL])
  })

  it('retries when the API answers with something that is not the Xtream API', async () => {
    routeFetch((url) => (isApi(url) ? fakeResponse(200, '<html><body>Login</body></html>') : fakeResponse(200, M3U_BODY)))

    const { source, channels } = await connectPlaylistFromUrl(GET_PHP_URL)

    expect(source).toEqual({ type: 'm3u-url', url: GET_PHP_URL })
    expect(channels.length).toBe(2)
  })

  it('retries when the API reports an empty channel list but the M3U export is populated', async () => {
    routeFetch((url) => (isApi(url) ? fakeResponse(200, '[]') : fakeResponse(200, M3U_BODY)))

    const { source } = await connectPlaylistFromUrl(GET_PHP_URL)

    expect(source).toEqual({ type: 'm3u-url', url: GET_PHP_URL })
  })

  it('reports the M3U failure when the fallback also fails to produce a playlist', async () => {
    routeFetch((url) => (isApi(url) ? fakeResponse(500, '') : fakeResponse(200, '#EXTM3U\n')))

    await expect(connectPlaylistFromUrl(GET_PHP_URL)).rejects.toMatchObject({
      code: 'EMPTY_PLAYLIST',
      message: 'No channels found in playlist',
    })
  })
})

describe('connectPlaylistFromUrl — invalid credentials', () => {
  it('says so on a 401, and does not spend a second request confirming it', async () => {
    routeFetch(() => fakeResponse(401, ''))

    await expect(connectPlaylistFromUrl(GET_PHP_URL)).rejects.toMatchObject({
      name: 'ConnectionError',
      code: 'AUTH_FAILED',
      message: 'Incorrect username or password',
    })
    expect(requested.some((url) => url.includes('get.php'))).toBe(false)
  })

  it('says so on an HTTP 200 body carrying auth: 0, without falling back', async () => {
    routeFetch(() => fakeResponse(200, JSON.stringify({ user_info: { auth: 0, status: 'Disabled' } })))

    await expect(connectPlaylistFromUrl(GET_PHP_URL)).rejects.toMatchObject({ code: 'AUTH_FAILED' })
    expect(requested.some((url) => url.includes('get.php'))).toBe(false)
  })

  it('resolves the 513/884 panel: two non-standard refusals from one live host mean bad credentials', async () => {
    // Measured on a real panel: player_api.php answers 513 and get.php
    // answers 884, both with empty bodies, for credentials it dislikes.
    // Neither number means anything on its own — the pair does.
    routeFetch((url) => (isApi(url) ? fakeResponse(513, '') : fakeResponse(884, '')))

    await expect(connectPlaylistFromUrl(GET_PHP_URL)).rejects.toMatchObject({
      code: 'AUTH_FAILED',
      message: 'Incorrect username or password',
    })
    // It took the M3U attempt to know that, so it must actually have run.
    expect(requested.some((url) => url.includes('get.php'))).toBe(true)
  })

  it('reads an explicit refusal out of the get.php body when the status alone is unhelpful', async () => {
    // 456 is neither an auth status nor an assigned server-failure one, so
    // nothing can be concluded from it. The body is what settles it.
    routeFetch((url) => (isApi(url) ? fakeResponse(456, '') : fakeResponse(456, 'Invalid username or password')))

    await expect(connectPlaylistFromUrl(GET_PHP_URL)).rejects.toMatchObject({ code: 'AUTH_FAILED' })
  })

  it('does NOT blame the credentials when both endpoints report a genuine outage', async () => {
    routeFetch(() => fakeResponse(503, 'Service Unavailable'))

    await expect(connectPlaylistFromUrl(GET_PHP_URL)).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      message: 'Provider server returned an error',
    })
  })
})

describe('connectPlaylistFromUrl — the host is not there', () => {
  it('reports it as unreachable rather than as a provider error', async () => {
    // What a browser/Tizen fetch does for a domain that does not resolve.
    vi.mocked(fetch).mockImplementation((input: unknown) => {
      requested.push(String(input))
      return Promise.reject(new TypeError('Failed to fetch'))
    })

    await expect(connectPlaylistFromUrl(GET_PHP_URL)).rejects.toMatchObject({
      code: 'UNREACHABLE',
      message: 'Could not reach the provider server',
    })
  })

  it('does not retry the same dead host as an M3U', async () => {
    vi.mocked(fetch).mockImplementation((input: unknown) => {
      requested.push(String(input))
      return Promise.reject(new TypeError('Failed to fetch'))
    })

    await expect(connectPlaylistFromUrl(GET_PHP_URL)).rejects.toMatchObject({ code: 'UNREACHABLE' })
    expect(requested.some((url) => url.includes('get.php'))).toBe(false)
  })
})

describe('connectPlaylistFromUrl — an ordinary M3U URL', () => {
  it('imports in a single request, exactly as before', async () => {
    routeFetch(() => fakeResponse(200, M3U_BODY))

    const { source, channels } = await connectPlaylistFromUrl(PLAIN_M3U_URL)

    expect(source).toEqual({ type: 'm3u-url', url: PLAIN_M3U_URL })
    expect(channels).toHaveLength(2)
    expect(requested).toEqual([PLAIN_M3U_URL])
  })

  it('reports an unreachable M3U host as unreachable', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(connectPlaylistFromUrl(PLAIN_M3U_URL)).rejects.toMatchObject({ code: 'UNREACHABLE' })
  })

  it('reports an empty M3U as an empty playlist', async () => {
    routeFetch(() => fakeResponse(200, '#EXTM3U\n'))

    await expect(connectPlaylistFromUrl(PLAIN_M3U_URL)).rejects.toBeInstanceOf(ConnectionError)
    await expect(connectPlaylistFromUrl(PLAIN_M3U_URL)).rejects.toMatchObject({ code: 'EMPTY_PLAYLIST' })
  })
})
