// Collapses ChannelMatch results that are really the same real-world
// channel into one displayable group before the "Available On" list
// renders — see blueprint section 38 ("client-side duplicate grouping").
// mergeChannelSources (features/channels/mergeChannels.ts) already does
// this at playlist-load time, but only within a single parsed category —
// some IPTV panels split the *same* channel across sibling categories by
// quality tier ("UK: SPORTS HD" vs "UK: SPORTS RAW"), which legitimately
// produces multiple distinct Channel objects for one real channel. Rather
// than loosen the ingest-time merge (which deliberately treats category as
// a real distinction — see mergeChannelSources's comment), this regroups at
// display time, which is safe because it only affects what's shown for one
// specific event's broadcast list, not the user's channel catalogue.
//
// Grouping identity has TWO layers, strongest first:
// 1. Ninety's own logical broadcaster id (ChannelMatch.logicalChannelId) for
//    a resolved linear broadcast. This is authoritative: the resolver
//    already decided these playlist entries ARE that channel, so grouping
//    them by playlist TEXT afterwards could only ever undo that decision —
//    which is exactly what happened ("TV2 SPORT 1" and "TV 2 SPORT 1" both
//    CONFIRMED as one Norwegian channel, shown as two identical rows).
// 2. The pre-existing normalized-text key (country + canonical name, or the
//    event-aware PPV identity), for every match with no logical identity to
//    key on — broadcasterMap/EPG matches and one-off PPV entries.
// Nothing here loosens text matching: layer 2 is byte-for-byte the old
// behavior, and layer 1 only ever merges what an authoritative identity
// already declared identical.
import { parseCategory, isPpvCategory } from '../channels/parseCategory'
import { normalizeChannelName } from '../../data/normalize'
import { COUNTRY_NAMES } from '../../data/countryCodes'
import { foldForMatching } from '../../data/fancyUnicode'
import { textMatchesTeam } from '../../data/sports/channelMatchCore'
import { matchConfidence, confidenceRank } from './streamConfidence'
import { normalizePpvDisplayName, extractProviderIdentity } from './ppvDisplayName'
import type { StreamMatchConfidence } from './streamConfidence'
import type { PpvDisplayNameContext } from './ppvDisplayName'
import type { Channel, ChannelSource } from '../../data/channel'
import type { ChannelMatch } from '../../data/sports/channelMatch'

export interface SourceOption {
  channel: Channel
  source: ChannelSource
}

export interface MatchGroup {
  key: string
  name: string
  logo?: string
  isExactMatch: boolean
  // UI/ranking trust tier derived from the best evidence contributing to
  // this group (see streamConfidence.ts) — 'confirmed' whenever
  // isExactMatch is true, but also distinguishes 'likely' (a real,
  // automatically-watchable match that isn't literally exact) from
  // 'candidate' (a loose fallback, e.g. a numbered-sibling broadcaster-map
  // overlap) among the non-exact matches isExactMatch alone can't tell
  // apart.
  confidence: StreamMatchConfidence
  label: string
  // ninety-api's own canonical broadcast name, set only when a 'ninety'
  // match contributed to this group — preferred over the playlist's own
  // (possibly differently-spelled) channel name for display, see
  // ppvDisplayName.ts's getChannelDisplayName.
  canonicalBroadcastName?: string
  // ninety-api's reported broadcast country for a contributing 'ninety'
  // match, when known — a fallback for Event Details' country column when
  // the matched playlist channel's own groupTitle has no parseable country
  // prefix (see ppvDisplayName.ts / buildEventStreamOptions.ts).
  broadcastCountry?: string | null
  // Which matching stage produced the group's current best-trusted match
  // (see channelMatch.ts's ChannelMatch.source / streamConfidence.ts) —
  // display/debug metadata only, tracked the same way isExactMatch/name/
  // label are: whichever match currently holds the highest confidence tier
  // in the group "owns" this field too. Lets the dev debug panel show e.g.
  // "ppvName" vs "ninety" directly instead of requiring a live API call to
  // tell a resolver-backed broadcast apart from a playlist-text PPV guess.
  matchSource: ChannelMatch['source']
  // The authoritative Ninety logical broadcaster this group was keyed on,
  // when it has one (see logicalIdentityKey below) — the reason several
  // differently-spelled playlist channels became ONE group. Display/debug
  // metadata only.
  logicalChannelId?: string
  sourceOptions: SourceOption[]
}

