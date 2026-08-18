import type { Channel, ChannelSource } from '../../data/channel'
import type { RawChannel } from '../../data/rawChannel'
import { normalizeChannelName } from '../../data/normalize'
import { parseCategory } from './parseCategory'

// Same real channel is sometimes spelled with the brand word singular in
// one playlist entry and plural in another ("TNT Sport 1" vs "TNT Sports
// 1") — folded to one form for the MERGE KEY only (never for the displayed
// name) so the two don't key apart as if they were different channels.
function foldPluralSport(name: string): string {
  return name.replace(/\bsports\b/g, 'sport')
}

// Folds quality-variant duplicates ("TNT SPORTS 1 RAW" / "TNT SPORTS 1 UHD" /
// "TNT SPORTS 1 HD") into a single Channel with one source per variant.
// The merge key is the channel's canonical (tag-stripped) name *within its
// merged category* — same channel name in a different category (or
// country) stays a separate channel, since that's a real distinction, not a
// quality artifact.
export function mergeChannelSources(raw: RawChannel[]): Channel[] {
  const order: string[] = []
  const groups = new Map<
    string,
    { name: string; logo?: string; groupTitle?: string; sources: ChannelSource[]; hasEpgChannelId: boolean }
  >()

  for (const entry of raw) {
    const { canonicalName, qualityTag } = normalizeChannelName(entry.name)
    const category = parseCategory(entry.groupTitle || '')
    const key = `${category.countryCode ?? ''}|${category.mergedLabel}|${foldPluralSport(canonicalName.toLowerCase())}`

    let group = groups.get(key)
    if (!group) {
      group = { name: canonicalName, logo: entry.logo, groupTitle: entry.groupTitle, sources: [], hasEpgChannelId: false }
      groups.set(key, group)
      order.push(key)
    }
    if (!group.logo && entry.logo) group.logo = entry.logo
    if (entry.epgChannelId) group.hasEpgChannelId = true
    group.sources.push({ label: qualityTag ?? 'Default', url: entry.url })
  }

  return order.map((key) => {
    const group = groups.get(key)!
    return {
      id: key,
      name: group.name,
      logo: group.logo,
      groupTitle: group.groupTitle,
      sources: group.sources,
      hasEpgChannelId: group.hasEpgChannelId,
    }
  })
}
