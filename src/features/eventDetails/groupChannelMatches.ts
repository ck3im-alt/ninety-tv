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
import { parseCategory } from '../channels/parseCategory'
import { normalizeChannelName } from '../../data/normalize'
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
  label: string
  sourceOptions: SourceOption[]
}

function foldPluralSport(name: string): string {
  return name.replace(/\bsports\b/g, 'sport')
}

function groupKey(channel: Channel): string {
  const { canonicalName } = normalizeChannelName(channel.name)
  const country = parseCategory(channel.groupTitle ?? '').countryCode ?? ''
  return `${country}|${foldPluralSport(canonicalName.toLowerCase())}`
}

export function groupChannelMatches(matches: ChannelMatch[]): MatchGroup[] {
  const order: string[] = []
  const groups = new Map<string, MatchGroup>()

  for (const match of matches) {
    const key = groupKey(match.channel)
    let group = groups.get(key)
    if (!group) {
      group = { key, name: match.channel.name, logo: match.channel.logo, isExactMatch: false, label: match.label, sourceOptions: [] }
      groups.set(key, group)
      order.push(key)
    }
    // An exact match anywhere in the group promotes the whole group, and
    // its label/logo/name are preferred as the more trustworthy identity —
    // a fuzzy sibling shouldn't be the one representing the group visually.
    if (match.isExactMatch && !group.isExactMatch) {
      group.isExactMatch = true
      group.name = match.channel.name
      group.label = match.label
      if (match.channel.logo) group.logo = match.channel.logo
    }
    if (!group.logo && match.channel.logo) group.logo = match.channel.logo
    for (const source of match.channel.sources) {
      group.sourceOptions.push({ channel: match.channel, source })
    }
  }

  return order.map((key) => groups.get(key)!)
}
