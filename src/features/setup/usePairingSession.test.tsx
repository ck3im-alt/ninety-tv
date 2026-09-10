// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { usePairingSession } from './usePairingSession'

// Concurrency coverage for the QR-pairing loop.
//
// THE BUG THIS LOCKS DOWN. The loop used to be `setInterval(async () =>
// ...)`. setInterval fires on a fixed period whether or not the previous
// async callback has finished, so while the callback was awaiting
// onReceived() — the full playlist connection, seconds of work for a large
// M3U — the timer kept firing. Each new poll saw the same still-unacked
// READY session and started ANOTHER concurrent connection of the same
// playlist. The `lastFailedUrl` guard could not prevent it: it is only
// assigned after a connection resolves, so it is still null throughout the
// window that matters.
//
// These tests deliberately drive the hook through REAL awaited promises
// with fake timers, rather than asserting on implementation details, so
// they would fail against the setInterval version and pass against any
// correct serialization.

const { createPairingSession, pollPairingStatus, ackPairing, saveDeviceCredential } = vi.hoisted(() => ({
  createPairingSession: vi.fn(),
  pollPairingStatus: vi.fn(),
  ackPairing: vi.fn(),
  saveDeviceCredential: vi.fn(),
}))

vi.mock('../../data/pairing/pairingClient', () => ({ createPairingSession, pollPairingStatus, ackPairing }))
vi.mock('../../data/deviceCredential', () => ({ saveDeviceCredential }))

const POLL_INTERVAL_MS = 2000

function session(overrides: Partial<{ pollSecret: string; activationUrl: string; expiresAt: string }> = {}) {
  return {
    pollSecret: 'secret-1',
    activationUrl: 'https://api.example/activate?t=tok-1',
    expiresAt: '2030-01-01T00:00:00Z',
    ...overrides,
  }
}

// A promise the test resolves by hand, so "the playlist connection is still
// running" is an explicit, controllable state rather than a timing guess.
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

interface Harness {
  onReceived: ReturnType<typeof vi.fn>
  onPaired: ReturnType<typeof vi.fn>
  status: () => string
  activationUrl: () => string | null
  retry: () => void
  unmount: () => void
}

function harness(onReceivedImpl: (m3uUrl: string, secret: string) => Promise<boolean> | boolean): Harness {
  const onReceived = vi.fn(onReceivedImpl)
  const onPaired = vi.fn()
  let latest: ReturnType<typeof usePairingSession> | null = null
  function Probe() {
    latest = usePairingSession(onReceived, onPaired)
    return null
  }
  const view = render(<Probe />)
  return {
    onReceived,
    onPaired,
    status: () => latest!.status,
    activationUrl: () => latest!.activationUrl,
    retry: () => act(() => latest!.retry()),
    unmount: () => view.unmount(),
  }
}

// Lets every already-resolved promise settle without advancing the clock.
const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

const tick = async (ms = POLL_INTERVAL_MS) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  createPairingSession.mockReset().mockResolvedValue(session())
  pollPairingStatus.mockReset().mockResolvedValue({ status: 'waiting' })
  ackPairing.mockReset().mockResolvedValue(undefined)
  saveDeviceCredential.mockReset().mockReturnValue(true)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('usePairingSession — session lifecycle', () => {
  it('creates exactly one session and reports its activation URL', async () => {
    const h = harness(() => true)
    expect(h.status()).toBe('loading')
    await flush()
    expect(createPairingSession).toHaveBeenCalledTimes(1)
    expect(h.status()).toBe('waiting')
    expect(h.activationUrl()).toBe('https://api.example/activate?t=tok-1')
  })

  it('reports an error when the session cannot be created', async () => {
    createPairingSession.mockRejectedValue(new Error('offline'))
    const h = harness(() => true)
    await flush()
    expect(h.status()).toBe('error')
    expect(h.activationUrl()).toBeNull()
  })

  it('polls on an interval while waiting', async () => {
    harness(() => true)
    await flush()
    expect(pollPairingStatus).toHaveBeenCalledTimes(0)
    await tick()
    expect(pollPairingStatus).toHaveBeenCalledTimes(1)
    await tick()
    expect(pollPairingStatus).toHaveBeenCalledTimes(2)
  })

  it('keeps polling through a transient poll failure instead of tearing down', async () => {
    pollPairingStatus.mockRejectedValueOnce(new Error('hiccup')).mockResolvedValue({ status: 'waiting' })
    const h = harness(() => true)
    await flush()
    await tick()
    expect(h.status()).toBe('waiting')
    await tick()
    expect(pollPairingStatus).toHaveBeenCalledTimes(2)
  })

  it('starts a fresh session when the current one expires', async () => {
    pollPairingStatus.mockResolvedValueOnce({ status: 'expired' }).mockResolvedValue({ status: 'waiting' })
    createPairingSession
      .mockResolvedValueOnce(session())
      .mockResolvedValue(session({ pollSecret: 'secret-2', activationUrl: 'https://api.example/activate?t=tok-2' }))
    const h = harness(() => true)
    await flush()
    await tick()
    await flush()
    expect(createPairingSession).toHaveBeenCalledTimes(2)
    expect(h.activationUrl()).toBe('https://api.example/activate?t=tok-2')
  })
})

