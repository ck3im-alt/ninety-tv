// Channel Identity Resolver v2 (Phase 1) — a PURE, LOCAL, DB/network-free
// engine that answers: "for each Ninety logical channel, which entries in
// THIS user's own playlist genuinely represent that station?"
//
// This is deliberately NOT wired into channelMatch.ts / matchViaNinetyApi
// yet (see the project task for this phase). It exists so identity
// resolution can be built, gold-tested, and tuned in isolation before it
// ever touches live event matching. Nothing in this module makes a network
// call or reads local storage — every input is a plain in-memory value the
// caller already has.
//
// Signal hierarchy (strongest to weakest), per the phase spec:
//   1. External EPG id (namespace-aware — a playlist tvg-id string alone
//      never tells us which ninety-api `source_id` it came from, so a raw
//      id is only deterministic when it's globally unique across the
//      catalog; see buildExternalIdIndex).
//   2. Canonical/alias/source-name identity (exact, then structured/fuzzy),
//      reusing channelMatchCore.ts's namesOverlap/namesExactMatch — the
//      module carrying this project's real-world false-positive
//      regressions (TV3 vs TV3+, Arena Sport N, TVP siblings, ...).
//   3. Structured corroboration: country, network, explicit channel number.
//
// False positives are treated as more expensive than false negatives
// throughout: hard negative signals (country conflict, channel-number
// conflict, external-id-vs-name contradiction, external-id collision,
// reverse collision) can only ever push a candidate DOWN in confidence —
// nothing in this file makes such a candidate look MORE confirmed.
import type { Channel } from '../channel'
import type { NinetyLogicalChannel } from './ninetyApiClient'
import { parseCategory } from '../../features/channels/parseCategory'
import { meaningfulWords, namesExactMatch, namesOverlap, normalizeCountryKey, qualifierWords, sameSet } from './channelMatchCore'

// ---------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------

export type MatchSignalType =
  | 'exact_unique_external_id'
  | 'external_id_collision'
  | 'exact_canonical_name'
  | 'exact_alias'
  | 'exact_source_name'
  | 'structured_name_match'
  | 'structured_alias_match'
  | 'structured_source_name_match'
  | 'country_match'
  | 'network_match'
  | 'channel_number_match'

export type NegativeSignalType =
  | 'country_conflict'
  | 'channel_number_conflict'
  | 'qualifier_conflict'
  | 'external_id_collision'
  | 'external_id_conflict'
  | 'id_name_contradiction'
  | 'reverse_collision'

export interface MatchSignal {
  type: MatchSignalType
  weight: number
  detail: string
}

export interface NegativeSignal {
  type: NegativeSignalType
  detail: string
}

export interface ChannelCandidateMatch {
  channel: Channel
  score: number
  signals: MatchSignal[]
  negativeSignals: NegativeSignal[]
}

export type IdentityClassification = 'CONFIRMED' | 'STRONG' | 'AMBIGUOUS' | 'NONE'

export interface LogicalChannelResolution {
  logicalChannelId: string
  classification: IdentityClassification
  matches: ChannelCandidateMatch[]
  // The next-best candidate's score once the accepted match(es) are decided
  // (or, for AMBIGUOUS, the runner-up driving the ambiguity) — undefined
  // when there was nothing else to compare against.
  runnerUpScore?: number
  margin?: number
}

// ---------------------------------------------------------------------
// Named, explained scoring constants (Part 5 — no hidden weights).
// ---------------------------------------------------------------------

