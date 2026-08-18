// Runtime wrapper around Channel Identity Resolver v2's already-computed
// resolutions (see channelIdentityResolver.ts's resolveChannelIdentities),
// built ONCE per (catalog version, playlist) pair and reused by every
// event's matching pass. This class itself is CHEAP to construct — the
// expensive resolveChannelIdentities call happens off the main thread (see
// channelIdentityWorker.ts/channelIdentityWorkerClient.ts) and its result is
// handed in here already computed; this class's only job is holding that
// result plus a Map<Channel.id, Channel> so `getPlaylistChannels` can turn
// the resolver's plain playlistChannelId strings back into real, stream-
// bearing Channel objects. See channelIdentityLifecycle.ts for the
// cached/refresh/rebuild lifecycle that decides WHEN to build/rebuild/reuse
// one of these.
import type { IdentityClassification, LogicalChannelResolution, MatchSignal, NegativeSignal } from './channelIdentityResolver'
import type { Channel } from '../channel'

const AUTO_WATCHABLE: ReadonlySet<IdentityClassification> = new Set(['CONFIRMED', 'STRONG'])

// The public, main-thread-facing shape of a resolved candidate — same
// fields as the resolver's own IdentityCandidateMatch, except
// playlistChannelId is hydrated back into the real Channel it identifies.
// Existing callers (channelMatch.ts) depended on this exact shape before
// the resolver-integration task moved the resolver itself onto
// playlistChannelId strings, so ChannelIdentityIndex.getResolution
// preserves it here rather than changing every downstream consumer.
export interface HydratedCandidateMatch {
  channel: Channel
  score: number
  signals: MatchSignal[]
  negativeSignals: NegativeSignal[]
}

export interface HydratedLogicalChannelResolution {
  logicalChannelId: string
  classification: IdentityClassification
  matches: HydratedCandidateMatch[]
  runnerUpScore?: number
  margin?: number
}

export class ChannelIdentityIndex {
  // The catalog content-fingerprint (see ninetyApiClient.ts's
  // getChannelCatalog) this index was built from — lets a caller compare
  // against a freshly-fetched catalog's version without re-deriving it.
  readonly catalogVersion: string
  private readonly resolutions: Map<string, LogicalChannelResolution>
  private readonly channelsById: Map<string, Channel>

  constructor(catalogVersion: string, resolutions: Map<string, LogicalChannelResolution>, playlist: Channel[]) {
    this.catalogVersion = catalogVersion
    this.resolutions = resolutions
    this.channelsById = new Map(playlist.map((c) => [c.id, c]))
  }

  // The full resolution (classification, matched playlist channels, and
  // their signals/negative signals) for one logical channel — undefined
  // only when the catalog itself has no such id (e.g. a stale cached
  // catalog predating a newly added logical channel). Use this when
  // AMBIGUOUS/NONE detail matters (diagnostics), not just whether it's
  // automatically watchable.
  getResolution(logicalChannelId: string): HydratedLogicalChannelResolution | undefined {
    const res = this.resolutions.get(logicalChannelId)
    if (!res) return undefined
    const matches: HydratedCandidateMatch[] = []
    for (const m of res.matches) {
      const channel = this.channelsById.get(m.playlistChannelId)
      // Only theoretically possible if a resolution referenced a playlist
      // channel id from a DIFFERENT playlist than the one this index was
      // built for — never happens through the normal build path, but
      // dropping it silently here is safer than surfacing a broken match.
      if (channel) matches.push({ channel, score: m.score, signals: m.signals, negativeSignals: m.negativeSignals })
    }
    return { logicalChannelId: res.logicalChannelId, classification: res.classification, matches, runnerUpScore: res.runnerUpScore, margin: res.margin }
  }

  // Only CONFIRMED/STRONG playlist channels for this logical channel —
  // never AMBIGUOUS or NONE (see the resolver-integration task: AMBIGUOUS
  // must not surface as a normal automatic stream match). This is the one
  // entry point live event matching (channelMatch.ts's matchViaNinetyApi)
  // should use.
  getPlaylistChannels(logicalChannelId: string): Channel[] {
    const res = this.resolutions.get(logicalChannelId)
    if (!res || !AUTO_WATCHABLE.has(res.classification)) return []
    const channels: Channel[] = []
    for (const m of res.matches) {
      const channel = this.channelsById.get(m.playlistChannelId)
      if (channel) channels.push(channel)
    }
    return channels
  }
}
