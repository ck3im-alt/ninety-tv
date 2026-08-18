// Runtime wrapper around Channel Identity Resolver v2's pure output
// (resolveChannelIdentities — see channelIdentityResolver.ts), built ONCE
// per (catalog version, playlist) pair and reused by every event's
// matching pass. The resolver's own cost is real — measured at ~6s median
// against a real 30,925-channel playlist / 115-channel catalog even after
// the candidate-generation optimization (down from several minutes
// unoptimized) — so the whole point of this class existing is that cost is
// paid once per rebuild, never once per event. See useChannelIdentityIndex.ts
// for the lifecycle that decides WHEN to build/rebuild/reuse one of these.
import { resolveChannelIdentities } from './channelIdentityResolver'
import type { IdentityClassification, LogicalChannelResolution } from './channelIdentityResolver'
import type { NinetyLogicalChannel } from './ninetyApiClient'
import type { Channel } from '../channel'

const AUTO_WATCHABLE: ReadonlySet<IdentityClassification> = new Set(['CONFIRMED', 'STRONG'])

export class ChannelIdentityIndex {
  // The catalog content-fingerprint (see ninetyApiClient.ts's
  // getChannelCatalog) this index was built from — lets a caller compare
  // against a freshly-fetched catalog's version without re-deriving it.
  readonly catalogVersion: string
  private readonly resolutions: Map<string, LogicalChannelResolution>

  constructor(catalogVersion: string, catalog: NinetyLogicalChannel[], playlist: Channel[]) {
    this.catalogVersion = catalogVersion
    this.resolutions = resolveChannelIdentities(catalog, playlist)
  }

  // The full resolution (classification, matched playlist channels, and
  // their signals/negative signals) for one logical channel — undefined
  // only when the catalog itself has no such id (e.g. a stale cached
  // catalog predating a newly added logical channel). Use this when
  // AMBIGUOUS/NONE detail matters (diagnostics), not just whether it's
  // automatically watchable.
  getResolution(logicalChannelId: string): LogicalChannelResolution | undefined {
    return this.resolutions.get(logicalChannelId)
  }

  // Only CONFIRMED/STRONG playlist channels for this logical channel —
  // never AMBIGUOUS or NONE (see the resolver-integration task: AMBIGUOUS
  // must not surface as a normal automatic stream match). This is the one
  // entry point live event matching (channelMatch.ts's matchViaNinetyApi)
  // should use.
  getPlaylistChannels(logicalChannelId: string): Channel[] {
    const res = this.resolutions.get(logicalChannelId)
    if (!res || !AUTO_WATCHABLE.has(res.classification)) return []
    return res.matches.map((m) => m.channel)
  }
}
