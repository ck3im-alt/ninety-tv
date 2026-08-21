// Turns matched/grouped channels into the personalized, ranked stream list
// Event Details actually renders — see the redesign task's "New internal
// model" section. Reuses groupChannelMatches (duplicate-channel grouping),
// rankStreamQuality (metadata-only quality tiers, never a real stream
// probe), streamConfidence (trust tier from existing match evidence), and
// ppvDisplayName (display identity) rather than reimplementing any of them.
import { groupChannelMatches } from './groupChannelMatches'
import type { MatchGroup, SourceOption } from './groupChannelMatches'
import { estimateQualityTier, qualityTierLabel } from './rankStreamQuality'
import type { QualityTier } from './rankStreamQuality'
import { getChannelDisplayName, buildEventStreamDisplayParts } from './ppvDisplayName'
import type { PpvDisplayNameContext, EventStreamDisplayParts } from './ppvDisplayName'
import { confidenceRank } from './streamConfidence'
import type { StreamMatchConfidence } from './streamConfidence'
import { parseCategory } from '../channels/parseCategory'
import { COUNTRY_NAMES } from '../../data/countryCodes'
import type { ChannelMatch } from '../../data/sports/channelMatch'
import type { Channel, ChannelSource } from '../../data/channel'

export interface EventStreamSourceOption {
  channel: Channel
  source: ChannelSource
  qualityTier: QualityTier
  qualityLabel: string | null
}

export interface EventStreamOption {
  key: string
  displayName: string
  logo?: string
  countryName: string | null
  matchConfidence: StreamMatchConfidence
  // Structured contextual identity (provider/event title/start time/best
  // quality) — see ppvDisplayName.ts's EventStreamDisplayParts. `displayName`
  // above is already the right single-line text for Event Details' own
  // rows (quality omitted, since StreamRow renders quality via its own
  // pills — see Part X of the redesign task); this is exposed separately
  // so a DIFFERENT consumer with no such pills (the full-screen player
  // overlay, see App.tsx's watchChannel/ChannelPlayerScreen) can compose
  // its own full line (provider + event + time + quality) from the SAME
  // underlying parts instead of re-deriving them or duplicating quality UI.
  displayParts: EventStreamDisplayParts
  // Best quality tier first, one entry per distinct quality tier (see
  // dedupeSourcesByTier) — sourceOptions[0] is always the correct default
  // selection ("select the best one initially").
  sourceOptions: EventStreamSourceOption[]
  bestQualityTier: QualityTier
  isFavorite: boolean
}

// Collapses same-tier duplicate source options down to one deterministic
// pick per tier (first occurrence in the group's existing source order),
// so the quality picker never shows "1080p 1080p 1080p" — see the redesign
// task's quality-options section. A group whose sources are all
// unrecognized quality (tier 0) reduces to exactly one entry, which the UI
// renders with no quality pill at all rather than a fabricated one.
function dedupeSourcesByTier(sourceOptions: SourceOption[]): EventStreamSourceOption[] {
  const byTier = new Map<QualityTier, EventStreamSourceOption>()
  for (const option of sourceOptions) {
    const tier = estimateQualityTier(option)
    if (!byTier.has(tier)) {
      byTier.set(tier, { channel: option.channel, source: option.source, qualityTier: tier, qualityLabel: qualityTierLabel(tier) })
    }
  }
  return [...byTier.values()].sort((a, b) => b.qualityTier - a.qualityTier)
}

// Every source option within one MatchGroup shares the same parsed
// playlist country by construction (groupKey scopes grouping to
// country + canonical name — see groupChannelMatches.ts), so the first
// option's own groupTitle is a safe representative to parse. Falls back to
// ninety-api's own reported broadcast country (see channelMatch.ts's
// matchViaNinetyApi) when the playlist category itself has no parseable
// country prefix — converted through the same COUNTRY_NAMES vocabulary
// parseCategory itself uses, never a separately-maintained label.
function resolveCountryName(group: MatchGroup): string | null {
  for (const { channel } of group.sourceOptions) {
    const { countryName } = parseCategory(channel.groupTitle ?? '')
    if (countryName) return countryName
  }
  if (group.broadcastCountry) return COUNTRY_NAMES[group.broadcastCountry.toUpperCase()] ?? null
  return null
}

