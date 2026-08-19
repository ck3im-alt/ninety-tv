// Cross-session cache for the Channel Identity Resolver v2's expensive
// (~6s-median against a real 30,925-channel playlist) resolution result —
// without this, channelIdentityLifecycle.ts's buildChannelIdentityIndex
// reruns the Worker-based resolution at least once, every single app
// session, unconditionally.
//
// Keyed by (playlistGenerationId, catalogVersion, RESOLVER_SCHEMA_VERSION):
// playlistGenerationId is an opaque id stamped once per playlist generation
// (see data/playlistGeneration.ts) — never derived from playlist content, so
// checking the cache costs nothing proportional to playlist size. A cache
// hit means "this exact playlist generation was already resolved against
// this exact catalog version, with this exact resolver logic" — any of
// those three changing is a genuine cache miss, not something to paper over.
//
// Stored in its own small IndexedDB store (not localStorage): the
// resolution map covers the whole playlist (one entry per matched playlist
// channel across every logical channel), so it must not be assumed "small
// enough for synchronous JSON on the UI thread" merely because it's smaller
// than the full Channel[] cache — same reasoning as idbChannelStore.ts.
// Values are structured-cloned, never JSON.stringify'd.
//
// Privacy: the stored shape is exactly the [logicalChannelId,
// LogicalChannelResolution][] pairs already proven safe by
// channelIdentityWorker.test.ts/channelIdentityWorkerClient.test.ts —
// LogicalChannelResolution only ever carries playlistChannelId STRINGS
// (never Channel objects), so no stream URL/credential can enter this cache.
import { openSingleRecordStore, type IdbSingleRecordStore } from '../../core/storage/idb'
import type { LogicalChannelResolution } from './channelIdentityResolver'

// Bump alongside channelIdentityResolver.ts scoring-logic changes — a
// resolver-logic change can make a previously-cached resolution wrong, so a
// version bump here makes every old cached entry a clean miss rather than a
// silently-stale hit.
export const RESOLVER_SCHEMA_VERSION = 1

interface StoredResolutionRecord {
  schemaVersion: number
  catalogVersion: string
  playlistGenerationId: string
  resolutions: [string, LogicalChannelResolution][]
}

export interface ResolutionCacheSource {
  load(catalogVersion: string, playlistGenerationId: string): Promise<Map<string, LogicalChannelResolution> | null>
  // Resolves `true` only once the underlying write genuinely completed,
  // `false` on any failure — mirrors idbChannelStore.ts's
  // savePlaylistChannels contract (never throws under normal idb.ts
  // behavior; a caller that cares about failures inspects the boolean).
  save(catalogVersion: string, playlistGenerationId: string, resolutions: Map<string, LogicalChannelResolution>): Promise<boolean>
}

// Exported (not just the default instance) so tests can inject an in-memory
// IdbSingleRecordStore fake — same dependency-injection pattern used
// throughout this codebase (WorkerFactory, CatalogSource, idbChannelStore's
// own store param).
export function makeResolutionCacheSource(store: IdbSingleRecordStore<StoredResolutionRecord>): ResolutionCacheSource {
  // Serializes writes in CALL order, not completion order. The store is a
  // single fixed-key record — only one (catalogVersion, playlistGenerationId)
  // pair can be persisted at a time. buildChannelIdentityIndex
  // (channelIdentityLifecycle.ts) can issue two overlapping resolve
  // attempts for the SAME playlistGenerationId: one against a cached
  // catalog, then (only after the cached attempt's resolveIdentities call
  // has already returned — see that file's `await cachedDone` before
  // starting the fresh attempt) one against a freshly-refreshed catalog.
  // Because save() is now fire-and-forget from the caller's side
  // (useChannelIdentityIndex.ts's makeCachingResolveIdentities never awaits
  // it), nothing otherwise guarantees the cached attempt's slower
  // underlying IDB write finishes before the fresh attempt's — a fresh
  // (current, correct) write could complete first and then get silently
  // clobbered by the stale cached-catalog write finishing later. Chaining
  // every write onto one shared queue forces them to commit in the order
  // save() was CALLED — which is always cached-then-fresh, per the ordering
  // buildChannelIdentityIndex already guarantees — so the fresh (newer,
  // correct) write is always the last one applied, regardless of which
  // underlying I/O happens to finish first.
  let writeQueue: Promise<void> = Promise.resolve()

  return {
    async load(catalogVersion, playlistGenerationId) {
      const stored = await store.read()
      if (!stored) return null
      if (stored.schemaVersion !== RESOLVER_SCHEMA_VERSION) return null
      if (stored.catalogVersion !== catalogVersion) return null
      if (stored.playlistGenerationId !== playlistGenerationId) return null
      return new Map(stored.resolutions)
    },
    save(catalogVersion, playlistGenerationId, resolutions) {
      const record: StoredResolutionRecord = {
        schemaVersion: RESOLVER_SCHEMA_VERSION,
        catalogVersion,
        playlistGenerationId,
        resolutions: [...resolutions.entries()],
      }
      const task = writeQueue.then(() => store.write(record))
      // Keep the queue alive even if this write failed, so a later save()
      // call still gets its turn instead of the whole queue wedging on one
      // failed link — store.write() itself never rejects (see idb.ts), but
      // this is defensive against that changing.
      writeQueue = task.then(
        () => undefined,
        () => undefined,
      )
      return task
    },
  }
}

const defaultStore = openSingleRecordStore<StoredResolutionRecord>('ninety-tv-resolver-cache', 'resolutions')
export const defaultResolutionCacheSource: ResolutionCacheSource = makeResolutionCacheSource(defaultStore)