function foldPluralSport(name: string): string {
  return name.replace(/\bsports\b/g, 'sport')
}

// Verifies a specific match is confidently tied to THE SAME canonical event
// as `eventContext` — the discriminator the slot-stripping fix below needs
// (task section 5/6: "event identity should be stronger than raw PPV-slot
// naming once both entries have confidently resolved to the same canonical
// event... do not weaken separation when event identity is unknown").
// Deliberately reuses the SAME textMatchesTeam check the matching pipeline
// itself already trusts (matchViaPpvChannelName/matchViaEpg both require
// exactly this before a 'ppvName'/'epg' ChannelMatch can exist at all) —
// never a new/invented fuzzy comparison, and never entry-to-entry text
// diffing (comparing two raw names against each other would still be
// exactly the fragile comparison the task warns against).
// - 'candidate' confidence (loose broadcasterMap overlap, weak widened-EPG
//   guess): never verified — no real evidence ties it to this event at all.
// - 'ninety' source with NO team names to check against (a single-entrant
//   event — F1 session, golf round): ninety-api's own resolver confirmed
//   this exact broadcaster for the current fixture (CONFIRMED/STRONG — see
//   channelMatch.ts's matchViaNinetyApi), and there is no stronger evidence
//   obtainable, so the resolver's word stands.
// - everything else, 'ninety' included once team names ARE known
//   ('ppvName', non-weak 'epg', 'broadcasterMap' at 'confirmed'/'likely'):
//   only verified when eventContext supplies team names AND this exact raw
//   channel name contains both — with no eventContext to check against,
//   this conservatively returns false rather than assuming the
//   caller-scoping invariant holds.
//
//   'ninety' is deliberately NOT exempt here. This function is only ever
//   reached for a PPV-categorized entry, and a resolved channel identity
//   answers "which provider", never "which fixture" — one provider runs
//   many simultaneous one-off slots. Treating channel identity as event
//   identity would let two genuinely different fixtures from the same
//   provider lose their slot numbers and collapse into one row, which is
//   exactly the discrimination Part 2 of the stream-dedupe task requires be
//   preserved. Real same-event mirrors still merge: they carry the fixture
//   in their own raw name, which is what this check reads.
function verifiedSameEvent(match: ChannelMatch, eventContext?: PpvDisplayNameContext): boolean {
  if (matchConfidence(match) === 'candidate') return false
  if (!eventContext?.homeTeam || !eventContext?.awayTeam) return match.source === 'ninety'
  const folded = foldForMatching(match.channel.name)
  return textMatchesTeam(folded, eventContext.homeTeam) && textMatchesTeam(folded, eventContext.awayTeam)
}

// The CANONICAL country a match belongs to, for logical-identity grouping
// only — deliberately the country NAME, not parseCategory's raw code: real
// playlists spell the same market several ways in the same list ("NO| ..."
// and "NOR - ..." both mean Norway), and the raw code alone would keep one
// broadcaster split across those spellings even once its logical identity
// says they're the same channel. Falls back to ninety-api's own reported
// broadcast country (the same fallback Event Details' country column
// already uses — see buildEventStreamOptions.ts's resolveCountry), so a
// resolved channel whose playlist category carries no country prefix is
// scoped to the market Ninety says it's in rather than to a nameless
// bucket. Country stays part of the key: two genuinely different markets
// must never collapse into one row, however identical their text.
function countryScopeForIdentity(match: ChannelMatch): string {
  const { countryName } = parseCategory(match.channel.groupTitle ?? '')
  if (countryName) return countryName
  if (match.broadcastCountry) {
    const code = match.broadcastCountry.toUpperCase()
    return COUNTRY_NAMES[code] ?? code
  }
  return ''
}

