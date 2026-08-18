import { describe, expect, it, vi } from 'vitest'
import { buildChannelIdentityIndex, defaultResolveIdentities } from './channelIdentityLifecycle'
import type { CatalogSource, ChannelCatalogSnapshot, ResolveIdentities } from './channelIdentityLifecycle'
import { resolveChannelIdentities } from './channelIdentityResolver'
import type { LogicalChannelResolution } from './channelIdentityResolver'
import { projectChannelIdentity } from './channelIdentityProjection'
import type { Channel } from '../channel'
import type { NinetyLogicalChannel } from './ninetyApiClient'

function logicalChannel(overrides: Partial<NinetyLogicalChannel> = {}): NinetyLogicalChannel {
  return {
    id: 'gb_tnt_sports_1',
    name: 'TNT Sports 1',
    country: 'GB',
    broadcast_type: 'LINEAR',
    network_name: 'TNT Sports',
    channel_number: null,
    channel_variant: null,
    aliases: [],
    external_ids: [],
    source_names: [],
    ...overrides,
  }
}

function playlistChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: 'p1',
    name: 'TNT SPORTS 1',
    groupTitle: 'UK| SPORT',
    sources: [{ label: 'Default', url: 'http://example.invalid/stream' }],
    ...overrides,
  }
}

// Stand-in for the real Worker-backed resolver (see
// channelIdentityWorkerClient.ts) — runs the real resolveChannelIdentities
// synchronously but wrapped as a microtask-deferred Promise, so tests still
// exercise genuinely async ordering without needing a real browser Worker.
// Honors `signal` like the real implementation does, so abort/cancellation
// tests exercise real behavior, not a shortcut.
function instantResolve(): ResolveIdentities {
  return (_catalogVersion, catalog, playlist, signal) =>
    new Promise((resolvePromise, reject) => {
      if (signal.aborted) {
        reject(new DOMException('aborted', 'AbortError'))
        return
      }
      const onAbort = () => reject(new DOMException('aborted', 'AbortError'))
      signal.addEventListener('abort', onAbort, { once: true })
      queueMicrotask(() => {
        signal.removeEventListener('abort', onAbort)
        if (signal.aborted) {
          reject(new DOMException('aborted', 'AbortError'))
          return
        }
        resolvePromise(resolveChannelIdentities(catalog, playlist.map(projectChannelIdentity)))
      })
    })
}

// A resolver that only settles when the test explicitly releases it — used
// to simulate "still building" races (Part 6) and cancellation.
function controllableResolve(): { resolve: ResolveIdentities; release: (catalog: NinetyLogicalChannel[], playlist: Channel[]) => Promise<void>; signals: AbortSignal[] } {
  const pending: { catalog: NinetyLogicalChannel[]; playlist: Channel[]; resolvePromise: (v: Map<string, LogicalChannelResolution>) => void; reject: (e: unknown) => void }[] = []
  const signals: AbortSignal[] = []
  const resolve: ResolveIdentities = (_catalogVersion, catalog, playlist, signal) =>
    new Promise((resolvePromise, reject) => {
      signals.push(signal)
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      pending.push({ catalog, playlist, resolvePromise, reject })
    })
  return {
    resolve,
    // Polls across microtask ticks rather than assuming a fixed number of
    // `await Promise.resolve()` calls lines up exactly with how many
    // internal microtask hops buildChannelIdentityIndex takes to reach the
    // matching resolveIdentities call — that hop count is an internal
    // implementation detail, not something this test should hard-code.
    release: async (catalog: NinetyLogicalChannel[], playlist: Channel[]) => {
      let entry = pending.find((p) => p.catalog === catalog && p.playlist === playlist)
      for (let i = 0; i < 50 && !entry; i++) {
        await Promise.resolve()
        entry = pending.find((p) => p.catalog === catalog && p.playlist === playlist)
      }
      if (!entry) throw new Error('no matching pending resolve() call to release')
      entry.resolvePromise(resolveChannelIdentities(catalog, playlist.map(projectChannelIdentity)))
    },
    signals,
  }
}

describe('buildChannelIdentityIndex (Part 12: offline cache build)', () => {
  it('builds an index from a cached catalog with no network call at all', async () => {
    const cached: ChannelCatalogSnapshot = { apiVersion: 'v1', channels: [logicalChannel()] }
    const refresh = vi.fn<CatalogSource['refresh']>(() => new Promise(() => {})) // never resolves
    const onIndex = vi.fn()

    // Deliberately don't await — a real network refresh may never settle
    // within the test, but the cache-derived index must arrive shortly
    // regardless (now via the injected instant resolver rather than
    // synchronously, since real resolution is genuinely async/off-thread).
    void buildChannelIdentityIndex([playlistChannel()], { loadCached: () => cached, refresh }, onIndex, { resolveIdentities: instantResolve() })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(onIndex).toHaveBeenCalledTimes(1)
    const index = onIndex.mock.calls[0][0]
    expect(index.catalogVersion).toBe('v1')
    expect(index.getPlaylistChannels('gb_tnt_sports_1').map((c: Channel) => c.id)).toEqual(['p1'])
  })
})

