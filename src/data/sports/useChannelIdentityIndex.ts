// Thin React binding over channelIdentityLifecycle.ts's pure
// buildChannelIdentityIndex — see that module's header for the full
// cached/refresh/rebuild lifecycle and its own tests for the logic itself.
// This hook's only job is: own the current index as state, feed it real
// channelCatalog.ts I/O, and rebuild whenever the playlist (channels
// reference) changes.
//
// The actual resolveChannelIdentities computation (~6s median against a
// real 30,925-channel playlist) runs off the main thread in a Worker (see
// channelIdentityWorkerClient.ts) — this hook no longer needs to defer
// anything itself just to keep the UI responsive; the AbortController below
// exists purely to cancel in-flight work on unmount/playlist-change, not to
// work around main-thread blocking.
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
import { buildChannelIdentityIndex } from './channelIdentityLifecycle'
import type { ChannelIdentityIndex } from './channelIdentityIndex'
import type { Channel } from '../channel'

export function useChannelIdentityIndex(channels: Channel[]): ChannelIdentityIndex | null {
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
      { signal: controller.signal },
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
  }, [channels])

  return index
}
