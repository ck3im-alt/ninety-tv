// Ranks duplicate channel matches by *likely* quality using only the
// metadata already sitting in memory (playlist-supplied quality tag, e.g.
// "UHD"/"RAW", plus the channel/source name text) — never by opening a
// real connection to the stream. Probing every candidate via
// data/streamQuality.ts would burn concurrent-connection slots on IPTV
// accounts that only allow one or two, before the user has even pressed
// Play (see blueprint section 40). This is a best guess for sort order and
// an optional badge, not a verified measurement — an "8K" label means the
// playlist/provider *describes* this source as 8K, not that Ninety
// measured a real 7680×4320 stream.
import { foldForMatching } from '../../data/fancyUnicode'
import type { MatchGroup, SourceOption } from './groupChannelMatches'

export type QualityTier = 5 | 4 | 3 | 2 | 1 | 0

// Checked in descending order so e.g. "UHD" wins over a coincidental "HD"
// substring match — \b word boundaries already prevent "HD" from matching
// inside "UHD" (no boundary between the "U" and "H"), but evaluating
// highest-first is the belt-and-braces guarantee regardless of pattern
// shape. Matched against fancy-Unicode-folded, uppercased text (see
// evidenceText below), so patterns are written upper-case, no `i` flag
// needed. Deliberately excludes codec/marketing words that aren't
// themselves a resolution — HEVC/H264/H265/RAW/VIP never appear here, so
// "8K HEVC" still resolves to 8K (from "8K") while bare "HEVC" resolves to
// unknown, never a fabricated tier.
const TIER_PATTERNS: Array<{ tier: QualityTier; pattern: RegExp }> = [
  { tier: 5, pattern: /\b8K\b/ },
  { tier: 4, pattern: /\b(UHD|ULTRA HD|4K)\b/ },
  { tier: 3, pattern: /\b(FHD|FULL HD|RAW HD|1080P?)\b/ },
  { tier: 2, pattern: /\b(HD|720P?)\b/ },
  { tier: 1, pattern: /\bSD\b/ },
]

// The richest evidence available, checked together rather than stopping at
// the first field that happens to be non-empty — a quality tag can survive
// in one field and not another depending on exactly where ingest-time
// display normalization (mergeChannels.ts's normalizeChannelName, or this
// feature's own PPV display cleanup — see ppvDisplayName.ts) happened to
// strip it. source.originalName/channel.rawNames carry the pre-normalization
// raw provider text, which is often the ONLY place a mid-string tag (e.g.
// "... | 8K EXCLUSIVE | NO: TV2 PLAY PPV 9") still survives once the
// cleaned display name has dropped it — see the redesign task's explicit
// "raw metadata must remain quality evidence" requirement. Concatenated so
// a tier found in ANY field counts, since we want the best real signal
// available, not just whichever field happens to be checked first.
function evidenceText(option: SourceOption): string {
  const parts = [option.source.label, option.source.originalName, option.channel.name, ...(option.channel.rawNames ?? [])]
  return foldForMatching(parts.filter((p): p is string => Boolean(p)).join(' '))
}

export function estimateQualityTier(option: SourceOption): QualityTier {
  const text = evidenceText(option)
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
    case 5:
      return '8K'
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