describe('buildChannelIdentityIndex (Part 13: failed refresh keeps cached identity)', () => {
  it('does not clear or replace the cache-derived index when refresh fails', async () => {
    const cached: ChannelCatalogSnapshot = { apiVersion: 'v1', channels: [logicalChannel()] }
    const source: CatalogSource = {
      loadCached: () => cached,
      refresh: () => Promise.reject(new Error('network down')),
    }
    const onIndex = vi.fn()

    await buildChannelIdentityIndex([playlistChannel()], source, onIndex, { resolveIdentities: instantResolve() })

    // Called exactly once, from the cache — the failed refresh must never
    // trigger a second call (which would imply clearing/replacing it).
    expect(onIndex).toHaveBeenCalledTimes(1)
    expect(onIndex.mock.calls[0][0].catalogVersion).toBe('v1')
  })

  it('leaves the index null (never calls onIndex) when there is no cache and the refresh fails', async () => {
    const source: CatalogSource = {
      loadCached: () => null,
      refresh: () => Promise.reject(new Error('network down')),
    }
    const onIndex = vi.fn()

    await buildChannelIdentityIndex([playlistChannel()], source, onIndex, { resolveIdentities: instantResolve() })

    expect(onIndex).not.toHaveBeenCalled()
  })
})

describe('buildChannelIdentityIndex (Part 14: changed catalog version rebuilds)', () => {
  it('rebuilds when the refreshed catalog has a different version than the cache', async () => {
    const cached: ChannelCatalogSnapshot = { apiVersion: 'v1', channels: [logicalChannel({ aliases: [] })] }
    const fresh: ChannelCatalogSnapshot = { apiVersion: 'v2', channels: [logicalChannel({ aliases: ['New Alias'] })] }
    const source: CatalogSource = { loadCached: () => cached, refresh: () => Promise.resolve(fresh) }
    const onIndex = vi.fn()

    await buildChannelIdentityIndex([playlistChannel()], source, onIndex, { resolveIdentities: instantResolve() })

    expect(onIndex).toHaveBeenCalledTimes(2)
    expect(onIndex.mock.calls[0][0].catalogVersion).toBe('v1')
    expect(onIndex.mock.calls[1][0].catalogVersion).toBe('v2')
  })

  it('does not rebuild when the refreshed catalog version matches the cache (Part 11 #7: no needless second build)', async () => {
    const snapshot: ChannelCatalogSnapshot = { apiVersion: 'v1', channels: [logicalChannel()] }
    const source: CatalogSource = { loadCached: () => snapshot, refresh: () => Promise.resolve(snapshot) }
    const onIndex = vi.fn()
    const resolveIdentities = vi.fn(instantResolve())

    await buildChannelIdentityIndex([playlistChannel()], source, onIndex, { resolveIdentities })

    expect(onIndex).toHaveBeenCalledTimes(1)
    // The expensive resolver call itself must only run once (for the
    // cached build) — the unchanged fresh version must never trigger a
    // second resolveIdentities call at all.
    expect(resolveIdentities).toHaveBeenCalledTimes(1)
  })

  it('builds once (from the refresh alone) when there is no cache to seed from', async () => {
    const fresh: ChannelCatalogSnapshot = { apiVersion: 'v1', channels: [logicalChannel()] }
    const source: CatalogSource = { loadCached: () => null, refresh: () => Promise.resolve(fresh) }
    const onIndex = vi.fn()

    await buildChannelIdentityIndex([playlistChannel()], source, onIndex, { resolveIdentities: instantResolve() })

    expect(onIndex).toHaveBeenCalledTimes(1)
    expect(onIndex.mock.calls[0][0].catalogVersion).toBe('v1')
  })
})

describe('buildChannelIdentityIndex (Part 15: changed playlist rebuilds)', () => {
  it('a second call with a different playlist produces an index reflecting the new playlist, not the old one', async () => {
    const snapshot: ChannelCatalogSnapshot = { apiVersion: 'v1', channels: [logicalChannel()] }
    const source: CatalogSource = { loadCached: () => snapshot, refresh: () => Promise.resolve(snapshot) }

    const onIndexA = vi.fn()
    await buildChannelIdentityIndex([playlistChannel({ id: 'p1', name: 'TNT SPORTS 1' })], source, onIndexA, { resolveIdentities: instantResolve() })
    expect(onIndexA.mock.calls.at(-1)![0].getPlaylistChannels('gb_tnt_sports_1').map((c: Channel) => c.id)).toEqual(['p1'])

    const onIndexB = vi.fn()
    await buildChannelIdentityIndex([playlistChannel({ id: 'p2', name: 'TNT SPORTS 1' })], source, onIndexB, { resolveIdentities: instantResolve() })
    expect(onIndexB.mock.calls.at(-1)![0].getPlaylistChannels('gb_tnt_sports_1').map((c: Channel) => c.id)).toEqual(['p2'])
  })
})