export const SIGNAL_WEIGHTS = {
  // A raw external id string that, across the WHOLE catalog, resolves to
  // exactly one logical channel — the strongest signal available, since
  // it doesn't depend on name text at all.
  EXACT_UNIQUE_EXTERNAL_ID: 100,
  // Same id string maps to >1 logical channel (namespace collision) — a
  // real signal that SOME relationship exists, but not deterministic on
  // its own; always paired with a negative `external_id_collision` signal
  // and can never by itself clear STRONG_THRESHOLD.
  EXTERNAL_ID_COLLISION_WEAK: 15,
  // A playlist channel whose external id deterministically matches this
  // logical channel, but whose visible name explicitly contradicts it
  // (see structuredConflict) — overrides the id-alone score down to this
  // fixed, always-AMBIGUOUS tier rather than additively combining.
  ID_NAME_CONTRADICTION_SCORE: 40,
  // Same tier used when a merged playlist channel carries multiple
  // distinct external ids, each individually unique, but pointing at
  // different logical channels — we cannot arbitrarily pick one.
  EXTERNAL_ID_MULTI_OWNER: 30,
  EXACT_CANONICAL_NAME: 60,
  EXACT_TRUSTED_ALIAS: 55,
  EXACT_SOURCE_NAME: 45,
  STRUCTURED_NAME_MATCH: 35,
  STRUCTURED_ALIAS_MATCH: 35,
  STRUCTURED_SOURCE_NAME_MATCH: 22,
  COUNTRY_MATCH: 8,
  NETWORK_MATCH: 8,
  CHANNEL_NUMBER_MATCH: 6,
} as const

// A candidate needs at least this score, uncontradicted, to be
// auto-acceptable at all (CONFIRMED or STRONG).
export const STRONG_THRESHOLD = 50
// How far the lowest accepted candidate must lead the best non-accepted
// competitor before classification trusts the separation (mirrors the
// backend event resolver's margin concept).
export const MARGIN_THRESHOLD = 20
// Below this, a candidate isn't worth surfacing even as AMBIGUOUS — pure
// metadata corroboration (country/network) with no name resemblance at
// all is "insufficient evidence" (NONE), not "plausible but uncertain".
export const AMBIGUOUS_MIN_SCORE = 20

const CONFIRMED_GRADE_SIGNALS: ReadonlySet<MatchSignalType> = new Set([
  'exact_unique_external_id',
  'exact_canonical_name',
  'exact_alias',
  'exact_source_name',
])

// Deliberately excludes 'external_id_collision': that signal only means
// the id ALONE isn't proof (Part 2A rule 2), not that this candidate is
// wrong — its weight (EXTERNAL_ID_COLLISION_WEAK) is already too low to
// single-handedly reach STRONG_THRESHOLD, so it can't manufacture a false
// CONFIRMED. But it must not also veto an otherwise-clean, independently
// sufficient exact name/id match into AMBIGUOUS just for coinciding with
// an unrelated namespace collision.
const CONTRADICTION_SIGNALS: ReadonlySet<NegativeSignalType> = new Set([
  'id_name_contradiction',
  'external_id_conflict',
  'reverse_collision',
])

function isConfirmedGrade(match: ChannelCandidateMatch): boolean {
  // The reduced-weight "id matches but also owns another logical channel"
  // signal reuses the 'exact_unique_external_id' type at a lower weight —
  // only the full-weight version counts as confirmed-grade.
  return match.signals.some(
    (s) => CONFIRMED_GRADE_SIGNALS.has(s.type) && (s.type !== 'exact_unique_external_id' || s.weight === SIGNAL_WEIGHTS.EXACT_UNIQUE_EXTERNAL_ID),
  )
}

function isContradicted(match: ChannelCandidateMatch): boolean {
  return match.negativeSignals.some((s) => CONTRADICTION_SIGNALS.has(s.type))
}

// ---------------------------------------------------------------------
// External-id index (Part 2A) — namespace-agnostic on purpose: a
// playlist's tvg-id/epg_channel_id never tells us which ninety-api
// `source_id` it came from, so the only safe deterministic claim is
// "this raw id string appears under exactly one logical channel,
// regardless of which source(s) reported it".
// ---------------------------------------------------------------------

export type ExternalIdIndex = Map<string, Set<string>>

export function buildExternalIdIndex(catalog: NinetyLogicalChannel[]): ExternalIdIndex {
  const index: ExternalIdIndex = new Map()
  for (const logical of catalog) {
    for (const ext of logical.external_ids) {
      const id = ext.source_channel_id.trim()
      if (!id) continue
      const owners = index.get(id) ?? new Set<string>()
      owners.add(logical.id)
      index.set(id, owners)
    }
  }
  return index
}

