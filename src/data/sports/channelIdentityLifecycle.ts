// Pure, framework-free catalog/index lifecycle logic for Channel Identity
// Resolver v2 — extracted out of useChannelIdentityIndex.ts so it's testable
// without React (no renderHook/testing-library in this project — see
// channelMatch.test.ts/channelCatalog.test.ts for the established pattern
// of testing the underlying logic directly instead of the hook/route
// wrapper around it).
//
// Desired lifecycle (resolver-integration task, Part 5):
//   1. A cached catalog, if one exists, builds an index immediately —
//      no network wait needed for a first, possibly-stale result.
//   2. The public catalog refreshes in the background.
//   3. If the refreshed catalog's version differs from what's already
//      built, rebuild.
//   4. If the refresh fails but a cached catalog was available, the
//      already-built (cache-derived) index is left in place untouched.
//   5. If no catalog is available at all (no cache, refresh also fails),
//      no index is ever built — callers must treat that as "Ninety
//      identity matching disabled this session", not a crash.
//
// Off-main-thread resolver-integration task (Part 3/5/6/7) — the actual
// resolveChannelIdentities computation (~6s median against a real
// 30,925-channel playlist) now runs in a Worker (see
// channelIdentityWorkerClient.ts), never on the main thread. This module
// owns the generation/cancellation semantics around that:
//   - Both the cached-catalog build and the fresh-catalog build get their
//     own AbortSignal-scoped attempt. If a fresh catalog turns out to carry
//     a DIFFERENT version while the cached-catalog build is still running,
//     the cached attempt is aborted (its Worker terminated) rather than
//     letting it install a result nobody wants anymore (Part 6).
//   - The caller (useChannelIdentityIndex.ts) passes its own AbortSignal
//     (aborted on playlist change / unmount) which cancels whichever
//     attempt(s) are still in flight.
//   - A resolution failure (Worker construction/execution failure, Part 7)
//     is caught here and logged — it never falls back to a synchronous
//     main-thread resolveChannelIdentities call, and it never crashes the
//     caller; the affected generation simply never calls `onIndex`.
import { ChannelIdentityIndex } from './channelIdentityIndex'
import { runChannelIdentityResolution, ChannelIdentityJobCancelled } from './channelIdentityWorkerClient'
import type { WorkerFactory } from './channelIdentityWorkerClient'
import { projectChannelIdentity } from './channelIdentityProjection'
import type { LogicalChannelResolution } from './channelIdentityResolver'
import type { NinetyLogicalChannel } from './ninetyApiClient'
import type { Channel } from '../channel'

export interface ChannelCatalogSnapshot {
  apiVersion: string
  channels: NinetyLogicalChannel[]
}

// Narrow interface over channelCatalog.ts's loadCachedChannelCatalog /
// refreshChannelCatalog — injected rather than imported directly so tests
// can supply fakes with no localStorage/network involved at all.
export interface CatalogSource {
  loadCached: () => ChannelCatalogSnapshot | null
  refresh: () => Promise<ChannelCatalogSnapshot>
}

// Injected so tests can fake "the worker responded" without a real browser
// Worker — see defaultResolveIdentities below for the production
// implementation and channelIdentityWorkerClient.ts for the Worker
// orchestration it wraps.
export type ResolveIdentities = (
  catalogVersion: string,
  catalog: NinetyLogicalChannel[],
  playlist: Channel[],
  signal: AbortSignal,
) => Promise<Map<string, LogicalChannelResolution>>

