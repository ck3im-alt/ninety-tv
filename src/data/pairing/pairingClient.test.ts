import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ackPairing, createPairingSession, pollPairingStatus } from './pairingClient'
import { RequestTimeoutError } from '../../core/net/fetchWithTimeout'

// Contract + robustness coverage for the QR-pairing client, which had none
// at all while sports/ninetyApiClient.ts had a full suite. The wire-shape
// assertions here exist for the same reason as that file's: a client/server
// parameter or path mismatch against ninety-api is silent (see the
// /v1/teams `search` vs `q` incident), so the request this actually sends
// is pinned rather than assumed.
//
// The exact paths below are ninety-api's src/routes/pairing.ts:
//   POST /api/pairing          -> 201 { pollSecret, activationUrl, expiresAt }
//   GET  /api/pairing/status   -> 200 { status: waiting|ready|expired|consumed }
//   POST /api/pairing/ack      -> best-effort
// The poll secret travels as an Authorization: Bearer header and MUST NOT
// be placed in a URL — ninety-api's two-secret design depends on it staying
// out of QR codes, browser history and access logs.

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response
}

function hangingFetch() {
  return vi.fn((_input: string, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const fail = () => {
        const err = new Error('The operation was aborted.')
        err.name = 'AbortError'
        reject(err)
      }
      if (init?.signal?.aborted) return fail()
      init?.signal?.addEventListener('abort', fail)
    })
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  vi.stubEnv('VITE_NINETY_API_URL', 'https://api.example')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('pairingClient — wire contract', () => {
  it('createPairingSession POSTs to /api/pairing and returns the session', async () => {
    const session = { pollSecret: 's3cret', activationUrl: 'https://api.example/activate?t=tok', expiresAt: '2026-01-01T00:00:00Z' }
    vi.mocked(fetch).mockResolvedValue(jsonResponse(session, true, 201))
    await expect(createPairingSession()).resolves.toEqual(session)
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://api.example/api/pairing')
    expect((init as RequestInit).method).toBe('POST')
  })

  it('pollPairingStatus GETs /api/pairing/status with the secret as a Bearer header', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ status: 'waiting' }))
    await expect(pollPairingStatus('s3cret')).resolves.toEqual({ status: 'waiting' })
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://api.example/api/pairing/status')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer s3cret' })
  })

  it('never puts the poll secret in a URL — it must stay out of logs and history', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ status: 'waiting' }))
    await pollPairingStatus('s3cret')
    await ackPairing('s3cret')
    for (const [url] of vi.mocked(fetch).mock.calls) {
      expect(String(url)).not.toContain('s3cret')
    }
  })

  it('ackPairing POSTs to /api/pairing/ack with the Bearer header', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}))
    await ackPairing('s3cret')
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://api.example/api/pairing/ack')
    expect((init as RequestInit).method).toBe('POST')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer s3cret' })
  })

  it('passes every status the backend can return straight through', async () => {
    for (const status of ['waiting', 'ready', 'expired', 'consumed'] as const) {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ status, m3uUrl: 'http://x/p.m3u' }))
      const result = await pollPairingStatus('s')
      expect(result.status).toBe(status)
    }
  })
})

describe('pairingClient — failure handling', () => {
  it('throws on a non-OK session creation', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}, false, 500))
    await expect(createPairingSession()).rejects.toThrow('pairing session creation failed: 500')
  })

  it('throws on a non-OK poll', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}, false, 401))
    await expect(pollPairingStatus('s')).rejects.toThrow('pairing status poll failed: 401')
  })

  // Best-effort by design: an unacked session simply expires on its own
  // rather than becoming reusable, so a failure here must never propagate
  // into the connect flow that just succeeded.
  it('ackPairing swallows a network failure rather than failing the connection', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('network down'))
    await expect(ackPairing('s')).resolves.toBeUndefined()
  })

  it('ackPairing swallows a non-OK response too', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}, false, 500))
    await expect(ackPairing('s')).resolves.toBeUndefined()
  })
})

describe('pairingClient — bounded requests', () => {
  it('a poll that never answers times out instead of stalling the pairing loop', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', hangingFetch())
    const promise = pollPairingStatus('s')
    const assertion = expect(promise).rejects.toBeInstanceOf(RequestTimeoutError)
    await vi.advanceTimersByTimeAsync(8_000)
    await assertion
    vi.useRealTimers()
  })

  it('session creation is bounded too, so the QR screen cannot hang on "loading"', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', hangingFetch())
    const promise = createPairingSession()
    const assertion = expect(promise).rejects.toBeInstanceOf(RequestTimeoutError)
    await vi.advanceTimersByTimeAsync(12_000)
    await assertion
    vi.useRealTimers()
  })

  it('ackPairing cannot hang either — its timeout is swallowed like any other failure', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', hangingFetch())
    const promise = ackPairing('s')
    await vi.advanceTimersByTimeAsync(8_000)
    await expect(promise).resolves.toBeUndefined()
    vi.useRealTimers()
  })
})

// The hermetic-env requirement, matching the fix ninetyApiClient.ts already
// received: the base URL must be read per call, not frozen at module load,
// or these tests pass only on a machine with a local .env and fail in CI.
describe('pairingClient — environment handling', () => {
  it('reads VITE_NINETY_API_URL at call time, so a test can stub it', async () => {
    vi.stubEnv('VITE_NINETY_API_URL', 'https://other.example')
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ status: 'waiting' }))
    await pollPairingStatus('s')
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe('https://other.example/api/pairing/status')
  })

  it('fails with a clear, actionable message when the API URL is unset', async () => {
    vi.stubEnv('VITE_NINETY_API_URL', '')
    await expect(createPairingSession()).rejects.toThrow('VITE_NINETY_API_URL is not set')
    await expect(pollPairingStatus('s')).rejects.toThrow('VITE_NINETY_API_URL is not set')
  })

  it('ackPairing no-ops (rather than throwing) with no API URL configured', async () => {
    vi.stubEnv('VITE_NINETY_API_URL', '')
    await expect(ackPairing('s')).resolves.toBeUndefined()
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })
})