function playlistExternalIds(channel: Channel): string[] {
  const ids = (channel.epgChannelIds ?? []).map((id) => id.trim()).filter((id) => id.length > 0)
  return [...new Set(ids)]
}

// ---------------------------------------------------------------------
// Structured name conflict (Parts 3 & 4) — the explicit-contradiction
// check between ONE catalog name and ONE playlist name: do they carry
// different brand-qualifier words (TV3 vs TV3 Sport) or different,
// non-overlapping explicit channel numbers (TNT Sports 1 vs 2)? Reuses
// the exact tokenization namesOverlap itself relies on, so this stays in
// sync with that file's regression knowledge instead of drifting from it.
// ---------------------------------------------------------------------

interface StructuredConflict {
  conflict: boolean
  detail: string | null
}

function explicitNumbers(words: string[]): Set<string> {
  return new Set(words.filter((w) => /^\d+$/.test(w)))
}

function structuredConflict(catalogName: string, playlistName: string): StructuredConflict {
  const catalogWords = meaningfulWords(catalogName)
  const playlistWords = meaningfulWords(playlistName)

  const catalogQualifiers = qualifierWords(catalogWords)
  const playlistQualifiers = qualifierWords(playlistWords)
  if (!sameSet(catalogQualifiers, playlistQualifiers)) {
    return {
      conflict: true,
      detail: `qualifier mismatch: catalog name "${catalogName}" carries [${[...catalogQualifiers].join(', ') || 'none'}], playlist name "${playlistName}" carries [${[...playlistQualifiers].join(', ') || 'none'}]`,
    }
  }

  const catalogNumbers = explicitNumbers(catalogWords)
  const playlistNumbers = explicitNumbers(playlistWords)
  if (catalogNumbers.size > 0 && playlistNumbers.size > 0 && ![...catalogNumbers].some((n) => playlistNumbers.has(n))) {
    return {
      conflict: true,
      detail: `channel number mismatch: catalog name "${catalogName}" says [${[...catalogNumbers].join(', ')}], playlist name "${playlistName}" says [${[...playlistNumbers].join(', ')}]`,
    }
  }

  return { conflict: false, detail: null }
}

// ---------------------------------------------------------------------
// Country signal (Part 3.1) — never inferred when either side lacks an
// explicit country; playlist country comes from the SAME group-title
// parsing channelMatch.ts already uses (parseCategory), so this stays
// consistent with the live matcher's notion of "this channel's country".
// ---------------------------------------------------------------------

function playlistCountryKey(channel: Channel): string | null {
  const parsed = parseCategory(channel.groupTitle ?? '').countryName
  return parsed ? parsed.toUpperCase() : null
}

function catalogCountryKey(logical: NinetyLogicalChannel): string | null {
  return logical.country ? normalizeCountryKey(logical.country) : null
}

// Compares one catalog name (canonical/alias/source name) against every
// available playlist name for this channel, returning the single best
// signal found (or null). A plain top-level function — rather than a
// closure mutating an outer `let` — so each call has its own local
// `best`, avoiding TypeScript's control-flow narrowing giving up (and
// widening a captured variable to `never`) across the multiple call sites
// in scoreCandidate below.
function considerName(
  playlistNames: string[],
  overlapType: MatchSignalType,
  exactType: MatchSignalType,
  exactWeight: number,
  overlapWeight: number,
  catalogText: string,
  kindLabel: string,
): MatchSignal | null {
  let best: MatchSignal | null = null
  for (const pname of playlistNames) {
    if (namesExactMatch(catalogText, pname)) {
      if (!best || exactWeight > best.weight) {
        best = { type: exactType, weight: exactWeight, detail: `"${pname}" exactly matches ${kindLabel} "${catalogText}"` }
      }
      // namesOverlap's extra-word gate is intentionally asymmetric (built
      // for channelMatch.ts's convention: station name is ground truth,
      // channel name is the untrusted candidate that must not carry
      // EXTRA distinguishing words) — it only catches the playlist side
      // carrying an unaccounted-for extra word, never the catalog side.
      // Here either side can be the more-specific one (a real catalog
      // sibling like "TVP Historia 2" must not accept a playlist "TVP 2"
      // just because that direction's check never looks at the catalog
      // name's own extra "Historia"), so both directions are required.
    } else if (namesOverlap(catalogText, pname) && namesOverlap(pname, catalogText)) {
      if (!best || overlapWeight > best.weight) {
        best = { type: overlapType, weight: overlapWeight, detail: `"${pname}" overlaps ${kindLabel} "${catalogText}"` }
      }
    }
  }
  return best
}

