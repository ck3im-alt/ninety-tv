// Tests makeCachingResolveIdentities directly (pure logic, no React) — the
// hook itself (useChannelIdentityIndex) isn't tested, same convention
// channelIdentityLifecycle.ts's buildChannelIdentityIndex already
// established for this feature: test the orchestration logic, not the
// React wrapper around it.
import { describe, expect, it, vi } from 'vitest'
import { makeCachingResolveIdentities } from './useChannelIdentityIndex'
import { ChannelIdentityJobCancelled } from './channelIdentityWorkerClient'
import type { ResolveIdentities } from './channelIdentityLifecycle'
import type { ResolutionCacheSource } from './channelIdentityResolutionCache'
import type { LogicalChannelResolution } from './channelIdentityResolver'

const sampleResolution: LogicalChannelResolution = {
  logicalChannelId: 'logical-1',
  classification: 'CONFIRMED',
  matches: [{ playlistChannelId: 'ch1', score: 100, signals: [], negativeSignals: [] }],
}
const sampleMap = new Map([['logical-1', sampleResolution]])

function makeSignal(): AbortSignal {
  return new AbortController().signal
}

describe('makeCachingResolveIdentities', () => {
  it('returns the cached value without calling base when the cache has a hit', async () => {
    const base = vi.fn<ResolveIdentities>()
    const cache: ResolutionCacheSource = {
      load: vi.fn().mockResolvedValue(sampleMap),
      save: vi.fn(),
    }
    const resolve = makeCachingResolveIdentities(base, 'gen-1', cache)

    const result = await resolve('v1', [], [], makeSignal())

    expect(result).toBe(sampleMap)
    expect(base).not.toHaveBeenCalled()
  })

  it('calls base and returns its result on a cache miss', async () => {
    const base = vi.fn<ResolveIdentities>().mockResolvedValue(sampleMap)
    const cache: ResolutionCacheSource = {
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue(undefined),
    }
    const resolve = makeCachingResolveIdentities(base, 'gen-1', cache)

    const result = await resolve('v1', [], [], makeSignal())

    expect(result).toBe(sampleMap)
    expect(base).toHaveBeenCalledTimes(1)
  })

  it('publishes the resolved result WITHOUT waiting for the cache write to complete (non-blocking persistence)', async () => {
    const base = vi.fn<ResolveIdentities>().mockResolvedValue(sampleMap)
    let releaseSave: (() => void) | null = null
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    const cache: ResolutionCacheSource = {
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockImplementation(() => saveGate), // never resolves until releaseSave() is called
    }
    const resolve = makeCachingResolveIdentities(base, 'gen-1', cache)

    // If persistence were blocking, this await would hang forever (the test
    // would time out) since saveGate is never released. Resolving here
    // proves the cache write happens in the background, not on the
    // publication path.
    const result = await resolve('v1', [], [], makeSignal())

    expect(result).toBe(sampleMap)
    expect(cache.save).toHaveBeenCalledTimes(1)
    releaseSave!() // let the still-pending background save settle so it doesn't leak into the next test
  })

  it('a rejecting cache.save never fails or rejects the resolver result', async () => {
    const base = vi.fn<ResolveIdentities>().mockResolvedValue(sampleMap)
    const cache: ResolutionCacheSource = {
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockRejectedValue(new Error('IndexedDB quota exceeded')),
    }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const resolve = makeCachingResolveIdentities(base, 'gen-1', cache)

    await expect(resolve('v1', [], [], makeSignal())).resolves.toBe(sampleMap)

    // Let the background .catch() handler run before asserting/cleaning up.
    await new Promise((r) => setTimeout(r, 0))
    warnSpy.mockRestore()
  })

  it('skips both cache.load and cache.save when playlistGenerationId is null', async () => {
    const base = vi.fn<ResolveIdentities>().mockResolvedValue(sampleMap)
    const cache: ResolutionCacheSource = { load: vi.fn(), save: vi.fn() }
    const resolve = makeCachingResolveIdentities(base, null, cache)

    const result = await resolve('v1', [], [], makeSignal())

    expect(result).toBe(sampleMap)
    expect(cache.load).not.toHaveBeenCalled()
    expect(cache.save).not.toHaveBeenCalled()
  })

  it('rejects with ChannelIdentityJobCancelled immediately when the signal is already aborted, without touching the cache or base', async () => {
    const base = vi.fn<ResolveIdentities>()
    const cache: ResolutionCacheSource = { load: vi.fn(), save: vi.fn() }
    const resolve = makeCachingResolveIdentities(base, 'gen-1', cache)
    const controller = new AbortController()
    controller.abort()

    await expect(resolve('v1', [], [], controller.signal)).rejects.toBeInstanceOf(ChannelIdentityJobCancelled)
    expect(base).not.toHaveBeenCalled()
    expect(cache.load).not.toHaveBeenCalled()
  })
})
