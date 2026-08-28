// What the CORS fallback is allowed to do to a failure's identity.
//
// The bug behind this suite: a domain that no longer resolves reached the
// user as "Provider server returned an error", because the direct fetch's
// DNS failure was replaced by the dev proxy's own HTTP 502 and every layer
// above simply believed it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEV_PROXY_UPSTREAM_ERROR_HEADER, HttpStatusError, NetworkUnreachableError, fetchWithDevCorsFallback } from './devCorsProxy'

const TARGET = 'http://panel.example.com/get.php?username=u&password=p'

function response(status: number, body = '', headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: () => Promise.resolve(body),
  } as unknown as Response
}

function proxyRequests(): string[] {
  return vi.mocked(fetch).mock.calls.map((call) => String(call[0])).filter((url) => url.startsWith('/dev-proxy/'))
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('fetchWithDevCorsFallback — the direct attempt produced a response', () => {
  beforeEach(() => vi.stubEnv('DEV', true))

  it('returns it unchanged when it succeeded', async () => {
    const ok = response(200, 'body')
    vi.mocked(fetch).mockResolvedValue(ok)
    await expect(fetchWithDevCorsFallback(TARGET)).resolves.toBe(ok)
    expect(proxyRequests()).toEqual([])
  })

  it('does not re-issue a failing status through the proxy', async () => {
    // A readable status means the request reached the server AND CORS let us
    // read the answer — so the proxy has nothing to fix, and asking it again
    // could only overwrite a real status with the proxy's own.
    vi.mocked(fetch).mockResolvedValue(response(500, 'upstream is down'))
    await expect(fetchWithDevCorsFallback(TARGET)).rejects.toBeInstanceOf(HttpStatusError)
    expect(proxyRequests()).toEqual([])
  })

  it('keeps a bounded sample of the failing body, which is where panels put their reason', async () => {
    vi.mocked(fetch).mockResolvedValue(response(513, '{"user_info":{"auth":0}}'))
    await expect(fetchWithDevCorsFallback(TARGET)).rejects.toMatchObject({
      status: 513,
      body: '{"user_info":{"auth":0}}',
    })
  })

  it('survives a response with no readable body rather than failing over it', async () => {
    const bodyless = { ok: false, status: 404 } as unknown as Response
    vi.mocked(fetch).mockResolvedValue(bodyless)
    await expect(fetchWithDevCorsFallback(TARGET)).rejects.toMatchObject({ status: 404, body: '' })
  })
})

describe('fetchWithDevCorsFallback — the direct attempt never got a response', () => {
  it('reports an unreachable host as unreachable in production, with no proxy attempt', async () => {
    vi.stubEnv('DEV', false)
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))

    const err = await fetchWithDevCorsFallback(TARGET).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NetworkUnreachableError)
    expect((err as NetworkUnreachableError).triedDevProxy).toBe(false)
    expect(proxyRequests()).toEqual([])
  })

  it('falls back through the dev proxy, and returns what it got', async () => {
    vi.stubEnv('DEV', true)
    const proxied = response(200, '#EXTM3U')
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(proxied)

    await expect(fetchWithDevCorsFallback(TARGET)).resolves.toBe(proxied)
    expect(proxyRequests()).toEqual([`/dev-proxy/m3u?url=${encodeURIComponent(TARGET)}`])
  })

  it('keeps the original network failure when the proxy could not reach the host either', async () => {
    // THE REGRESSION. The proxy answers 502 for its own upstream failure,
    // which is indistinguishable from a 502 the provider sent — so it flags
    // its own, and the unreachable verdict survives instead of becoming an
    // HTTP error the provider never produced.
    vi.stubEnv('DEV', true)
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(
        response(502, 'getaddrinfo ENOTFOUND panel.example.com', {
          [DEV_PROXY_UPSTREAM_ERROR_HEADER]: 'getaddrinfo ENOTFOUND panel.example.com',
        }),
      )

    const err = await fetchWithDevCorsFallback(TARGET).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NetworkUnreachableError)
    expect(err).not.toBeInstanceOf(HttpStatusError)
    // Both halves are retained, so a developer can tell which layer failed.
    expect((err as NetworkUnreachableError).detail).toContain('Failed to fetch')
    expect((err as NetworkUnreachableError).detail).toContain('ENOTFOUND')
    expect((err as NetworkUnreachableError).triedDevProxy).toBe(true)
  })

  it('still reports a genuine upstream HTTP error the proxy relayed', async () => {
    // Same 502, but unflagged — this one really is the provider's.
    vi.stubEnv('DEV', true)
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(response(502, 'Bad Gateway'))

    await expect(fetchWithDevCorsFallback(TARGET)).rejects.toMatchObject({ name: 'HttpStatusError', status: 502 })
  })

  it('reports a dead dev proxy as a network failure, distinguishably', async () => {
    vi.stubEnv('DEV', true)
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))

    const err = await fetchWithDevCorsFallback(TARGET).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NetworkUnreachableError)
    expect((err as NetworkUnreachableError).triedDevProxy).toBe(true)
    expect((err as NetworkUnreachableError).detail).toContain('dev proxy:')
  })
})

describe('fetchWithDevCorsFallback — cancellation', () => {
  it('re-throws an abort untouched instead of retrying it', async () => {
    vi.stubEnv('DEV', true)
    vi.mocked(fetch).mockRejectedValue(new DOMException('Aborted', 'AbortError'))

    await expect(fetchWithDevCorsFallback(TARGET)).rejects.toMatchObject({ name: 'AbortError' })
    expect(proxyRequests()).toEqual([])
  })

  it('treats a non-DOMException abort as an abort too', async () => {
    // Which class an aborted fetch rejects with varies across Tizen's
    // WebKit, jsdom and Node — the name is the portable part.
    vi.stubEnv('DEV', true)
    const abort = Object.assign(new Error('Aborted'), { name: 'AbortError' })
    vi.mocked(fetch).mockRejectedValue(abort)

    await expect(fetchWithDevCorsFallback(TARGET)).rejects.toBe(abort)
    expect(proxyRequests()).toEqual([])
  })
})