function bestSignal(candidates: (MatchSignal | null)[]): MatchSignal | null {
  let best: MatchSignal | null = null
  for (const candidate of candidates) {
    if (candidate && (!best || candidate.weight > best.weight)) best = candidate
  }
  return best
}

// ---------------------------------------------------------------------
// Candidate scoring — the core per-(logical channel, playlist channel)
// evaluation. Returns null when this playlist channel should not be
// considered a candidate for this logical channel AT ALL (hard reject),
// as opposed to a low-scoring or contradicted candidate that still
// appears in the resolution's `matches` for transparency.
// ---------------------------------------------------------------------

function scoreCandidate(logical: NinetyLogicalChannel, channel: Channel, idIndex: ExternalIdIndex): ChannelCandidateMatch | null {
  const signals: MatchSignal[] = []
  const negativeSignals: NegativeSignal[] = []
  let score = 0

  // ---- 1. External id (Part 2A / Part 3.4) ----
  const ids = playlistExternalIds(channel)
  const uniqueOwners = new Set<string>()
  const collidingIds: string[] = []
  for (const id of ids) {
    const owners = idIndex.get(id)
    if (!owners || owners.size === 0) continue
    if (owners.size === 1) uniqueOwners.add([...owners][0])
    else collidingIds.push(id)
  }

  const idPointsToLogical = uniqueOwners.has(logical.id)
  const idPointsOnlyElsewhere = uniqueOwners.size === 1 && !idPointsToLogical
  if (idPointsOnlyElsewhere) {
    // Deterministic evidence says this playlist channel IS a different
    // logical channel — strong negative evidence against this one
    // (Part 3.4). Never a candidate for `logical` at all.
    return null
  }

  const idConflictsAcrossMultiple = uniqueOwners.size > 1
  if (idPointsToLogical) {
    if (idConflictsAcrossMultiple) {
      const weight = SIGNAL_WEIGHTS.EXTERNAL_ID_MULTI_OWNER
      score += weight
      signals.push({
        type: 'exact_unique_external_id',
        weight,
        detail: `external id uniquely matches ${logical.id}, but this playlist channel also carries an id that uniquely matches another logical channel (${[...uniqueOwners].filter((id) => id !== logical.id).join(', ')})`,
      })
      negativeSignals.push({
        type: 'external_id_conflict',
        detail: `merged playlist channel's external ids point to multiple different logical channels: ${[...uniqueOwners].join(', ')}`,
      })
    } else {
      score += SIGNAL_WEIGHTS.EXACT_UNIQUE_EXTERNAL_ID
      signals.push({ type: 'exact_unique_external_id', weight: SIGNAL_WEIGHTS.EXACT_UNIQUE_EXTERNAL_ID, detail: `external id uniquely matches ${logical.id}` })
    }
  }

  const collidesWithLogical = collidingIds.some((id) => idIndex.get(id)!.has(logical.id))
  if (collidesWithLogical) {
    score += SIGNAL_WEIGHTS.EXTERNAL_ID_COLLISION_WEAK
    signals.push({ type: 'external_id_collision', weight: SIGNAL_WEIGHTS.EXTERNAL_ID_COLLISION_WEAK, detail: 'external id is shared across multiple logical channels (namespace collision) — not deterministic on its own' })
    negativeSignals.push({ type: 'external_id_collision', detail: 'external id collides across multiple logical channels; treated as non-deterministic (Part 2A rule 2)' })
  }

  // ---- 2. Canonical / alias / source-name identity (Part 2B) ----
  const playlistNames = [channel.name, ...(channel.rawNames ?? [])]
  const nameCandidates: (MatchSignal | null)[] = [
    considerName(playlistNames, 'structured_name_match', 'exact_canonical_name', SIGNAL_WEIGHTS.EXACT_CANONICAL_NAME, SIGNAL_WEIGHTS.STRUCTURED_NAME_MATCH, logical.name, 'canonical name'),
    ...logical.aliases.map((alias) =>
      considerName(playlistNames, 'structured_alias_match', 'exact_alias', SIGNAL_WEIGHTS.EXACT_TRUSTED_ALIAS, SIGNAL_WEIGHTS.STRUCTURED_ALIAS_MATCH, alias, 'trusted alias'),
    ),
    ...logical.source_names.map((sourceName) =>
      considerName(playlistNames, 'structured_source_name_match', 'exact_source_name', SIGNAL_WEIGHTS.EXACT_SOURCE_NAME, SIGNAL_WEIGHTS.STRUCTURED_SOURCE_NAME_MATCH, sourceName, 'known source name'),
    ),
  ]
  const bestNameSignal = bestSignal(nameCandidates)

  if (bestNameSignal) {
    score += bestNameSignal.weight
    signals.push(bestNameSignal)
  }

  // Country/network/explicit-number are corroboration, never founding
  // evidence on their own (Part 5) — without at least a name signal or
  // some id signal already in play, a shared country+network+number is
  // just as likely to be coincidence as identity (e.g. two entirely
  // unrelated channels that both happen to be Norwegian and both happen
  // to be numbered "2"). Their POSITIVE contribution below is gated on
  // that; the country HARD REJECT just below is not — an explicit
  // conflict rejects regardless of whether anything else matched yet.
  const hasIdentityEvidence = bestNameSignal !== null || idPointsToLogical || collidesWithLogical

  // ---- 3. Country (Part 3.1) ----
  const catalogCountry = catalogCountryKey(logical)
  const playlistCountry = playlistCountryKey(channel)
  if (catalogCountry && playlistCountry) {
    if (catalogCountry === playlistCountry) {
      if (hasIdentityEvidence) {
        score += SIGNAL_WEIGHTS.COUNTRY_MATCH
        signals.push({ type: 'country_match', weight: SIGNAL_WEIGHTS.COUNTRY_MATCH, detail: `both sides indicate ${playlistCountry}` })
      }
    } else if (idPointsToLogical && !idConflictsAcrossMultiple) {
      // A clean, unique external id is deterministic even when the
      // playlist's parsed group-title country looks wrong/missing.
      negativeSignals.push({ type: 'country_conflict', detail: `catalog country is ${catalogCountry}, playlist category implies ${playlistCountry} — kept only because the external id is deterministic` })
    } else {
      // No id rescue: an explicit country conflict on both sides is a
      // hard reject for name-based matching (Part 3.1).
      return null
    }
  }

  // ---- 4. Network (Part 2C) ----
  if (hasIdentityEvidence && logical.network_name) {
    const networkWords = meaningfulWords(logical.network_name).filter((w) => qualifierWords([w]).size === 0)
    const playlistTokens = new Set(playlistNames.flatMap((n) => meaningfulWords(n)))
    if (networkWords.length > 0 && networkWords.every((w) => playlistTokens.has(w))) {
      score += SIGNAL_WEIGHTS.NETWORK_MATCH
      signals.push({ type: 'network_match', weight: SIGNAL_WEIGHTS.NETWORK_MATCH, detail: `network "${logical.network_name}" tokens present in playlist channel name` })
    }
  }

  // ---- 5. Explicit channel number corroboration (Part 2C) ----
  if (hasIdentityEvidence) {
    const catalogNumbers = explicitNumbers(meaningfulWords(logical.name))
    const playlistNumbers = explicitNumbers(meaningfulWords(channel.name))
    if (catalogNumbers.size > 0 && [...catalogNumbers].some((n) => playlistNumbers.has(n))) {
      score += SIGNAL_WEIGHTS.CHANNEL_NUMBER_MATCH
      signals.push({ type: 'channel_number_match', weight: SIGNAL_WEIGHTS.CHANNEL_NUMBER_MATCH, detail: `channel number ${[...catalogNumbers].filter((n) => playlistNumbers.has(n)).join(', ')} matches on both sides` })
    }
  }

  // ---- 6. Structured conflict between the PRIMARY names (Parts 3 & 4) ----
  const conflict = structuredConflict(logical.name, channel.name)
  if (conflict.conflict) {
    if (idPointsToLogical && !idConflictsAcrossMultiple) {
      // The id says this IS the channel, but the visible name explicitly
      // disagrees (e.g. id -> "TNT Sports 1", name says "TNT Sports 2").
      // Never silently CONFIRMED — flagged for confirmation instead.
      score = SIGNAL_WEIGHTS.ID_NAME_CONTRADICTION_SCORE
      negativeSignals.push({ type: 'id_name_contradiction', detail: `external id matches ${logical.id}, but ${conflict.detail}` })
    } else if (idPointsToLogical && idConflictsAcrossMultiple) {
      // Same contradiction, but on the multi-owner path (Part 2A rule 3):
      // this candidate is ALREADY contradicted via external_id_conflict
      // above, so there's real id evidence to keep it visible for — just
      // don't hard-reject it for the name conflict on top of that (that
      // would silently hide exactly the merged-id conflict this exists to
      // surface).
      negativeSignals.push({ type: 'id_name_contradiction', detail: `carries an external id matching ${logical.id}, but ${conflict.detail}` })
    } else if (!bestNameSignal) {
      // No id rescue and no OTHER name (alias/source name) rescued this
      // pairing either — nothing left to justify treating it as a
      // candidate at all.
      return null
    } else {
      // Some other catalog name (alias/source name) matched cleanly even
      // though the canonical name conflicts — keep the candidate but
      // surface the conflict for transparency.
      negativeSignals.push({
        type: conflict.detail?.startsWith('qualifier') ? 'qualifier_conflict' : 'channel_number_conflict',
        detail: conflict.detail!,
      })
    }
  }

  if (score <= 0 && signals.length === 0 && negativeSignals.length === 0) return null

  return { channel, score, signals, negativeSignals }
}

