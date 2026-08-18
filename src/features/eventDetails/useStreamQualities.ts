// Quality hints for the "Available On" list, derived purely from metadata
// already in memory (see rankStreamQuality.ts) — deliberately does NOT
// probe real streams. Event Details can be opened for any match with
// multiple candidate channels, and probing each one opens a real
// connection to the user's IPTV panel; on accounts with a low simultaneous-
// connection limit that can exhaust the allowance before Play is ever
// pressed. See data/streamQuality.ts for the (unused-by-default) real
// prober, kept only for callers that explicitly want a measured value for
// a single already-chosen stream.
import { bestQualityTier, qualityTierLabel } from './rankStreamQuality'
import type { QualityTier } from './rankStreamQuality'
import type { MatchGroup } from './groupChannelMatches'

export type QualityState = { tier: QualityTier; label: string | null } | null
export type QualityByGroup = Map<string, QualityState>

export function useStreamQualities(groups: MatchGroup[]): QualityByGroup {
  const map: QualityByGroup = new Map()
  for (const group of groups) {
    const tier = bestQualityTier(group)
    map.set(group.key, tier > 0 ? { tier, label: qualityTierLabel(tier) } : null)
  }
  return map
}
