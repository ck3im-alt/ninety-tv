// Local cache/loader for ninety-api's public channel identity catalog
// (GET /v1/channels/catalog — see ninetyApiClient.ts and, on the backend,
// ninety-api's src/routes/channels.ts). Channel Identity Resolver v2 Phase
// 1: this is deliberately a *download-only* cache. The catalog itself
// (logical channel names/aliases/EPG identifiers) is public, non-personal
// data safe to fetch and store — but the user's own playlist never goes
// the other direction. Nothing in this module, or anything that calls it,
// may send to ninety-api: Xtream credentials, an M3U URL, stream URLs,
// playlist channel names/tvg-ids, or playlist contents of any kind.
// Matching the catalog against the user's playlist stays entirely local
// (see channelMatch.ts) — this module only ever fetches FROM ninety-api,
// never posts playlist data TO it.

import { readStored, writeStored } from '../../core/storage/localStore'
import { getChannelCatalog, type NinetyLogicalChannel } from './ninetyApiClient'

const CHANNEL_CATALOG_KEY = 'ninety.channelCatalog'

// Bump if NinetyLogicalChannel's shape changes in a way that makes a
// previously-cached catalog stale/unreadable — independent of the
// catalog's own content-fingerprint `version` (see ninety-api's
// channels.ts), which tracks *data* changes, not *shape* changes.
const CHANNEL_CATALOG_CACHE_SCHEMA_VERSION = 1

interface StoredChannelCatalog {
  schemaVersion: number
  apiVersion: string
  country: string | null
  channels: NinetyLogicalChannel[]
}

export interface ChannelCatalogCache {
  apiVersion: string
  channels: NinetyLogicalChannel[]
}

// Returns the locally-cached catalog, if any, matching `country` and the
// current cache schema — without making a network call. Use this for a
// synchronous first paint; call refreshChannelCatalog to check ninety-api
// for a newer version in the background.
export function loadCachedChannelCatalog(country: string | null = null): ChannelCatalogCache | null {
  const stored = readStored<StoredChannelCatalog | null>(CHANNEL_CATALOG_KEY, null)
  if (!stored) return null
  if (stored.schemaVersion !== CHANNEL_CATALOG_CACHE_SCHEMA_VERSION) return null
  if (stored.country !== country) return null
  return { apiVersion: stored.apiVersion, channels: stored.channels }
}

// Fetches the catalog from ninety-api and updates the local cache only
// when the content fingerprint (`version`) actually changed — cheap to
// call on every app start, since an unchanged catalog is a small GET plus
// a version-string comparison, not a full localStorage rewrite.
export async function refreshChannelCatalog(country: string | null = null): Promise<ChannelCatalogCache> {
  const cached = loadCachedChannelCatalog(country)
  const { version, channels } = await getChannelCatalog({ country: country ?? undefined })

  if (cached && cached.apiVersion === version) return cached

  writeStored<StoredChannelCatalog>(CHANNEL_CATALOG_KEY, {
    schemaVersion: CHANNEL_CATALOG_CACHE_SCHEMA_VERSION,
    apiVersion: version,
    country,
    channels,
  })
  return { apiVersion: version, channels }
}

export function clearChannelCatalogCache(): void {
  try {
    localStorage.removeItem(CHANNEL_CATALOG_KEY)
  } catch {
    // Storage unavailable — nothing to clear.
  }
}