// ---------------------------------------------------------------------
// Classification (Part 5) — absolute quality AND separation from
// competing candidates, mirroring the backend event resolver's margin
// concept. `scored` already excludes hard-rejected candidates (Part 3);
// contradicted/collision candidates remain here so they can drive an
// AMBIGUOUS classification instead of disappearing silently.
// ---------------------------------------------------------------------

type ScoredResolution = Omit<LogicalChannelResolution, 'logicalChannelId'>

function classifyScored(scored: ChannelCandidateMatch[]): ScoredResolution {
  if (scored.length === 0) return { classification: 'NONE', matches: [] }

  const sorted = [...scored].sort((a, b) => b.score - a.score)
  const clean = sorted.filter((m) => !isContradicted(m))
  const strongClean = clean.filter((m) => m.score >= STRONG_THRESHOLD)

  if (strongClean.length > 0) {
    const strongSet = new Set(strongClean)
    const competitor = sorted.find((m) => !strongSet.has(m))
    const lowestAccepted = Math.min(...strongClean.map((m) => m.score))
    const margin = competitor ? lowestAccepted - competitor.score : undefined

    if (margin !== undefined && margin < MARGIN_THRESHOLD) {
      return {
        classification: 'AMBIGUOUS',
        matches: [...strongClean, competitor!],
        runnerUpScore: competitor!.score,
        margin,
      }
    }

    return {
      classification: strongClean.some(isConfirmedGrade) ? 'CONFIRMED' : 'STRONG',
      matches: strongClean,
      runnerUpScore: competitor?.score,
      margin,
    }
  }

  // Nothing independently clears the strong bar cleanly — either the
  // very best candidate is contradicted/collision-flagged (surfaced as
  // AMBIGUOUS so it can go through EPG confirmation later), or there are
  // multiple merely-plausible candidates too close to call, or there's
  // genuinely nothing worth reporting.
  const top = sorted[0]
  const second = sorted[1]
  if (top.score < AMBIGUOUS_MIN_SCORE) return { classification: 'NONE', matches: [] }

  const matches = second && second.score >= AMBIGUOUS_MIN_SCORE ? [top, second] : [top]
  return {
    classification: 'AMBIGUOUS',
    matches,
    runnerUpScore: second?.score,
    margin: second ? top.score - second.score : undefined,
  }
}