function isAbortError(err: unknown): boolean {
  return err instanceof ChannelIdentityJobCancelled || (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError')
}

// Production resolver: projects the playlist to identity-only records on
// the main thread (Part 9's "projection time" — cheap relative to the
// resolver itself, but timed and logged separately), then runs the actual
// resolveChannelIdentities call in a Worker. Exported so
// useChannelIdentityIndex.ts can rely on the same default the rest of this
// module uses without re-importing channelIdentityWorkerClient.ts directly.
export function makeWorkerResolveIdentities(createWorker?: WorkerFactory): ResolveIdentities {
  return (catalogVersion, catalog, playlist, signal) => {
    if (signal.aborted) return Promise.reject(new ChannelIdentityJobCancelled())

    const projectionStart = performance.now()
    const playlistIdentityRecords = playlist.map(projectChannelIdentity)
    const projectionMs = performance.now() - projectionStart

    const job = runChannelIdentityResolution(catalogVersion, catalog, playlistIdentityRecords, createWorker)
    const onAbort = () => job.cancel()
    signal.addEventListener('abort', onAbort)

    return job.result
      .then((r) => {
        console.info(
          `[channelIdentity] built index for catalog ${catalogVersion}: projection ${projectionMs.toFixed(1)}ms, ` +
            `worker round-trip ${r.timings.workerRoundTripMs.toFixed(1)}ms (compute ${r.timings.workerComputeMs.toFixed(1)}ms), ` +
            `${playlistIdentityRecords.length} playlist channels / ${catalog.length} catalog channels`,
        )
        return r.resolutions
      })
      .finally(() => signal.removeEventListener('abort', onAbort))
  }
}

export const defaultResolveIdentities: ResolveIdentities = makeWorkerResolveIdentities()

async function attemptResolve(
  resolveIdentities: ResolveIdentities,
  catalogVersion: string,
  catalog: NinetyLogicalChannel[],
  playlist: Channel[],
  signal: AbortSignal,
): Promise<Map<string, LogicalChannelResolution> | null> {
  try {
    return await resolveIdentities(catalogVersion, catalog, playlist, signal)
  } catch (err) {
    if (isAbortError(err)) return null
    // Part 7, Option B: a Worker construction/execution failure fails
    // gracefully for this generation — no index for this catalog version,
    // but never a fall-back to the old synchronous main-thread resolver,
    // and never a crash. PPV/broadcasterMap/EPG stages are unaffected by
    // identityIndex being null/unchanged.
    console.warn(
      '[channelIdentityLifecycle] identity resolution failed — Ninety identity matching unavailable until the next successful build (PPV/broadcaster-map/EPG stages keep working).',
      err,
    )
    return null
  }
}

// Builds (and rebuilds, at most once more) a ChannelIdentityIndex for the
// given playlist, calling `onIndex` each time a genuinely new index is
// ready. Never calls `onIndex` a second time for the same catalog version
// — a refresh that comes back unchanged, or fails outright, is a no-op
// past whatever `onIndex` already delivered from the cache.
export async function buildChannelIdentityIndex(
  channels: Channel[],
  source: CatalogSource,
  onIndex: (index: ChannelIdentityIndex) => void,
  options: { resolveIdentities?: ResolveIdentities; signal?: AbortSignal } = {},
): Promise<void> {
  const resolveIdentities = options.resolveIdentities ?? defaultResolveIdentities
  const signal = options.signal ?? new AbortController().signal

  const cached = source.loadCached()
  const cachedController = new AbortController()
  if (signal.aborted) cachedController.abort()
  else signal.addEventListener('abort', () => cachedController.abort(), { once: true })

  // Deliberately no additional `!cachedController.signal.aborted` guard
  // here: attemptResolve already returns null whenever the attempt was
  // genuinely cancelled before completing (isAbortError). If it instead
  // raced to completion before the Part 6 cleanup below got a chance to
  // cancel it, that's a real, valid result — the same "whichever finishes
  // first wins" behavior a real Worker's cancel-after-settle no-op gives.
  let cachedDone: Promise<void> = Promise.resolve()
  if (cached) {
    cachedDone = attemptResolve(resolveIdentities, cached.apiVersion, cached.channels, channels, cachedController.signal).then((resolutions) => {
      if (resolutions) onIndex(new ChannelIdentityIndex(cached.apiVersion, resolutions, channels))
    })
  }

  let fresh: ChannelCatalogSnapshot
  try {
    fresh = await source.refresh()
  } catch {
    // No cache and the refresh failed -> no index at all this session; a
    // cache that DID exist is left exactly as `cachedDone` already (or will
    // shortly) deliver it via onIndex above.
    await cachedDone
    return
  }

  if (signal.aborted) {
    await cachedDone
    return
  }

  if (cached && fresh.apiVersion === cached.apiVersion) {
    await cachedDone
    return
  }

  // The refreshed catalog is a genuinely different version (or there was no
  // cache at all) — Part 6: don't let a still-running cached-catalog build
  // install a now-stale result. Cancel it (terminating its Worker) and wait
  // for that cancellation to fully settle before starting the fresh build,
  // so onIndex calls never arrive out of order.
  cachedController.abort()
  await cachedDone

  const resolutions = await attemptResolve(resolveIdentities, fresh.apiVersion, fresh.channels, channels, signal)
  if (resolutions) {
    onIndex(new ChannelIdentityIndex(fresh.apiVersion, resolutions, channels))
  }
}