// The authoritative grouping identity, when one exists: Ninety already
// resolved this playlist channel to a specific logical broadcaster
// (CONFIRMED/STRONG — nothing weaker ever becomes a 'ninety' ChannelMatch,
// see channelMatch.ts's matchViaNinetyApi), so two playlist entries that
// resolved to the SAME logicalChannelId are the same real channel no matter
// how differently the provider spelled them.
//
// Deliberately NOT applied to PPV-categorized entries: a one-off event feed
// resolving to a provider's logical channel says nothing about WHICH event
// it carries, so keying those by logical identity would merge two genuinely
// different fixtures from the same provider into one row. Those keep the
// existing event-aware PPV key below, untouched (see Part 2 of the
// stream-dedupe task).
function logicalIdentityKey(match: ChannelMatch): string | null {
  if (match.source !== 'ninety' || !match.logicalChannelId) return null
  if (isPpvCategory(parseCategory(match.channel.groupTitle ?? ''))) return null
  return `${countryScopeForIdentity(match)}|ninety|${match.logicalChannelId}`
}

// The pre-existing text-derived key: playlist country code + canonical
// (quality-tag-stripped) channel name, or the event-aware PPV identity for
// a PPV-categorized entry. Still the ONLY key for every match with no
// authoritative logical identity (broadcasterMap/EPG/PPV matches, and any
// 'ninety' match from an index that predates logicalChannelId) — see
// groupChannelMatches below for how the two combine.
function textGroupKey(match: ChannelMatch, eventContext?: PpvDisplayNameContext): string {
  const channel = match.channel
  const category = parseCategory(channel.groupTitle ?? '')
  const country = category.countryCode ?? ''
  // ppvName is itself proof that this is an event-specific playlist row.
  // Some panels put those rows in an ordinary country/sports category rather
  // than one literally named PPV, so category text alone left aliases such
  // as "VIAPLAY | Team A - Team B" and "Viaplay 22 | Team A - Team B" as
  // two rows even though both had already matched this exact fixture.
  if (isPpvCategory(category) || match.source === 'ppvName') {
    // Event-specific PPV entries for the SAME provider/slot commonly differ
    // ONLY by an embedded quality tag inside the raw event-title-shaped name
    // ("... | 8K EXCLUSIVE | NO: TV2 PLAY PPV 20" vs "... | FHD | NO: TV2
    // PLAY PPV 20") — grouping by the full canonicalName below would keep
    // those as separate rows, hiding each other's quality alternatives.
    //
    // But quality mirrors of the SAME stream are also commonly published
    // under a DIFFERENT slot/feed number per mirror ("... NO: Viaplay PPV
    // 03" 8K vs "... NO: Viaplay PPV 04" with no quality tag at all) — real
    // regression: two Norwegian Viaplay rows for the same Málaga–Deportivo
    // match stayed separate because the slot-preserving key below treated
    // "03" and "04" as different streams. Once verifiedSameEvent confirms
    // this specific entry is confidently tied to the SAME canonical event as
    // every other entry in this call, the slot number is safe to drop via
    // extractProviderIdentity (provider identity only — task section 5/6).
    // Genuinely different one-off events from the same provider (different
    // team pairs, different slot numbers) still stay separate: their raw
    // names don't both satisfy verifiedSameEvent against the SAME
    // eventContext, so they fall through to the slot-preserving key exactly
    // as before.
    let identity = verifiedSameEvent(match, eventContext) ? (extractProviderIdentity(channel.name) ?? normalizePpvDisplayName(channel.name)) : normalizePpvDisplayName(channel.name)
    // A bare trailing number is also a disposable provider slot for a
    // verified ppvName event feed ("Viaplay 22"). Restrict this to rows whose
    // own title contains both teams of the current event: ordinary numbered
    // linear channels such as V Sport Premier League 1 must stay distinct.
    if (match.source === 'ppvName' && verifiedSameEvent(match, eventContext)) {
      identity = identity.replace(/\s+\d+\s*$/, '').trim() || identity
    }
    return `${country}|ppv|${identity.toLowerCase()}`
  }
  const { canonicalName } = normalizeChannelName(channel.name)
  return `${country}|${foldPluralSport(canonicalName.toLowerCase())}`
}