// ---------------------------------------------------------------------
// Reverse collision guard (Part 6) — one playlist Channel may legitimately
// satisfy several DIFFERENT logical channels only when it's genuinely a
// duplicate provider entry for the SAME station; it must never be
// automatically claimed by two DIFFERENT logical channels at once. Country
// conflicts are already hard-rejected upstream (Part 3.1), so by the time
// a real cross-logical-channel collision reaches this guard, score is the
// only remaining signal available to disambiguate.
// ---------------------------------------------------------------------

function addTo(map: Map<string, Set<string>>, key: string, value: string): void {
  const set = map.get(key) ?? new Set<string>()
  set.add(value)
  map.set(key, set)
}

// ---------------------------------------------------------------------
// Candidate generation (resolver-integration task, Part 3) — a naive
// O(catalog x playlist) nested loop was measured at 3.5M+ scoreCandidate
// calls against a real 30,925-channel playlist (~115 catalog channels),
// taking minutes: unacceptable for a TV app's startup path. scoreCandidate
// itself already guarantees a null (no signal) result for most of those
// pairs before it ever looks at names: Part 3.1's hard country-conflict
// reject means a (logical, channel) pair can only ever produce a signal
// when the catalog side has no country, the playlist side has no parsed
// country, the two sides' countries match, OR the playlist channel
// carries an external id this logical channel owns (which rescues a
// country mismatch — see scoreCandidate's idPointsToLogical branch). This
// builds a per-playlist-channel candidate set of logicalChannelIds from
// exactly those same conditions, so scoreCandidate is only invoked for
// pairs that could actually produce a signal. This changes WHICH pairs are
// skipped, never which pairs return non-null when scored — a skipped pair
// is always one scoreCandidate would have rejected anyway. Deliberately
// NOT a brand/token index: real catalog names like "V Sport 1" or "V Sport
// Live 1" reduce to zero non-generic brand words under meaningfulWords
// (the "V" is single-character noise, "Sport"/"Live" are generic/qualifier
// words) — a token index keyed on those would silently drop real
// candidates, which country+id bucketing never risks. Verified
// byte-identical against the gold dataset (npm run evaluate:channel-identity)
// before and after.
// ---------------------------------------------------------------------

