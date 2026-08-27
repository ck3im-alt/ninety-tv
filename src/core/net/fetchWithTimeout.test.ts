import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_REQUEST_TIMEOUT_MS, RequestTimeoutError, fetchWithTimeout, isRequestTimeout } from './fetchWithTimeout'

// A fetch that never settles on its own — the exact failure this module
// exists to bound. It resolves only if the signal it was handed aborts,
// mirroring what a real fetch does.
function abortError() {
  const err = new Error('The operation was aborted.')
  err.name = 'AbortError'
  return err
}

function hangingFetch() {
  return vi.fn((_input: string, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      // Real fetch checks `aborted` synchronously before it starts, and
      // rejects straight away — it does not wait for an 'abort' event that
      // has already been and gone. Emulated so the already-aborted case is
      // exercised honestly rather than hanging on a listener nothing fires.
      if (init?.signal?.aborted) {
        reject(abortError())
        return
      }
      init?.signal?.addEventListener('abort', () => reject(abortError()))
    })
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('fetchWithTimeout', () => {
  it('rejects with RequestTimeoutError once the bound elapses, instead of hanging forever', async () => {
    vi.stubGlobal('fetch', hangingFetch())
    const promise = fetchWithTimeout('https://example.test/slow', { timeoutMs: 5000 })
    const assertion = expect(promise).rejects.toBeInstanceOf(RequestTimeoutError)
    await vi.advanceTimersByTimeAsync(5000)
    await assertion
  })

  it('resolves normally when the response arrives in time', async () => {
    const response = { ok: true, status: 200 } as Response
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    await expect(fetchWithTimeout('https://example.test/fast')).resolves.toBe(response)
  })

  it('clears its timer on success, so a settled request never fires a late abort', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true } as Response))
    await fetchWithTimeout('https://example.test/fast', { timeoutMs: 1000 })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears its timer on failure too', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')))
    await expect(fetchWithTimeout('https://example.test/dead', { timeoutMs: 1000 })).rejects.toThrow('network down')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('passes an ordinary network failure through untouched rather than calling it a timeout', async () => {
    const failure = new TypeError('Failed to fetch')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure))
    await expect(fetchWithTimeout('https://example.test/dead')).rejects.toBe(failure)
  })

  // The distinction that matters: a screen unmounting mid-request is not a
  // timeout, and must not be reported (or retried) as one.
  it("reports the CALLER's abort as an AbortError, not as a timeout", async () => {
    vi.stubGlobal('fetch', hangingFetch())
    const caller = new AbortController()
    const promise = fetchWithTimeout('https://example.test/slow', { signal: caller.signal, timeoutMs: 10_000 })
    caller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    await expect(promise).rejects.not.toBeInstanceOf(RequestTimeoutError)
  })

  it('aborts immediately when handed an already-aborted caller signal', async () => {
    vi.stubGlobal('fetch', hangingFetch())
    const caller = new AbortController()
    caller.abort()
    await expect(
      fetchWithTimeout('https://example.test/slow', { signal: caller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('forwards method/headers to fetch and supplies its own signal', async () => {
    const spy = vi.fn().mockResolvedValue({ ok: true } as Response)
    vi.stubGlobal('fetch', spy)
    await fetchWithTimeout('https://example.test/x', { method: 'POST', headers: { Authorization: 'Bearer s' } })
    const init = spy.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ Authorization: 'Bearer s' })
    expect(init.signal).toBeInstanceOf(AbortSignal)
    // timeoutMs is ours, not fetch's — it must never reach the platform call.
    expect('timeoutMs' in init).toBe(false)
  })

  it('defaults to the shared bound rather than being unbounded', async () => {
    vi.stubGlobal('fetch', hangingFetch())
    const promise = fetchWithTimeout('https://example.test/slow')
    const assertion = expect(promise).rejects.toMatchObject({ timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS })
    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS)
    await assertion
  })

  it('isRequestTimeout only recognises a real timeout', () => {
    expect(isRequestTimeout(new RequestTimeoutError(1000))).toBe(true)
    expect(isRequestTimeout(new Error('nope'))).toBe(false)
    expect(isRequestTimeout(undefined)).toBe(false)
  })

  // AbortSignal.timeout() and AbortSignal.any() do not exist on the Tizen
  // 6.0 WebKit this ships to. Reaching for either would pass every test in
  // jsdom (which has both) and then throw on the actual television.
  //
  // Rather than spying, this REMOVES them for the duration of the test —
  // the honest simulation of the target platform. It fails loudly if
  // anyone reintroduces a dependency on them.
  it('works on a platform with no AbortSignal.timeout()/any(), as Tizen 6.0 is', async () => {
    const signalCtor = AbortSignal as unknown as Record<string, unknown>
    const savedTimeout = signalCtor.timeout
    const savedAny = signalCtor.any
    delete signalCtor.timeout
    delete signalCtor.any
    try {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true } as Response))
      const caller = new AbortController()
      await expect(
        fetchWithTimeout('https://example.test/x', { signal: caller.signal, timeoutMs: 5000 }),
      ).resolves.toMatchObject({ ok: true })

      // And the timeout path still works without them.
      vi.stubGlobal('fetch', hangingFetch())
      const promise = fetchWithTimeout('https://example.test/slow', { timeoutMs: 5000 })
      const assertion = expect(promise).rejects.toBeInstanceOf(RequestTimeoutError)
      await vi.advanceTimersByTimeAsync(5000)
      await assertion
    } finally {
      if (savedTimeout !== undefined) signalCtor.timeout = savedTimeout
      if (savedAny !== undefined) signalCtor.any = savedAny
    }
  })
})