// The heart of Phase 3.
describe('usePairingSession — at most one operation in flight', () => {
  it('does not start a second poll while the first is still unresolved', async () => {
    const pending = deferred<{ status: 'waiting' }>()
    pollPairingStatus.mockReturnValue(pending.promise)
    harness(() => true)
    await flush()

    await tick() // first poll starts
    expect(pollPairingStatus).toHaveBeenCalledTimes(1)

    // Several intervals pass while that poll is still outstanding. The
    // setInterval version fired a new poll on each one.
    await tick()
    await tick()
    await tick()
    expect(pollPairingStatus).toHaveBeenCalledTimes(1)

    pending.resolve({ status: 'waiting' })
    await flush()
    await tick()
    expect(pollPairingStatus).toHaveBeenCalledTimes(2)
  })

  // The exact production symptom: one scanned QR, one slow playlist
  // connection, and the same READY session connected over and over.
  it('processes a READY session only ONCE even while the connection is slow', async () => {
    const connection = deferred<boolean>()
    pollPairingStatus.mockResolvedValue({ status: 'ready', m3uUrl: 'http://provider/p.m3u' })
    const h = harness(() => connection.promise)
    await flush()

    await tick() // poll returns ready, connection begins
    await flush()
    expect(h.onReceived).toHaveBeenCalledTimes(1)

    // A slow (30,000-channel) import: many intervals elapse mid-connection.
    for (let i = 0; i < 6; i += 1) await tick()
    expect(h.onReceived).toHaveBeenCalledTimes(1)
    expect(pollPairingStatus).toHaveBeenCalledTimes(1)

    connection.resolve(true)
    await flush()
    expect(h.onReceived).toHaveBeenCalledTimes(1)
  })

  it('stops polling for good once a connection succeeds', async () => {
    pollPairingStatus.mockResolvedValue({ status: 'ready', m3uUrl: 'http://provider/p.m3u' })
    const h = harness(() => true)
    await flush()
    await tick()
    await flush()
    expect(h.onReceived).toHaveBeenCalledTimes(1)

    const pollsAfterSuccess = pollPairingStatus.mock.calls.length
    for (let i = 0; i < 5; i += 1) await tick()
    expect(pollPairingStatus).toHaveBeenCalledTimes(pollsAfterSuccess)
    expect(h.onReceived).toHaveBeenCalledTimes(1)
  })
})

describe('usePairingSession — rejected playlist URLs', () => {
  it('keeps polling after a rejected URL so a corrected one can be resubmitted', async () => {
    pollPairingStatus.mockResolvedValue({ status: 'ready', m3uUrl: 'http://bad/p.m3u' })
    const h = harness(() => false)
    await flush()
    await tick()
    await flush()
    expect(h.onReceived).toHaveBeenCalledTimes(1)
    await tick()
    await flush()
    expect(pollPairingStatus.mock.calls.length).toBeGreaterThan(1)
  })

  it('does not retry the SAME rejected URL on every tick', async () => {
    pollPairingStatus.mockResolvedValue({ status: 'ready', m3uUrl: 'http://bad/p.m3u' })
    const h = harness(() => false)
    await flush()
    for (let i = 0; i < 5; i += 1) {
      await tick()
      await flush()
    }
    expect(h.onReceived).toHaveBeenCalledTimes(1)
  })

  it('DOES attempt a genuinely different, corrected URL', async () => {
    pollPairingStatus
      .mockResolvedValueOnce({ status: 'ready', m3uUrl: 'http://bad/p.m3u' })
      .mockResolvedValue({ status: 'ready', m3uUrl: 'http://good/p.m3u' })
    const h = harness((url) => url === 'http://good/p.m3u')
    await flush()
    await tick()
    await flush()
    await tick()
    await flush()
    expect(h.onReceived).toHaveBeenCalledTimes(2)
    expect(h.onReceived).toHaveBeenLastCalledWith('http://good/p.m3u', 'secret-1')
  })

  // Acking is the caller's job (PlaylistSetupScreen acks only on success),
  // so what this asserts is that the hook reports failure faithfully and
  // never treats a rejected URL as a completed pairing.
  it('reports a failed connection as not-accepted, leaving the session unacked', async () => {
    pollPairingStatus.mockResolvedValue({ status: 'ready', m3uUrl: 'http://bad/p.m3u' })
    const h = harness(() => false)
    await flush()
    await tick()
    await flush()
    expect(await h.onReceived.mock.results[0].value).toBe(false)
    expect(ackPairing).not.toHaveBeenCalled()
  })
})

