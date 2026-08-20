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
import { matchConfidence, confidenceRank } from './streamConfidence'
import { normalizePpvDisplayName } from './ppvDisplayName'
import type { StreamMatchConfidence } from './streamConfidence'
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
  sourceOptions: SourceOption[]
}

function foldPluralSport(name: string): string {
  return name.replace(/\bsports\b/g, 'sport')
}

function groupKey(channel: Channel): string {
  const category = parseCategory(channel.groupTitle ?? '')
  const country = category.countryCode ?? ''
  if (isPpvCategory(category)) {
    // Event-specific PPV entries for the SAME provider/slot commonly differ
    // ONLY by an embedded quality tag inside the raw event-title-shaped name
    // ("... | 8K EXCLUSIVE | NO: TV2 PLAY PPV 20" vs "... | FHD | NO: TV2
    // PLAY PPV 20") — grouping by the full canonicalName below would keep
    // those as separate rows, hiding each other's quality alternatives (see
    // the redesign task's PPV-grouping fix). The cleaned PPV display
    // identity (quality/date/team-title noise already stripped — see
    // ppvDisplayName.ts) is a much better grouping key for PPV
    // specifically: same provider/slot -> same cleaned name -> same group,
    // regardless of which quality tag that particular raw entry carried.
    // Distinct slots ("PPV 20" vs "PPV 21") still clean down to distinct
    // names, so they correctly stay separate groups — this never merges
    // event-specific streams that aren't actually the same one.
    return `${country}|ppv|${normalizePpvDisplayName(channel.name).toLowerCase()}`
  }
  const { canonicalName } = normalizeChannelName(channel.name)
  return `${country}|${foldPluralSport(canonicalName.toLowerCase())}`
}

export function groupChannelMatches(matches: ChannelMatch[]): MatchGroup[] {
  const order: string[] = []
  const groups = new Map<string, MatchGroup>()

  for (const match of matches) {
    const key = groupKey(match.channel)
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        name: match.channel.name,
        logo: match.channel.logo,
        isExactMatch: false,
        confidence: 'candidate',
        label: match.label,
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