// Groups the raw matches (see channelMatch.ts) into one displayable option
// per real channel, with display identity, country, and deduplicated
// quality/source choices already resolved. Ranking/selection happen
// separately (rankEventStreamOptions/partitionStreamOptions) — this only
// builds the option set.
export function buildEventStreamOptions(
  matches: ChannelMatch[],
  favoriteChannels: ReadonlySet<string>,
  eventContext?: PpvDisplayNameContext,
): EventStreamOption[] {
  return groupChannelMatches(matches).map((group) => {
    const sourceOptions = dedupeSourcesByTier(group.sourceOptions)
    return {
      key: group.key,
      displayName: getChannelDisplayName(group, eventContext),
      logo: group.logo,
      countryName: resolveCountryName(group),
      matchConfidence: group.confidence,
      displayParts: buildEventStreamDisplayParts(group.name, eventContext, sourceOptions[0]?.qualityLabel ?? null),
      sourceOptions,
      bestQualityTier: sourceOptions[0]?.qualityTier ?? 0,
      isFavorite: group.sourceOptions.some((option) => favoriteChannels.has(option.channel.id)),
    }
  })
}

// Deterministic ranking. Correctness/safety is enforced by
// partitionStreamOptions below, NOT by this comparator: a candidate is
// filtered out of `top`/`rest` unconditionally, regardless of where it
// happens to land here, so ranking is free to optimize purely for
// desirability among options that already cleared the trust bar. Per the
// redesign task's second pass: "first reject uncertain candidates, then
// rank the remaining trusted streams primarily for desirability" — a minor
// confirmed-vs-likely distinction must not permanently outrank a
// dramatically better trusted stream (e.g. an 8K event-specific PPV feed
// over a 720p stable linear channel, both in the user's preferred
// country).
//
// Priority order:
// 1. preferred-country relevance (SportPreferences.favoriteCountries).
// 2. best available quality tier.
// 3. confidence/reliability — still a real tie-break within the trusted
//    set (confirmed edges out likely when country+quality already tie),
//    just no longer an unconditional override.
// 4. favorite-channel status — a small tie-break only.
// 5. stable incoming order (the existing match/source-priority order —
//    see channelMatch.ts's SOURCE_PRIORITY) as the final tie-break.
export function rankEventStreamOptions(
  options: EventStreamOption[],
  favoriteCountries: readonly string[],
): EventStreamOption[] {
  const favoriteCountrySet = new Set(favoriteCountries)
  return options
    .map((option, index) => ({ option, index }))
    .sort((a, b) => {
      const aPreferredCountry = a.option.countryName != null && favoriteCountrySet.has(a.option.countryName) ? 1 : 0
      const bPreferredCountry = b.option.countryName != null && favoriteCountrySet.has(b.option.countryName) ? 1 : 0
      if (aPreferredCountry !== bPreferredCountry) return bPreferredCountry - aPreferredCountry

      const qualityDiff = b.option.bestQualityTier - a.option.bestQualityTier
      if (qualityDiff !== 0) return qualityDiff

      const confidenceDiff = confidenceRank(b.option.matchConfidence) - confidenceRank(a.option.matchConfidence)
      if (confidenceDiff !== 0) return confidenceDiff

      const favoriteDiff = (b.option.isFavorite ? 1 : 0) - (a.option.isFavorite ? 1 : 0)
      if (favoriteDiff !== 0) return favoriteDiff

      return a.index - b.index
    })
    .map((entry) => entry.option)
}

export interface PartitionedStreamOptions {
  // Up to the first 3 trusted (confirmed/likely) options, in rank order —
  // never padded out with candidate/fuzzy streams to reach 3.
  top: EventStreamOption[]
  // Remaining trusted options beyond the top 3.
  rest: EventStreamOption[]
  // Loose/fuzzy candidates — never eligible for `top`, regardless of
  // quality or country match.
  candidates: EventStreamOption[]
}

// Expects `ranked` to already be sorted (rankEventStreamOptions) — this
// only partitions by trust tier and slices the top 3, it doesn't re-sort.
export function partitionStreamOptions(ranked: EventStreamOption[]): PartitionedStreamOptions {
  const trusted = ranked.filter((option) => option.matchConfidence !== 'candidate')
  const candidates = ranked.filter((option) => option.matchConfidence === 'candidate')
  return { top: trusted.slice(0, 3), rest: trusted.slice(3), candidates }
}