function buildCountryToLogicalIds(catalog: NinetyLogicalChannel[]): { byCountry: Map<string, string[]>; noCountry: string[] } {
  const byCountry = new Map<string, string[]>()
  const noCountry: string[] = []
  for (const logical of catalog) {
    const key = catalogCountryKey(logical)
    if (key === null) {
      noCountry.push(logical.id)
      continue
    }
    const list = byCountry.get(key) ?? []
    list.push(logical.id)
    byCountry.set(key, list)
  }
  return { byCountry, noCountry }
}

// The logicalChannelIds worth scoring THIS playlist channel against —
// mirrors exactly the set of pairs scoreCandidate could produce a signal
// for (see the section comment above), nothing more, nothing less.
function candidateLogicalIds(
  channel: Channel,
  catalog: NinetyLogicalChannel[],
  byCountry: Map<string, string[]>,
  noCountry: string[],
  idIndex: ExternalIdIndex,
): Set<string> {
  const candidates = new Set<string>()
  const channelCountry = playlistCountryKey(channel)
  if (channelCountry === null) {
    // No parsed country on this playlist entry — scoreCandidate's country
    // check only ever fires when BOTH sides have one, so a country-less
    // channel remains a candidate against the whole catalog, same as the
    // original nested loop.
    for (const logical of catalog) candidates.add(logical.id)
  } else {
    for (const id of byCountry.get(channelCountry) ?? []) candidates.add(id)
    for (const id of noCountry) candidates.add(id)
  }
  for (const extId of playlistExternalIds(channel)) {
    const owners = idIndex.get(extId)
    if (owners) for (const id of owners) candidates.add(id)
  }
  return candidates
}

