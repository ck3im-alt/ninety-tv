// Global guardrail for Xtream `get_short_epg` calls. channelMatch.ts's EPG
// fallback stages already cap each single match's own request volume (see
// MAX_EPG_CANDIDATE_CHANNELS / MAX_PPV_EPG_CANDIDATES there), but that cap is
// per-call: useHomeFeed can launch matchChannelsForEvent for several
// simultaneously-live matches via Promise.all, and each one used to run its
// own independent batch against the user's own IPTV panel. This module
// enforces one limiter across the whole app, plus a short cache and
// in-flight dedup so re-opening the same match's Event Details doesn't
// re-fire a request that's already resolved (or already in progress).
import { getShortEpg } from './xtreamClient'
import type { XtreamCredentials, XtreamEpgListing } from './types'

// Deliberately small — this throttles requests against the user's own IPTV
// provider, not our own infrastructure, so there's no throughput to chase.
const MAX_CONCURRENT = 4
const CACHE_TTL_MS = 45_000

let activeCount = 0
const waiters: (() => void)[] = []

function acquire(): Promise<void> {
  if (activeCount < MAX_CONCURRENT) {
    activeCount++
    return Promise.resolve()
  }
  return new Promise((resolve) => waiters.push(resolve))
}

function release(): void {
  activeCount--
  const next = waiters.shift()
  if (next) {
    activeCount++
    next()
  }
}

interface CacheEntry {
  expiresAt: number
  promise: Promise<XtreamEpgListing[]>
}

// Keyed by panel + stream, not just stream id — two different playlists
// (different Xtream accounts) could otherwise collide on the same numeric
// stream id.
const cache = new Map<string, CacheEntry>()

function cacheKey(creds: XtreamCredentials, streamId: number): string {
  return `${creds.server}|${creds.username}|${streamId}`
}

export async function getShortEpgLimited(
  creds: XtreamCredentials,
  streamId: number,
  limit: number,
  signal?: AbortSignal,
): Promise<XtreamEpgListing[]> {
  const key = cacheKey(creds, streamId)
  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.promise

  const promise = (async () => {
    await acquire()
    try {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      return await getShortEpg(creds, streamId, limit)
    } finally {
      release()
    }
  })()

  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, promise })
  // A failed lookup shouldn't be remembered for the full TTL — let the next
  // caller retry instead of getting a cached rejection.
  promise.catch(() => cache.delete(key))
  return promise
}