describe('usePairingSession — account pairing credential bootstrap', () => {
  it('persists the TV credential before acknowledging a completed phone setup', async () => {
    pollPairingStatus.mockResolvedValue({
      status: 'paired',
      deviceCredential: 'device-credential',
      entitlement: { active: true, reason: 'trial', accessEndsAt: '2030-01-08T00:00:00Z' },
      playlistSetupComplete: true,
    })
    const h = harness(() => true)
    await flush()
    await tick()
    await flush()

    expect(saveDeviceCredential).toHaveBeenCalledWith('device-credential')
    expect(ackPairing).toHaveBeenCalledWith('secret-1')
    expect(saveDeviceCredential.mock.invocationCallOrder[0]).toBeLessThan(ackPairing.mock.invocationCallOrder[0])
    expect(h.onPaired).toHaveBeenCalledTimes(1)
    expect(h.onReceived).not.toHaveBeenCalled()
  })

  it('does not consume pairing when the credential cannot be persisted', async () => {
    saveDeviceCredential.mockReturnValue(false)
    pollPairingStatus.mockResolvedValue({
      status: 'paired',
      deviceCredential: 'device-credential',
      entitlement: { active: true, reason: 'trial', accessEndsAt: '2030-01-08T00:00:00Z' },
      playlistSetupComplete: true,
    })
    const h = harness(() => true)
    await flush()
    await tick()
    await flush()

    expect(ackPairing).not.toHaveBeenCalled()
    expect(h.onPaired).not.toHaveBeenCalled()
    await tick()
    expect(pollPairingStatus).toHaveBeenCalledTimes(2)
  })
})

describe('usePairingSession — cancellation and staleness', () => {
  it('unmounting stops all future polling', async () => {
    const h = harness(() => true)
    await flush()
    await tick()
    const before = pollPairingStatus.mock.calls.length
    h.unmount()
    for (let i = 0; i < 5; i += 1) await tick()
    expect(pollPairingStatus).toHaveBeenCalledTimes(before)
  })

  it('a poll that resolves AFTER unmount cannot trigger a connection', async () => {
    const pending = deferred<{ status: 'ready'; m3uUrl: string }>()
    pollPairingStatus.mockReturnValue(pending.promise)
    const h = harness(() => true)
    await flush()
    await tick() // poll in flight
    h.unmount()
    pending.resolve({ status: 'ready', m3uUrl: 'http://provider/p.m3u' })
    await flush()
    expect(h.onReceived).not.toHaveBeenCalled()
  })

  it('a stale poll from a superseded session cannot restart polling on the new one', async () => {
    const stale = deferred<{ status: 'waiting' }>()
    pollPairingStatus.mockReturnValueOnce(stale.promise).mockResolvedValue({ status: 'waiting' })
    const h = harness(() => true)
    await flush()
    await tick() // stale poll in flight against session 1

    h.retry() // supersedes it with a brand-new session
    await flush()
    const afterRetry = pollPairingStatus.mock.calls.length

    stale.resolve({ status: 'waiting' })
    await flush()
    // The stale continuation must NOT have scheduled anything of its own.
    await tick()
    expect(pollPairingStatus).toHaveBeenCalledTimes(afterRetry + 1)
  })

  it('retry starts a clean session', async () => {
    const h = harness(() => true)
    await flush()
    expect(createPairingSession).toHaveBeenCalledTimes(1)
    h.retry()
    await flush()
    expect(createPairingSession).toHaveBeenCalledTimes(2)
    expect(h.status()).toBe('waiting')
  })

  it('retry recovers from an error state', async () => {
    createPairingSession.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(session())
    const h = harness(() => true)
    await flush()
    expect(h.status()).toBe('error')
    h.retry()
    await flush()
    expect(h.status()).toBe('waiting')
  })

  it('leaves no pending timer behind after unmount', async () => {
    const h = harness(() => true)
    await flush()
    await tick()
    await flush()
    h.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
