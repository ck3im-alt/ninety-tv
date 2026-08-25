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
import { parseCategory, isPpvCategory } from '../channels/parseCategory'
import { COUNTRY_NAMES } from '../../data/countryCodes'
import type { StreamTypePreference } from '../../data/preferences'
import type { ChannelMatch } from '../../data/sports/channelMatch'
import type { Channel, ChannelSource } from '../../data/channel'

export interface EventStreamSourceOption {
  channel: Channel
  source: ChannelSource
  qualityTier: QualityTier
  qualityLabel: string | null
}

// Consumer-facing source-type classification (see the stream-groups task,
// sections 7-9): 'tv' is a real linear broadcast channel, 'event' is an
// event-specific feed (what IPTV panels label "PPV" — that word stays
// internal/debug-only; the UI says "TV"/"Event"). Derived from evidence the
// pipeline already has: a group matched via the one-off-PPV-entry stage, or
// whose playlist category is PPV-classified, is an event feed; everything
// else (ninety/broadcasterMap/EPG matches on ordinary categories) is TV.
export type StreamSourceType = 'tv' | 'event'

export interface EventStreamOption {
  key: string
  displayName: string
  logo?: string
  countryName: string | null
  // ISO-ish short code for the same country ("NO", "UK") when known — the
  // stream list's fixed-width country column renders flag + code instead of
  // a variable-width full name (see the stream-groups task, section 12).
  countryCode: string | null
  sourceType: StreamSourceType
  matchConfidence: StreamMatchConfidence
  // Which matching stage produced this — see groupChannelMatches.ts's
  // MatchGroup.matchSource. Display/debug metadata only.
  matchSource: ChannelMatch['source']
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
// Exported for reuse by Multiview's channel-only pane path (no event, so
// there's no MatchGroup to run through buildEventStreamOptions at all) —
// see multiview/multiviewCandidates.ts — rather than reimplementing the
// same tier-dedup/best-first-sort logic.
export function dedupeSourcesByTier(sourceOptions: SourceOption[]): EventStreamSourceOption[] {
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
function resolveCountry(group: MatchGroup): { countryName: string | null; countryCode: string | null } {
  for (const { channel } of group.sourceOptions) {
    const { countryName, countryCode } = parseCategory(channel.groupTitle ?? '')
    if (countryName) return { countryName, countryCode }
  }
  if (group.broadcastCountry) {
    const code = group.broadcastCountry.toUpperCase()
    const name = COUNTRY_NAMES[code] ?? null
    return { countryName: name, countryCode: name ? code : null }
  }
  return { countryName: null, countryCode: null }
}

// See StreamSourceType above. The representative channel's playlist
// category and the group's best-trusted match stage are the two existing
// signals that already distinguish an event-specific feed from a linear
// channel — no new classification machinery.
function resolveSourceType(group: MatchGroup): StreamSourceType {
  if (group.matchSource === 'ppvName') return 'event'
  const representative = group.sourceOptions[0]?.channel
  return isPpvCategory(parseCategory(representative?.groupTitle ?? '')) ? 'event' : 'tv'
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
  return groupChannelMatches(matches, eventContext).map((group) => {
    const sourceOptions = dedupeSourcesByTier(group.sourceOptions)
    return {
      key: group.key,
      displayName: getChannelDisplayName(group, eventContext),
      logo: group.logo,
      ...resolveCountry(group),
      sourceType: resolveSourceType(group),
      matchConfidence: group.confidence,
      matchSource: group.matchSource,
      displayParts: buildEventStreamDisplayParts(group.name, eventContext, sourceOptions[0]?.qualityLabel ?? null),
      sourceOptions,
      bestQualityTier: sourceOptions[0]?.qualityTier ?? 0,
      isFavorite: group.sourceOptions.some((option) => favoriteChannels.has(option.channel.id)),
    }
  })
}

// The preference inputs stream ranking reads — a projection of
// SportPreferences (see data/preferences.ts), taken as its own shape so
// tests and Multiview don't have to fabricate sports/league fields that
// ranking never looks at. favoriteCountries is ORDERED: index 0 is the
// primary country (see SportPreferences.favoriteCountries).
export interface StreamRankingPreferences {
  favoriteCountries: readonly string[]
  streamType: StreamTypePreference
}

export interface RankedEventStreamOption extends EventStreamOption {
  rankingScore: number
  // Whether this option cleared the Recommended eligibility bar (see
  // isRecommendable below) — carried on the option so every consumer
  // (filter pills, row styling, dev debug) reads one precomputed answer.
  recommended: boolean
}

// One additive score per stream GROUP (a group already collapsed its
// quality-variant duplicates — see groupChannelMatches/dedupeSourcesByTier
// — so identical FHD/HD/SD entries can never occupy several ranking
// positions). Correctness/safety is enforced by partitionStreamOptions and
// isRecommendable, NOT by this score: a 'candidate' group is excluded from
// Recommended unconditionally regardless of how high it scores, so scoring
// is free to optimize purely for desirability among trusted options.
//
// Country relevance is deliberately NOT the dominant term here any more —
// see countryBucketRank/rankEventStreamOptions below, which sort by country
// BUCKET first and use this score only as the tie-break WITHIN one bucket
// (task: "country grouping, then ranking within country — not one global
// score that mixes all countries together"). The countryTier term below is
// kept only because it's harmless: every option within a single bucket
// shares the exact same countryTier value (same bucket = same relationship
// to the user's preferred countries), so it can never change the ORDER of
// two options in the same bucket — it just keeps the displayed
// `rankingScore` (dev debug panel) reflecting country relevance too, for a
// human reading raw scores.
// - quality (+10 per tier, 0-5): the dominant within-bucket factor.
// - confidence (+9 per level, 0-2): a real tie-break (confirmed edges out
//   likely when quality ties) that a single quality tier already outweighs
//   — the established "8K likely PPV beats 720p confirmed" rule.
// - stream-type preference (+12 when the group's type matches a non-auto
//   preference): worth about one quality tier — enough to flip
//   otherwise-comparable streams toward the preferred type, never enough
//   to bury a clearly better stream of the other type. 'auto' adds nothing
//   to anything.
// - favorite channel (+2): the smallest deliberate nudge, below every
//   other factor's step size.
export function scoreEventStreamOption(option: EventStreamOption, prefs: StreamRankingPreferences): number {
  const countryTier = option.countryName == null ? 0 : prefs.favoriteCountries[0] === option.countryName ? 2 : prefs.favoriteCountries.includes(option.countryName) ? 1 : 0
  const typeMatches = prefs.streamType !== 'auto' && option.sourceType === prefs.streamType
  return countryTier * 24 + option.bestQualityTier * 10 + confidenceRank(option.matchConfidence) * 9 + (typeMatches ? 12 : 0) + (option.isFavorite ? 2 : 0)
}

// The OUTER sort key (task sections 1/9/14): 0 for the user's PRIMARY
// country (favoriteCountries[0]), 1..N-1 for each other preferred country
// IN STORED ORDER (so a user's own Sweden-before-UK ordering is preserved),
// and one shared bucket for everything else — unknown country and any
// country not on the preferred list alike, since neither has any claim to
// being shown ahead of the other. With no preferred countries at all
// (favoriteCountries.length === 0), every option lands in that same shared
// bucket, so ordering falls through entirely to score — i.e. this is a
// no-op exactly when there's no country preference to express, matching the
// pre-existing "no preferences -> score decides everything" behavior.
export function countryBucketRank(option: EventStreamOption, favoriteCountries: readonly string[]): number {
  if (option.countryName == null) return favoriteCountries.length + 1
  const index = favoriteCountries.indexOf(option.countryName)
  return index === -1 ? favoriteCountries.length + 1 : index
}

// Recommended is an ELIGIBILITY bar, not a fixed count (the old "Top 3"
// slice is gone — see the stream-groups task, section 4): every trusted
// group that a user would realistically reach for qualifies, however many
// that is. The bar:
// - 'confirmed' (exact identity): always recommended.
// - 'likely' (real, watchable evidence that isn't literally exact):
//   recommended when it's in a preferred country, or the user has no
//   country preferences to discriminate by at all, or it's a standout
//   quality (UHD/8K) worth surfacing regardless of market — a likely match
//   in a random non-preferred market at ordinary quality stays in All
//   rather than diluting Recommended.
// - 'candidate' (loose/fuzzy): never, regardless of score — a preferred
//   country or high quality tag must not promote an ambiguous match over
//   real evidence (task section 20).
// Stream-type preference deliberately plays no part here: it reorders
// within Recommended (via the score), and the match-view TV/Event filters
// handle display — a type preference must never hide the only real way to
// watch.
function isRecommendable(option: EventStreamOption, prefs: StreamRankingPreferences): boolean {
  if (option.matchConfidence === 'candidate') return false
  if (option.matchConfidence === 'confirmed') return true
  const preferredCountry = option.countryName != null && prefs.favoriteCountries.includes(option.countryName)
  return preferredCountry || prefs.favoriteCountries.length === 0 || option.bestQualityTier >= 4
}

// Deterministic ranking: country BUCKET first (see countryBucketRank —
// primary country, then each other preferred country in the user's own
// stored order, then everything else as one shared bucket), score
// descending as the tie-break WITHIN a bucket, stable incoming order (the
// existing match/source-priority order — see channelMatch.ts's
// SOURCE_PRIORITY) as the final tie-break. Returns new objects carrying the
// score and Recommended eligibility; never mutates the input.
//
// This is a deliberate change from a single weighted score that mixed
// country into the same number as quality/confidence: a user's primary
// country must never be buried below a higher-quality stream from an
// unrelated market (task sections 1/9/14) — eligibility (isRecommendable,
// unaffected by any of this) still gates which options are trustworthy
// enough to rank at all; once eligible, country bucket strictly dominates.
export function rankEventStreamOptions(
  options: EventStreamOption[],
  prefs: StreamRankingPreferences,
): RankedEventStreamOption[] {
  return options
    .map((option, index) => ({ option: { ...option, rankingScore: scoreEventStreamOption(option, prefs), recommended: isRecommendable(option, prefs) }, index }))
    .sort(
      (a, b) =>
        countryBucketRank(a.option, prefs.favoriteCountries) - countryBucketRank(b.option, prefs.favoriteCountries) ||
        b.option.rankingScore - a.option.rankingScore ||
        a.index - b.index,
    )
    .map((entry) => entry.option)
}

// ---------- Country grouping (task sections 2/9/11) ----------
// Splits an ALREADY bucket-ordered list (rankEventStreamOptions's own
// output, or any order-preserving subset of it — e.g. optionsForFilter's
// results) into contiguous visual sections: one per preferred country
// (primary first, marked 'primary'; each other preferred country in the
// user's stored order, marked 'preferred'), plus one shared 'other' section
// for everything else — never subdivided by country (see the redesign
// task's UI mockup: "OTHER COUNTRIES" is one flat, unheaded-per-country
// list, matching how little a user's non-preferred markets need
// distinguishing from each other). Relies entirely on the input already
// being bucket-sorted; this never re-sorts anything itself.
export interface CountryGroupSection {
  kind: 'primary' | 'preferred' | 'other'
  // null for 'other' — that section deliberately mixes countries, so no
  // single name/flag represents it.
  countryName: string | null
  countryCode: string | null
  options: RankedEventStreamOption[]
}

export function groupOptionsByCountry(
  options: readonly RankedEventStreamOption[],
  favoriteCountries: readonly string[],
): CountryGroupSection[] {
  const sections: CountryGroupSection[] = []
  let lastBucket: number | null = null
  for (const option of options) {
    const bucket = countryBucketRank(option, favoriteCountries)
    if (lastBucket === bucket) {
      sections[sections.length - 1].options.push(option)
      continue
    }
    const kind: CountryGroupSection['kind'] = bucket === 0 ? 'primary' : bucket < favoriteCountries.length ? 'preferred' : 'other'
    sections.push({
      kind,
      countryName: kind === 'other' ? null : option.countryName,
      countryCode: kind === 'other' ? null : option.countryCode,
      options: [option],
    })
    lastBucket = bucket
  }
  return sections
}

export interface PartitionedStreamOptions {
  // Trusted options that cleared the Recommended bar, in rank order —
  // dynamic length, never padded and never capped at 3.
  recommended: RankedEventStreamOption[]
  // ALL trusted (confirmed/likely) options in rank order — a superset of
  // `recommended`, what the "All" view shows. Both views render the same
  // underlying group objects; Recommended is purely a filtered subset.
  trusted: RankedEventStreamOption[]
  // Loose/fuzzy candidates — never recommended, regardless of quality or
  // country match.
  candidates: RankedEventStreamOption[]
}

// Expects `ranked` to already be sorted (rankEventStreamOptions) — this
// only partitions by trust tier / recommendation flag, it doesn't re-sort.
export function partitionStreamOptions(ranked: RankedEventStreamOption[]): PartitionedStreamOptions {
  const trusted = ranked.filter((option) => option.matchConfidence !== 'candidate')
  const candidates = ranked.filter((option) => option.matchConfidence === 'candidate')
  return { recommended: trusted.filter((option) => option.recommended), trusted, candidates }
}

// ---------- Match-view display filters (task section 8) ----------
// A display-time filter over the already-ranked groups — completely
// separate from the persistent streamType RANKING preference: the
// preference nudges order, the filter narrows what's currently shown.

export type StreamFilter = 'recommended' | 'all' | 'tv' | 'event'

// Which filter pills are worth showing for this partition (task section
// 22's edge states):
// - one displayable group total (or none): no pills at all — a filter bar
//   over a single row is pure noise.
// - 'recommended' only when it's a real subset: non-empty AND narrower
//   than what 'all' shows (fewer trusted groups, or candidates that All
//   reveals) — when Recommended would equal All exactly, one list under
//   one 'all' pill says it cleanly instead of two identical tabs.
// - 'tv'/'event' only when BOTH types exist among trusted groups — with
//   only one type present the type filters are either identical to All or
//   an empty page, so they're dropped rather than disabled.
export function availableStreamFilters(partitioned: PartitionedStreamOptions): StreamFilter[] {
  const totalGroups = partitioned.trusted.length + partitioned.candidates.length
  if (totalGroups <= 1) return []

  const filters: StreamFilter[] = []
  const recommendedIsSubset = partitioned.recommended.length < partitioned.trusted.length || partitioned.candidates.length > 0
  if (partitioned.recommended.length > 0 && recommendedIsSubset) filters.push('recommended')
  filters.push('all')
  const hasTv = partitioned.trusted.some((o) => o.sourceType === 'tv')
  const hasEvent = partitioned.trusted.some((o) => o.sourceType === 'event')
  if (hasTv && hasEvent) filters.push('tv', 'event')
  return filters
}

export interface FilteredStreamOptions {
  options: RankedEventStreamOption[]
  // Loose/fuzzy candidates shown (collapsed) under this filter — only the
  // 'all' view surfaces them; the focused views stay clean.
  candidates: RankedEventStreamOption[]
}

export function optionsForFilter(partitioned: PartitionedStreamOptions, filter: StreamFilter): FilteredStreamOptions {
  switch (filter) {
    case 'recommended':
      return { options: partitioned.recommended, candidates: [] }
    case 'all':
      return { options: partitioned.trusted, candidates: partitioned.candidates }
    case 'tv':
      return { options: partitioned.trusted.filter((o) => o.sourceType === 'tv'), candidates: [] }
    case 'event':
      return { options: partitioned.trusted.filter((o) => o.sourceType === 'event'), candidates: [] }
  }
}
