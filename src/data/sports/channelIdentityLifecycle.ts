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
import { ChannelIdentityIndex } from './channelIdentityIndex'
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

// Builds (and rebuilds, at most once more) a ChannelIdentityIndex for the
// given playlist, calling `onIndex` each time a genuinely new index is
// ready. Never calls `onIndex` a second time for the same catalog version
// — a refresh that comes back unchanged, or fails outright, is a no-op
// past whatever `onIndex` already delivered from the cache.
export async function buildChannelIdentityIndex(
  channels: Channel[],
  source: CatalogSource,
  onIndex: (index: ChannelIdentityIndex) => void,
): Promise<void> {
  const cached = source.loadCached()
  if (cached) onIndex(new ChannelIdentityIndex(cached.apiVersion, cached.channels, channels))

  let fresh: ChannelCatalogSnapshot
  try {
    fresh = await source.refresh()
  } catch {
    // No cache and the refresh failed -> no index at all this session;
    // the caller's onIndex is simply never invoked. A cache that DID
    // exist is left exactly as onIndex already delivered it above.
    return
  }

  if (cached && fresh.apiVersion === cached.apiVersion) return
  onIndex(new ChannelIdentityIndex(fresh.apiVersion, fresh.channels, channels))
}
