// Ranks duplicate channel matches by *likely* quality using only the
// metadata already sitting in memory (playlist-supplied quality tag, e.g.
// "UHD"/"RAW", plus the channel/source name text) — never by opening a
// real connection to the stream. Probing every candidate via
// data/streamQuality.ts would burn concurrent-connection slots on IPTV
// accounts that only allow one or two, before the user has even pressed
// Play (see blueprint section 40). This is a best guess for sort order and
// an optional badge, not a verified measurement.
import type { MatchGroup, SourceOption } from './groupChannelMatches'

export type QualityTier = 4 | 3 | 2 | 1 | 0

// Checked in descending order so "UHD" wins over a coincidental "HD"
// substring match, etc.
const TIER_PATTERNS: Array<{ tier: QualityTier; pattern: RegExp }> = [
  { tier: 4, pattern: /\b(UHD|ULTRA HD|4K)\b/i },
  { tier: 3, pattern: /\b(FHD|RAW HD|1080p?)\b/i },
  { tier: 2, pattern: /\b(HD|720p?)\b/i },
  { tier: 1, pattern: /\bSD\b/i },
]

// Looks at the source's own quality label first (already extracted at
// ingest time from the raw playlist entry name, see data/normalize.ts's
// extractQualityTag) and falls back to the channel's display name in case
// the tag didn't make it into the label for some reason.
export function estimateQualityTier(option: SourceOption): QualityTier {
  const text = `${option.source.label} ${option.channel.name}`
  for (const { tier, pattern } of TIER_PATTERNS) {
    if (pattern.test(text)) return tier
  }
  return 0
}

// A group can contain several source options (e.g. the same channel listed
// once per quality tier); it's ranked by the best one it offers.
export function bestQualityTier(group: MatchGroup): QualityTier {
  let best: QualityTier = 0
  for (const option of group.sourceOptions) {
    const tier = estimateQualityTier(option)
    if (tier > best) best = tier
  }
  return best
}

export function qualityTierLabel(tier: QualityTier): string | null {
  switch (tier) {
    case 4:
      return 'UHD'
    case 3:
      return '1080p'
    case 2:
      return '720p'
    case 1:
      return 'SD'
    default:
      return null
  }
}

// Stable sort, best tier first. Groups that tie (including the common case
// of no quality hint at all, tier 0) keep their incoming relative order —
// that's the existing source/match ordering, used deliberately as the
// fallback per the "safe ranking without probing" requirement.
export function sortGroupsByQuality(groups: MatchGroup[]): MatchGroup[] {
  return groups
    .map((group, index) => ({ group, index, tier: bestQualityTier(group) }))
    .sort((a, b) => b.tier - a.tier || a.index - b.index)
    .map((entry) => entry.group)
}
