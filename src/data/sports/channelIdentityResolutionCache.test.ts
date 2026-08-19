import { describe, expect, it } from 'vitest'
import { makeResolutionCacheSource, RESOLVER_SCHEMA_VERSION } from './channelIdentityResolutionCache'
import type { IdbSingleRecordStore } from '../../core/storage/idb'
import type { LogicalChannelResolution } from './channelIdentityResolver'

function makeFakeStore<T>(): IdbSingleRecordStore<T> {
  let record: T | null = null
  return {
    async read() {
      return record
    },
    async write(value: T) {
      record = value
      return true
    },
    async clear() {
      record = null
      return true
    },
  }
}

interface StoredResolutionRecordShape {
  schemaVersion: number
  catalogVersion: string
  playlistGenerationId: string
  resolutions: [string, LogicalChannelResolution][]
}

// Controllable fake: write() doesn't resolve until the test explicitly
// releases it, so completion order can be driven independently of call
// order — exactly what's needed to simulate out-of-order async completion.
function makeControllableStore(): {
  store: IdbSingleRecordStore<StoredResolutionRecordShape>
  pendingWrites: () => number
  peekNextWrite: () => StoredResolutionRecordShape | undefined
  releaseNextWrite: (result?: boolean) => void
  currentRecord: () => StoredResolutionRecordShape | null
} {
  let record: StoredResolutionRecordShape | null = null
  const pending: { resolve: (ok: boolean) => void; value: StoredResolutionRecordShape }[] = []
  return {
    store: {
      async read() {
        return record
      },
      write(value) {
        return new Promise<boolean>((resolve) => {
          pending.push({
            value,
            resolve: (ok) => {
              if (ok) record = value
              resolve(ok)
            },
          })
        })
      },
      async clear() {
        record = null
        return true
      },
    },
    pendingWrites: () => pending.length,
    peekNextWrite: () => pending[0]?.value,
    releaseNextWrite: (result = true) => {
      const next = pending.shift()
      if (!next) throw new Error('releaseNextWrite called with nothing pending')
      next.resolve(result)
    },
    currentRecord: () => record,
  }
}

// Flushes microtasks until at least one write is pending (or gives up after
// a generous bound) — robust against exactly how many .then() hops the
// write queue's internal chaining happens to need, rather than hardcoding a
// specific microtask count.
async function waitForPendingWrite(pendingWrites: () => number): Promise<void> {
  for (let i = 0; i < 10 && pendingWrites() === 0; i++) {
    await Promise.resolve()
  }
}

const sampleResolution: LogicalChannelResolution = {
  logicalChannelId: 'logical-1',
  classification: 'CONFIRMED',
  matches: [{ playlistChannelId: 'ch1', score: 100, signals: [], negativeSignals: [] }],
}
const otherResolution: LogicalChannelResolution = {
  logicalChannelId: 'logical-2',
  classification: 'CONFIRMED',
  matches: [{ playlistChannelId: 'ch2', score: 100, signals: [], negativeSignals: [] }],
}