export function resolveChannelIdentities(catalog: NinetyLogicalChannel[], playlist: Channel[]): Map<string, LogicalChannelResolution> {
  const idIndex = buildExternalIdIndex(catalog)
  const logicalById = new Map(catalog.map((l) => [l.id, l]))
  const { byCountry, noCountry } = buildCountryToLogicalIds(catalog)

  const scoredByLogical = new Map<string, ChannelCandidateMatch[]>()
  for (const logical of catalog) scoredByLogical.set(logical.id, [])

  // Single pass over the playlist (not one pass per logical channel) —
  // each channel is scored against its own small candidate set, and
  // appended to that logicalChannelId's array in playlist order, so a
  // fixed logical channel's `scored` list ends up in exactly the order
  // the original nested loop (`for (const channel of playlist)` per
  // logical) would have produced it in.
  for (const channel of playlist) {
    const candidates = candidateLogicalIds(channel, catalog, byCountry, noCountry, idIndex)
    for (const logicalId of candidates) {
      const logical = logicalById.get(logicalId)
      if (!logical) continue
      const candidate = scoreCandidate(logical, channel, idIndex)
      if (candidate) scoredByLogical.get(logicalId)!.push(candidate)
    }
  }

  const firstPass = new Map<string, ScoredResolution>()
  for (const [logicalId, scored] of scoredByLogical) firstPass.set(logicalId, classifyScored(scored))

  // Which playlist channel ids were accepted (CONFIRMED/STRONG) by which
  // logical channels, and at what score — the raw material for detecting
  // one playlist channel automatically claimed by more than one station.
  const claims = new Map<string, Array<{ logicalChannelId: string; score: number }>>()
  for (const [logicalId, res] of firstPass) {
    if (res.classification !== 'CONFIRMED' && res.classification !== 'STRONG') continue
    for (const m of res.matches) {
      const list = claims.get(m.channel.id) ?? []
      list.push({ logicalChannelId: logicalId, score: m.score })
      claims.set(m.channel.id, list)
    }
  }

  // logicalChannelId -> playlist channel ids that must be stripped of
  // their acceptance and recomputed (either lost to a clearly higher
  // scoring competitor, or a genuine tie neither side can resolve).
  const exclusions = new Map<string, Set<string>>()
  const collisionReason = new Map<string, Set<string>>()

  for (const [channelId, entries] of claims) {
    const distinctLogicalChannels = new Set(entries.map((e) => e.logicalChannelId))
    if (distinctLogicalChannels.size <= 1) continue

    const sortedEntries = [...entries].sort((a, b) => b.score - a.score)
    const winner = sortedEntries[0]
    const runnerUp = sortedEntries[1]
    const decisive = winner.score - runnerUp.score >= MARGIN_THRESHOLD

    for (const entry of sortedEntries) {
      if (decisive && entry.logicalChannelId === winner.logicalChannelId) continue
      addTo(exclusions, entry.logicalChannelId, channelId)
      if (!decisive) addTo(collisionReason, entry.logicalChannelId, channelId)
    }
  }

  const final = new Map<string, LogicalChannelResolution>()
  for (const [logicalId, scored] of scoredByLogical) {
    const excludedChannelIds = exclusions.get(logicalId)
    if (!excludedChannelIds || excludedChannelIds.size === 0) {
      final.set(logicalId, { logicalChannelId: logicalId, ...firstPass.get(logicalId)! })
      continue
    }

    const flaggedAsTie = collisionReason.get(logicalId) ?? new Set<string>()
    const adjusted = scored.map((m) => {
      if (!excludedChannelIds.has(m.channel.id)) return m
      const detail = flaggedAsTie.has(m.channel.id)
        ? 'this playlist channel scores comparably for another logical channel too, with no decisive evidence to prefer either (Part 6 reverse collision)'
        : 'this playlist channel is claimed by a clearly higher-scoring logical channel (Part 6 reverse collision)'
      return { ...m, negativeSignals: [...m.negativeSignals, { type: 'reverse_collision' as const, detail }] }
    })

    final.set(logicalId, { logicalChannelId: logicalId, ...classifyScored(adjusted) })
  }

  return final
}