describe('buildChannelIdentityIndex (resolver-integration task, Part 6: cached-vs-fresh race)', () => {
  it('cancels an in-flight cached-catalog build and installs only the fresh result when a different version arrives first', async () => {
    const cached: ChannelCatalogSnapshot = { apiVersion: 'v1', channels: [logicalChannel()] }
    const fresh: ChannelCatalogSnapshot = { apiVersion: 'v2', channels: [logicalChannel({ id: 'gb_sky_sports_1', name: 'Sky Sports 1' })] }
    const source: CatalogSource = { loadCached: () => cached, refresh: () => Promise.resolve(fresh) }
    const onIndex = vi.fn()

    const { resolve, release, signals } = controllableResolve()
    const playlist = [playlistChannel()]

    const done = buildChannelIdentityIndex(playlist, source, onIndex, { resolveIdentities: resolve })

    // Release the fresh build only — the cached build's signal must have
    // been aborted by now (Part 6), so releasing it too would just prove
    // the reject-on-abort path, not that it was ever consulted for onIndex.
    await release(fresh.channels, playlist)

    await done

    expect(onIndex).toHaveBeenCalledTimes(1)
    expect(onIndex.mock.calls[0][0].catalogVersion).toBe('v2')
    expect(signals[0].aborted).toBe(true) // the cached generation's signal was cancelled
  })
})

describe('buildChannelIdentityIndex (resolver-integration task, Part 5: external cancellation)', () => {
  it('aborting the caller-provided signal (playlist change / unmount) prevents onIndex from ever firing', async () => {
    const cached: ChannelCatalogSnapshot = { apiVersion: 'v1', channels: [logicalChannel()] }
    // A refresh that never settles (e.g. a slow/dropped network request) is
    // realistic and must not stop the abort itself from taking effect —
    // this test therefore checks state after abort() rather than awaiting
    // buildChannelIdentityIndex's own returned promise, which is legitimately
    // fire-and-forget from the caller's (the hook's) point of view.
    const source: CatalogSource = { loadCached: () => cached, refresh: () => new Promise(() => {}) }
    const onIndex = vi.fn()
    const controller = new AbortController()

    const { resolve, signals } = controllableResolve()
    void buildChannelIdentityIndex([playlistChannel()], source, onIndex, { resolveIdentities: resolve, signal: controller.signal })

    for (let i = 0; i < 20 && signals.length === 0; i++) await Promise.resolve()
    controller.abort()
    for (let i = 0; i < 20; i++) await Promise.resolve()

    expect(onIndex).not.toHaveBeenCalled()
    expect(signals[0]?.aborted).toBe(true)
  })
})

describe('buildChannelIdentityIndex (resolver-integration task, Part 7: worker/resolver failure)', () => {
  it('a resolution failure never calls onIndex and never throws — no crash, no synchronous fallback', async () => {
    const source: CatalogSource = { loadCached: () => null, refresh: () => Promise.resolve({ apiVersion: 'v1', channels: [logicalChannel()] }) }
    const onIndex = vi.fn()
    const failingResolve: ResolveIdentities = () => Promise.reject(new Error('Worker is not defined'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(buildChannelIdentityIndex([playlistChannel()], source, onIndex, { resolveIdentities: failingResolve })).resolves.toBeUndefined()

    expect(onIndex).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('a cached build failure still allows a differently-versioned fresh build to succeed', async () => {
    const cached: ChannelCatalogSnapshot = { apiVersion: 'v1', channels: [logicalChannel()] }
    const fresh: ChannelCatalogSnapshot = { apiVersion: 'v2', channels: [logicalChannel()] }
    const source: CatalogSource = { loadCached: () => cached, refresh: () => Promise.resolve(fresh) }
    const onIndex = vi.fn()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    let call = 0
    const flaky: ResolveIdentities = (catalogVersion, catalog, playlist) => {
      call++
      if (call === 1) return Promise.reject(new Error('cached build boom'))
      return instantResolve()(catalogVersion, catalog, playlist, new AbortController().signal)
    }

    await buildChannelIdentityIndex([playlistChannel()], source, onIndex, { resolveIdentities: flaky })

    expect(onIndex).toHaveBeenCalledTimes(1)
    expect(onIndex.mock.calls[0][0].catalogVersion).toBe('v2')
    warnSpy.mockRestore()
  })
})

describe('defaultResolveIdentities (resolver-integration task, Part 7: real Worker unavailable in Node/Vitest)', () => {
  it('fails gracefully (rejects) rather than silently falling back to a synchronous resolve — verified via buildChannelIdentityIndex', async () => {
    // No injected resolveIdentities here — this exercises the real
    // production default, which tries to construct a real browser Worker.
    // Node/Vitest has no Worker global, so construction throws and this
    // must surface as a graceful "no index" outcome, not a crash and not a
    // synchronous multi-second resolve.
    const source: CatalogSource = { loadCached: () => null, refresh: () => Promise.resolve({ apiVersion: 'v1', channels: [logicalChannel()] }) }
    const onIndex = vi.fn()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(buildChannelIdentityIndex([playlistChannel()], source, onIndex)).resolves.toBeUndefined()

    expect(onIndex).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
    void defaultResolveIdentities // referenced so the export is exercised/typed here too
  })
})
