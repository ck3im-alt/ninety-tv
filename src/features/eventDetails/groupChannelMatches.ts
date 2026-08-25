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
// display time, scoped to country + canonical name only, which is safe
// because it only affects what's shown for one specific event's broadcast
// list, not the user's channel catalogue.
import { parseCategory, isPpvCategory } from '../channels/parseCategory'
import { normalizeChannelName } from '../../data/normalize'
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
// - 'ninety' source: ninety-api's own resolver already confirmed this exact
//   broadcaster for the current fixture (CONFIRMED/STRONG — see
//   channelMatch.ts's matchViaNinetyApi); that's stronger proof than any
//   text check, and is available even with no eventContext at all.
// - everything else ('ppvName', non-weak 'epg', 'broadcasterMap' at
//   'confirmed'/'likely'): only verified when eventContext supplies team
//   names AND this exact raw channel name contains both — with no
//   eventContext to check against, this conservatively returns false rather
//   than assuming the caller-scoping invariant holds.
function verifiedSameEvent(match: ChannelMatch, eventContext?: PpvDisplayNameContext): boolean {
  if (matchConfidence(match) === 'candidate') return false
  if (match.source === 'ninety') return true
  if (!eventContext?.homeTeam || !eventContext?.awayTeam) return false
  const folded = foldForMatching(match.channel.name)
  return textMatchesTeam(folded, eventContext.homeTeam) && textMatchesTeam(folded, eventContext.awayTeam)
}

function groupKey(match: ChannelMatch, eventContext?: PpvDisplayNameContext): string {
  const channel = match.channel
  const category = parseCategory(channel.groupTitle ?? '')
  const country = category.countryCode ?? ''
  if (isPpvCategory(category)) {
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
    const identity = verifiedSameEvent(match, eventContext) ? (extractProviderIdentity(channel.name) ?? normalizePpvDisplayName(channel.name)) : normalizePpvDisplayName(channel.name)
    return `${country}|ppv|${identity.toLowerCase()}`
  }
  const { canonicalName } = normalizeChannelName(channel.name)
  return `${country}|${foldPluralSport(canonicalName.toLowerCase())}`
}

export function groupChannelMatches(matches: ChannelMatch[], eventContext?: PpvDisplayNameContext): MatchGroup[] {
  const order: string[] = []
  const groups = new Map<string, MatchGroup>()

  for (const match of matches) {
    const key = groupKey(match, eventContext)
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
    if (match.broadcastCountry !== undefined && group.broadcastCountry === undefined) {
      group.broadcastCountry = match.broadcastCountry
    }
    for (const source of match.channel.sources) {
      group.sourceOptions.push({ channel: match.channel, source })
    }
  }

  return order.map((key) => groups.get(key)!)
}
