// Thin React binding over channelIdentityLifecycle.ts's pure
// buildChannelIdentityIndex — see that module's header for the full
// cached/refresh/rebuild lifecycle and its own tests for the logic itself.
// This hook's only job is: own the current index as state, feed it real
// channelCatalog.ts I/O, and rebuild whenever the playlist (channels
// reference) changes.
//
// Failure modes are deliberately non-fatal — startup must never fail
// because ninety-api's catalog endpoint is temporarily unavailable:
//   - Catalog fetch fails but a valid cache exists -> the cache-derived
//     index (already set) stays in place; only a console warning.
//   - No cache AND the fetch fails -> index stays null.
//     channelMatch.ts's matchViaNinetyApi treats null the same as "no
//     identity data available" — PPV/broadcasterMap/EPG stages are
//     untouched by any of this and keep working.
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

    let cancelled = false
    void buildChannelIdentityIndex(
      channels,
      { loadCached: () => loadCachedChannelCatalog(), refresh: () => refreshChannelCatalog() },
      (built) => {
        if (cancelled) return
        // Deferred a tick so the resolver's real work (see
        // channelIdentityResolver.ts — up to a few seconds against an
        // unusually large playlist) never runs in the very same frame as
        // whatever triggered this effect, keeping first paint/interaction
        // responsive.
        setTimeout(() => {
          if (!cancelled) setIndex(built)
        }, 0)
      },
    ).catch((err) => {
      // buildChannelIdentityIndex only rejects on a programming error
      // (its own network/cache failures are caught internally) — logged
      // rather than thrown so a bug here can't take the whole app down.
      console.warn('[useChannelIdentityIndex] failed to build the channel identity index — Ninety identity matching is disabled this session (PPV/broadcaster-map/EPG matching still work).', err)
    })

    return () => {
      cancelled = true
    }
  }, [channels])

  return index
}