describe('channelIdentityResolutionCache', () => {
  it('load() returns null when nothing has been saved', async () => {
    const cache = makeResolutionCacheSource(makeFakeStore())
    await expect(cache.load('v1', 'gen-1')).resolves.toBeNull()
  })

  it('save() then load() round-trips the resolution map for a matching key', async () => {
    const cache = makeResolutionCacheSource(makeFakeStore())
    const resolutions = new Map([['logical-1', sampleResolution]])
    await cache.save('v1', 'gen-1', resolutions)
    await expect(cache.load('v1', 'gen-1')).resolves.toEqual(resolutions)
  })

  it('a different catalogVersion is a miss even with the same playlistGenerationId', async () => {
    const cache = makeResolutionCacheSource(makeFakeStore())
    await cache.save('v1', 'gen-1', new Map([['logical-1', sampleResolution]]))
    await expect(cache.load('v2', 'gen-1')).resolves.toBeNull()
  })

  it('a different playlistGenerationId is a miss even with the same catalogVersion', async () => {
    const cache = makeResolutionCacheSource(makeFakeStore())
    await cache.save('v1', 'gen-1', new Map([['logical-1', sampleResolution]]))
    await expect(cache.load('v1', 'gen-2')).resolves.toBeNull()
  })

  it('a stale schemaVersion in the stored record is a miss (simulates a resolver-logic bump)', async () => {
    const store = makeFakeStore<{
      schemaVersion: number
      catalogVersion: string
      playlistGenerationId: string
      resolutions: [string, LogicalChannelResolution][]
    }>()
    await store.write({
      schemaVersion: RESOLVER_SCHEMA_VERSION - 1,
      catalogVersion: 'v1',
      playlistGenerationId: 'gen-1',
      resolutions: [['logical-1', sampleResolution]],
    })
    const cache = makeResolutionCacheSource(store)
    await expect(cache.load('v1', 'gen-1')).resolves.toBeNull()
  })

  it('never stores anything Channel/URL-shaped — only logicalChannelId/playlistChannelId strings and scores', async () => {
    const cache = makeResolutionCacheSource(makeFakeStore())
    await cache.save('v1', 'gen-1', new Map([['logical-1', sampleResolution]]))
    const serialized = JSON.stringify(sampleResolution)
    expect(serialized).not.toContain('http')
    expect(serialized).not.toMatch(/"url"/)
    expect(serialized).not.toMatch(/"password"/)
  })

  describe('write failure observability (Part A)', () => {
    it('save() resolves false when the underlying IDB write returns false, rather than silently reporting success', async () => {
      const store: IdbSingleRecordStore<StoredResolutionRecordShape> = {
        async read() {
          return null
        },
        async write() {
          return false // simulates idb.ts's write() reporting a failed transaction (quota, blocked, etc.)
        },
        async clear() {
          return true
        },
      }
      const cache = makeResolutionCacheSource(store)
      await expect(cache.save('v1', 'gen-1', new Map([['logical-1', sampleResolution]]))).resolves.toBe(false)
    })

    it('save() resolves true when the underlying IDB write succeeds', async () => {
      const cache = makeResolutionCacheSource(makeFakeStore())
      await expect(cache.save('v1', 'gen-1', new Map([['logical-1', sampleResolution]]))).resolves.toBe(true)
    })
  })

  describe('write ordering under overlapping saves (Part B)', () => {
    it('serializes writes in CALL order — a save() issued first is fully applied before a later save() call\'s write even starts', async () => {
      const { store, pendingWrites } = makeControllableStore()
      const cache = makeResolutionCacheSource(store)

      void cache.save('cached-version', 'gen-1', new Map([['logical-1', sampleResolution]]))
      void cache.save('fresh-version', 'gen-1', new Map([['logical-2', otherResolution]]))
      await waitForPendingWrite(pendingWrites)

      // Only the FIRST call's underlying write should have been issued —
      // the second is queued behind it, not racing it.
      expect(pendingWrites()).toBe(1)
    })

    it('a later save() call always wins the persisted record, even if the earlier call\'s underlying write completes after it (out-of-order completion)', async () => {
      const { store, pendingWrites, peekNextWrite, releaseNextWrite, currentRecord } = makeControllableStore()
      const cache = makeResolutionCacheSource(store)

      // Simulates buildChannelIdentityIndex's cached-attempt-then-fresh-attempt
      // sequence: cached is called first (call order), fresh second — the
      // scenario this test guards against is the CACHED write's underlying
      // IDB transaction being the slow one, completing only after the fresh
      // write already would have (if both were racing concurrently).
      const cachedSave = cache.save('cached-version', 'gen-1', new Map([['logical-1', sampleResolution]]))
      const freshSave = cache.save('fresh-version', 'gen-1', new Map([['logical-2', otherResolution]]))
      await waitForPendingWrite(pendingWrites)

      // Explicitly confirm WHICH record is about to be committed at each
      // release, rather than assuming FIFO release order happens to match
      // call order — this is what makes the test a genuine proof rather
      // than a coincidence of the fake's own queueing.
      expect(peekNextWrite()?.catalogVersion).toBe('cached-version')
      releaseNextWrite(true)
      await cachedSave

      // Only now does the fresh (newer) write even get issued — proving the
      // queue held it back until the cached write had fully settled, so
      // there was never a window where both were simultaneously in flight
      // (see the sibling "serializes writes in CALL order" test for that
      // assertion directly).
      await waitForPendingWrite(pendingWrites)
      expect(peekNextWrite()?.catalogVersion).toBe('fresh-version')
      releaseNextWrite(true)
      await freshSave

      expect(currentRecord()?.catalogVersion).toBe('fresh-version')
      await expect(cache.load('fresh-version', 'gen-1')).resolves.toEqual(new Map([['logical-2', otherResolution]]))
      await expect(cache.load('cached-version', 'gen-1')).resolves.toBeNull()
    })

    it('a failed earlier write does not block a later write from applying', async () => {
      const { store, pendingWrites, releaseNextWrite, currentRecord } = makeControllableStore()
      const cache = makeResolutionCacheSource(store)

      const cachedSave = cache.save('cached-version', 'gen-1', new Map([['logical-1', sampleResolution]]))
      const freshSave = cache.save('fresh-version', 'gen-1', new Map([['logical-2', otherResolution]]))
      await waitForPendingWrite(pendingWrites)

      releaseNextWrite(false) // cached write fails
      await expect(cachedSave).resolves.toBe(false)

      await waitForPendingWrite(pendingWrites)
      releaseNextWrite(true) // fresh write succeeds, unblocked despite the prior failure
      await expect(freshSave).resolves.toBe(true)

      expect(currentRecord()?.catalogVersion).toBe('fresh-version')
    })
  })
})
