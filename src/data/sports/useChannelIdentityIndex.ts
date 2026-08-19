// Thin React binding over channelIdentityLifecycle.ts's pure
// buildChannelIdentityIndex — see that module's header for the full
// cached/refresh/rebuild lifecycle and its own tests for the logic itself.
// This hook's only job is: own the current index as state, feed it real
// channelCatalog.ts I/O (wrapped with a cross-session resolution cache, see
// below), and rebuild whenever the playlist (channels reference) changes.
//
// The actual resolveChannelIdentities computation (~6s median against a
// real 30,925-channel playlist) runs off the main thread in a Worker (see
// channelIdentityWorkerClient.ts) — this hook no longer needs to defer
// anything itself just to keep the UI responsive; the AbortController below
// exists purely to cancel in-flight work on unmount/playlist-change, not to
// work around main-thread blocking.
//
// On top of that, a normal cached launch shouldn't repeat that ~6s Worker
// computation at all: makeCachingResolveIdentities wraps the default
// resolver with a cross-session IndexedDB cache
// (channelIdentityResolutionCache.ts), keyed by (catalogVersion,
// playlistGenerationId) — a hit skips the Worker round trip entirely. This
// composes with, rather than replaces, buildChannelIdentityIndex's existing
// cached-catalog/fresh-catalog dual-attempt logic: each of the (up to two)
// attempts it makes independently checks the resolution cache first.
//
// Failure modes are deliberately non-fatal — startup must never fail
// because ninety-api's catalog endpoint is temporarily unavailable:
//   - Catalog fetch fails but a valid cache exists -> the cache-derived
//     index (already set) stays in place; only a console warning.
//   - No cache AND the fetch fails -> index stays null.
//     channelMatch.ts's matchViaNinetyApi treats null the same as "no
//     identity data available" — PPV/broadcasterMap/EPG stages are
//     untouched by any of this and keep working.
//   - Worker construction/execution fails -> index stays null for that
//     generation (Part 7, Option B) — never a fall back to a synchronous
//     multi-second main-thread resolve.
import { useEffect, useState } from 'react'
import { loadCachedChannelCatalog, refreshChannelCatalog } from './channelCatalog'
import { buildChannelIdentityIndex, defaultResolveIdentities, type ResolveIdentities } from './channelIdentityLifecycle'
import { ChannelIdentityJobCancelled } from './channelIdentityWorkerClient'
import { defaultResolutionCacheSource, type ResolutionCacheSource } from './channelIdentityResolutionCache'
import type { ChannelIdentityIndex } from './channelIdentityIndex'
import type { Channel } from '../channel'

// Exported for direct testing (see useChannelIdentityIndex.test.ts) — pure
// logic, no React involved, same "test the logic directly, not the hook"
// convention channelIdentityLifecycle.ts's buildChannelIdentityIndex
// already established for this feature.
export function makeCachingResolveIdentities(
  base: ResolveIdentities,
  playlistGenerationId: string | null,
  cache: ResolutionCacheSource = defaultResolutionCacheSource,
): ResolveIdentities {
  return async (catalogVersion, catalog, playlist, signal) => {
    if (signal.aborted) return Promise.reject(new ChannelIdentityJobCancelled())
    if (playlistGenerationId) {
      const cached = await cache.load(catalogVersion, playlistGenerationId)
      if (cached) return cached
    }
    const resolved = await base(catalogVersion, catalog, playlist, signal)
    // Best-effort, non-blocking: the resolutions are already correct and
    // ready to publish this session — there's no reason the current-session
    // ChannelIdentityIndex (and everything downstream: Home's Live Now row,
    // Event Details' channel matches) should wait for an IndexedDB write
    // whose only purpose is speeding up the *next* launch. A failed/slow
    // cache write must never delay or fail the in-memory result that's
    // already available — but it must still be OBSERVABLE: idb.ts's
    // write() resolves `false` on failure rather than throwing, so
    // save()'s resolved boolean is checked explicitly (a bare .catch()
    // alone would silently swallow a `false` result); .catch() stays too,
    // defensively, in case a future ResolutionCacheSource implementation
    // does reject.
    if (playlistGenerationId) {
      void cache
        .save(catalogVersion, playlistGenerationId, resolved)
        .then((ok) => {
          if (!ok) {
            console.warn(
              '[useChannelIdentityIndex] resolution cache write did not complete — next launch will re-resolve instead of hitting the cache; current session is unaffected.',
            )
          }
        })
        .catch((err) => {
          console.warn(
            '[useChannelIdentityIndex] resolution cache write threw — next launch will re-resolve instead of hitting the cache; current session is unaffected.',
            err,
          )
        })
    }
    return resolved
  }
}

// playlistGenerationId: an opaque id stamped once per playlist generation
// (see data/playlistGeneration.ts and App.tsx's installPlaylist), not
// derived from playlist content — this is what makes checking the
// resolution cache on every launch cheap (O(1), never a hash over ~30,925
// channels). null only during the brief window before the app's playlist
// state has been installed for the first time; the cache lookup is simply
// skipped in that case (see makeCachingResolveIdentities above).
export function useChannelIdentityIndex(channels: Channel[], playlistGenerationId: string | null): ChannelIdentityIndex | null {
  const [index, setIndex] = useState<ChannelIdentityIndex | null>(null)

  useEffect(() => {
    if (channels.length === 0) {
      setIndex(null)
      return
    }

    const controller = new AbortController()
    void buildChannelIdentityIndex(
      channels,
      { loadCached: () => loadCachedChannelCatalog(), refresh: () => refreshChannelCatalog() },
      (built) => {
        if (!controller.signal.aborted) setIndex(built)
      },
      {
        signal: controller.signal,
        resolveIdentities: makeCachingResolveIdentities(defaultResolveIdentities, playlistGenerationId),
      },
    ).catch((err) => {
      // buildChannelIdentityIndex only rejects on a programming error
      // (its own network/cache/resolver failures are caught internally) —
      // logged rather than thrown so a bug here can't take the whole app
      // down.
      console.warn('[useChannelIdentityIndex] failed to build the channel identity index — Ninety identity matching is disabled this session (PPV/broadcaster-map/EPG matching still work).', err)
    })

    return () => {
      controller.abort()
    }
  }, [channels, playlistGenerationId])

  return index
}