// Resolves every match's final group key in one pass, combining the two
// identity layers:
// 1. A match with an authoritative logical identity uses it directly.
// 2. A match WITHOUT one falls back to its text key — but if some
//    logically-identified match in this same call already occupies that
//    exact text key, it joins that group instead. Without this, adding
//    layer 1 would have SPLIT pairs that used to merge: a channel resolved
//    by Ninety and an identically-named sibling matched only by
//    broadcasterMap/EPG would have landed in two different keys and shown
//    up as the very duplicate row this change exists to remove. Absorbing
//    by the text key they already shared is not a loosening — it's exactly
//    the merge that happened before.
function resolveGroupKeys(matches: ChannelMatch[], eventContext?: PpvDisplayNameContext): string[] {
  const keyed = matches.map((match) => ({ textKey: textGroupKey(match, eventContext), logicalKey: logicalIdentityKey(match) }))
  const logicalByTextKey = new Map<string, string>()
  for (const { textKey, logicalKey } of keyed) {
    if (logicalKey && !logicalByTextKey.has(textKey)) logicalByTextKey.set(textKey, logicalKey)
  }
  return keyed.map(({ textKey, logicalKey }) => logicalKey ?? logicalByTextKey.get(textKey) ?? textKey)
}

export function groupChannelMatches(matches: ChannelMatch[], eventContext?: PpvDisplayNameContext): MatchGroup[] {
  const order: string[] = []
  const groups = new Map<string, MatchGroup>()
  const keys = resolveGroupKeys(matches, eventContext)

  for (const [index, match] of matches.entries()) {
    const key = keys[index]
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        name: match.channel.name,
        logo: match.channel.logo,
        isExactMatch: false,
        confidence: 'candidate',
        label: match.label,
        matchSource: match.source,
        sourceOptions: [],
      }
      groups.set(key, group)
      order.push(key)
    }
    // The single best-trusted match anywhere in the group promotes the
    // whole group, and its label/logo/name are preferred as the more
    // trustworthy identity — a fuzzy sibling shouldn't be the one
    // representing the group visually.
    const confidence = matchConfidence(match)
    if (confidenceRank(confidence) > confidenceRank(group.confidence)) {
      group.confidence = confidence
      group.isExactMatch = match.isExactMatch
      group.name = match.channel.name
      group.label = match.label
      group.matchSource = match.source
      if (match.channel.logo) group.logo = match.channel.logo
    }
    if (!group.logo && match.channel.logo) group.logo = match.channel.logo
    if (match.source === 'ninety' && group.canonicalBroadcastName === undefined) {
      group.canonicalBroadcastName = match.label
    }
    if (match.logicalChannelId !== undefined && group.logicalChannelId === undefined) {
      group.logicalChannelId = match.logicalChannelId
    }
    if (match.broadcastCountry !== undefined && group.broadcastCountry === undefined) {
      group.broadcastCountry = match.broadcastCountry
    }
    const matchedSourceUrls = match.matchedSourceUrls ? new Set(match.matchedSourceUrls) : null
    for (const source of match.channel.sources) {
      if (matchedSourceUrls && !matchedSourceUrls.has(source.url)) continue
      group.sourceOptions.push({ channel: match.channel, source })
    }
  }

  return order.map((key) => groups.get(key)!)
}
